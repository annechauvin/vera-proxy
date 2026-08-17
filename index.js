const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json({ limit: '25mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const APPS_URL = 'https://script.google.com/macros/s/AKfycbx8GaIdXWbDkTrqlcgM5kvGX_iMIYfKxl8Z8udZAV9n_kDDYZo9QHPiC99M8jAdEdfW/exec';

async function fetchKnowledge(category) {
  try {
    const url = APPS_URL + '?action=getKnowledge&category=' + encodeURIComponent(category);
    const resp = await fetch(url, { redirect: 'follow' });
    const data = await resp.json();
    return data.text || '';
  } catch (err) {
    console.error('Knowledge fetch error:', err.message);
    return '';
  }
}

const KB_DIR = path.join(__dirname, 'knowledge');
if (!fs.existsSync(KB_DIR)) fs.mkdirSync(KB_DIR);

app.post('/knowledge', (req, res) => {
  try {
    const { category, text, password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
    const safe = category.replace(/[^a-zA-Z0-9-_]/g, '');
    fs.writeFileSync(path.join(KB_DIR, safe + '.txt'), text, 'utf8');
    res.json({ success: true, category: safe });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/knowledge/:category', (req, res) => {
  try {
    const safe = req.params.category.replace(/[^a-zA-Z0-9-_]/g, '');
    const file = path.join(KB_DIR, safe + '.txt');
    res.json({ category: safe, text: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const EXTRACT_SYSTEM = `You are a smart real estate data extraction engine for a Canadian rental property investment tool. Extract data from property listings and return only valid JSON with these exact fields. NEVER invent numbers. If unsure, set to null.

Return this exact JSON:
{
  "PropertyAddress": string or null,
  "PropertyNeighborhood": string or null,
  "ListingDescription": string or null,
  "PropertyAskingPrice": number or null,
  "PropertyPuchasePrice": number or null,
  "NumberofUnits": number or null,
  "PropertyUsage": "Full rental" or "Owner-occupied duplex" or "Owner-occupied triplex" or null,
  "AsIsRent1": number or null,
  "AsIsRent2": number or null,
  "AsIsRent3": number or null,
  "AsIsRent4": number or null,
  "Unit1Type": "1-bed" or "2-bed" or "3-bed" or "4-bed" or "studio" or null,
  "Unit2Type": "1-bed" or "2-bed" or "3-bed" or "4-bed" or "studio" or null,
  "Unit3Type": "1-bed" or "2-bed" or "3-bed" or "4-bed" or "studio" or null,
  "Unit4Type": "1-bed" or "2-bed" or "3-bed" or "4-bed" or "studio" or null,
  "OtherMonthlyIncome": number or null,
  "VacancyRate": number or null,
  "PropertyTax": number or null,
  "Insurance": number or null,
  "RepairsAndMaintenanceRate": number or null,
  "Utilities_Electricity": number or null,
  "Utilities_Heat": number or null,
  "Utilities_Water": number or null,
  "Rentals_WaterTanks_HeatPumps": number or null,
  "LawnAndSnowMaintenance": number or null,
  "PropertyManagementRate": number or null,
  "PestControl": number or null,
  "OtherExpenses": number or null,
  "DownpaymentPercentage": number or null,
  "InterestRate": number or null,
  "AmortizationPeriod": number or null,
  "ClosingCostsRate": number or null,
  "CMHCInsurancePremium": number or null,
  "RenovationEstimate": number or null,
  "GrowthYOYPercentageYr1": number or null,
  "AppreciationPercentageYr1": number or null
}`;

app.post('/extract', async (req, res) => {
  try {
    const { text } = req.body;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2048, system: EXTRACT_SYSTEM, messages: [{ role: 'user', content: text }] })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const txt = data.content?.find(b => b.type === 'text')?.text || '';
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Could not extract data from listing');
    res.json(JSON.parse(m[0]));
  } catch (err) {
    console.error('Extract error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/analyze', async (req, res) => {
  try {
    const response = await fetch(APPS_URL, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const text = await response.text();
    res.json(JSON.parse(text));
  } catch (err) {
    console.error('Analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// FIXED: /insights now has real web search (tools array + tool-use
// loop), same pattern already proven working on /find-realtors and
// /build-team. Previously this route had no `tools` at all, so every
// province/city research answer came from training-data recall, not
// a live lookup.
// ─────────────────────────────────────────────────────────────
app.post('/insights', async (req, res) => {
  try {
    const { prompt, category, mode } = req.body;
    const isChat = mode === 'chat';

    let knowledge = '';
    try {
      const cat = category || 'Analyse a property';
      knowledge = await Promise.race([
        fetchKnowledge(cat),
        new Promise(resolve => setTimeout(() => resolve(''), 15000))
      ]) || '';
      if (knowledge) console.log('Knowledge loaded:', knowledge.length, 'chars for', cat);
    } catch(kErr) { knowledge = ''; }

    if (isChat && !knowledge) {
      return res.json({ answer: 'I am not able to access my knowledge base right now. Please try again in a moment.' });
    }

    const sysPrompt = isChat
      ? 'You are VERA, a Canadian multifamily real estate investment assistant. Use the knowledge base as your primary source, but also use web search for current market data, and your own knowledge of Canadian cities, streets, and neighbourhoods to answer questions. Never deflect to Google Maps or suggest the user find someone else — just answer directly and specifically.' + (knowledge ? '\n\n=== KNOWLEDGE BASE ===\n' + knowledge : '')
      : 'You are VERA, a real estate investment assistant. Use web search to find current, real data rather than relying on memory — this matters for market statistics like population, income, and pricing, which change over time. Answer in plain conversational text. Be specific and practical.' + (knowledge ? '\n\n=== KNOWLEDGE BASE ===\n' + knowledge : '');

    const msgs = [{ role: 'user', content: prompt }];
    let data;
    let attempts = 0;
    while (attempts < 4) {
      attempts++;
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 8192,
          system: sysPrompt,
          messages: msgs,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }]
        })
      });
      data = await response.json();
      if (data.error) throw new Error(data.error.message);
      if (data.stop_reason !== 'tool_use') break;
      msgs.push({ role: 'assistant', content: data.content });
      const toolResults = data.content.filter(b => b.type === 'tool_use').map(b => ({ type: 'tool_result', tool_use_id: b.id, content: 'Search completed.' }));
      msgs.push({ role: 'user', content: toolResults });
    }

    const txt = data.content?.find(b => b.type === 'text')?.text || '';

    if (isChat || mode === 'market') {
      res.json({ answer: txt });
    } else {
      const m = txt.match(/\{[\s\S]*\}/);
      if (!m) { res.json({ answer: txt }); return; }
      res.json(JSON.parse(m[0]));
    }
  } catch (err) {
    console.error('Insights error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/get-knowledge', async (req, res) => {
  try {
    const category = req.query.category || 'Find a Market';
    const knowledge = await Promise.race([
      fetchKnowledge(category),
      new Promise(resolve => setTimeout(() => resolve(''), 12000))
    ]) || '';
    res.json({ text: knowledge, chars: knowledge.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/get-analyses', async (req, res) => {
  try {
    const email = req.query.email || '';
    const response = await fetch(APPS_URL + '?action=getAnalyses&email=' + encodeURIComponent(email), { redirect: 'follow' });
    const text = await response.text();
    const raw = JSON.parse(text);
    const data = raw.map(r => {
      const units = Number(r.units) || 1;
      const capRate = Number(r.capRate) || 0;
      const capPct = capRate * 100;
      const totalROI = Number(r.totalROI) || 0;
      return {
        addr: r.addr || '', city: r.city || '', neighbourhood: r.neighbourhood || '',
        date: r.date || '', units, type: units===1?'Single':units===2?'Duplex':units===3?'Triplex':'Fourplex',
        asking: Number(r.asking)||0, capRate: capPct, cashflow: Number(r.cashflow)||0,
        coc: Number(r.coc)||0, totalROI: totalROI*100, cashToClose: Number(r.cashToClose)||0,
        verdict: capPct>=5?'turnkey':capPct>=3?'brrrr':'nogo',
        confidence: 75, missing: [], pdfUrl: r.pdfUrl||''
      };
    });
    res.json(data);
  } catch (err) {
    console.error('get-analyses error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/save-listing', async (req, res) => {
  try {
    const { email, listing } = req.body;
    const url = APPS_URL + '?action=saveListing&email=' + encodeURIComponent(email) +
      '&addr=' + encodeURIComponent(listing.addr || '') +
      '&price=' + encodeURIComponent(listing.price || 0) +
      '&type=' + encodeURIComponent(listing.type || '') +
      '&city=' + encodeURIComponent(listing.city || '') +
      '&description=' + encodeURIComponent((listing.description || '').substring(0, 500)) +
      '&listingUrl=' + encodeURIComponent(listing.url || '');
    const resp = await fetch(url, { redirect: 'follow' });
    res.json(await resp.json());
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/search-kijiji', async (req, res) => {
  try {
    const { region, type, maxPrice } = req.query;
    const types = (type === 'duplex-triplex' || type === 'all') ? ['duplex', 'triplex'] : [type || 'duplex'];
    const LOCATION_IDS = {
      'new-brunswick': 'l9059', 'nova-scotia': 'l9062', 'prince-edward-island': 'l9063',
      'newfoundland': 'l9060', 'city-of-toronto': 'l1700273', 'gta-greater-toronto-area': 'l1700272',
      'mississauga-peel-region': 'l1700276', 'hamilton': 'l80014', 'ottawa': 'l1700185',
      'london': 'l1700214', 'kitchener-waterloo': 'l1700212', 'windsor-ontario': 'l1700255',
      'kingston-ontario': 'l1700209', 'ontario': 'l9004', 'montreal-nord-du-montreal': 'l1700281',
      'quebec-city': 'l1700282', 'quebec': 'l9055', 'calgary': 'l1700199', 'edmonton': 'l1700203',
      'alberta': 'l9003', 'vancouver': 'l1700227', 'victoria-bc': 'l1700228', 'british-columbia': 'l9007',
      'winnipeg': 'l1700192', 'manitoba': 'l9008', 'saskatoon': 'l1700239', 'regina': 'l1700238',
      'saskatchewan': 'l9056', 'canada': 'l0'
    };
    const locationId = LOCATION_IDS[region] || 'l0';
    const maxPriceNum = maxPrice ? parseInt(maxPrice) : 0;
    let allListings = [];
    for (const t of types) {
      const url = `https://www.kijiji.ca/b-house-for-sale/${region}/${t}/k0c35${locationId}`;
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html', 'Accept-Language': 'en-CA' } });
      const html = await resp.text();
      const linkRe = /href="(\/v-house-for-sale\/[^"]+)"/g;
      const priceRe = /\$\s*([0-9,]+)(?:\.00)?/g;
      const urls = new Set();
      const prices = [];
      let m;
      while ((m = linkRe.exec(html)) !== null) {
        if (!m[1].includes('?') && m[1].split('/').length >= 5) urls.add('https://www.kijiji.ca' + m[1]);
      }
      while ((m = priceRe.exec(html)) !== null) {
        const p = parseInt(m[1].replace(/,/g, ''));
        if (p >= 50000) prices.push(p);
      }
      let i = 0;
      for (const listingUrl of urls) {
        const price = prices[i] || 0;
        if (maxPriceNum > 0 && price > maxPriceNum) { i++; continue; }
        allListings.push({ url: listingUrl, price, addr: listingUrl.split('/').slice(-2,-1)[0].replace(/-/g,' '), type: t, city: region, description: '', dateFound: new Date().toLocaleDateString('en-CA',{month:'short',day:'numeric',year:'numeric'}), status: 'New' });
        if (++i >= 20) break;
      }
    }
    res.json(allListings);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/fetch-listing-text', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html', 'Accept-Language': 'en-CA' } });
    const html = await resp.text();
    const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().substring(0, 8000);
    res.json({ text, url });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/save-search', async (req, res) => {
  try {
    const { email, city, propertyType, maxPrice } = req.body;
    const url = APPS_URL + '?action=saveSearch&email=' + encodeURIComponent(email) + '&city=' + encodeURIComponent(city) + '&propertyType=' + encodeURIComponent(propertyType) + '&maxPrice=' + encodeURIComponent(maxPrice || '');
    const resp = await fetch(url, { redirect: 'follow' });
    res.json(await resp.json());
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/get-listings', async (req, res) => {
  try {
    const email = req.query.email || '';
    const url = APPS_URL + '?action=getListings&email=' + encodeURIComponent(email);
    const resp = await fetch(url, { redirect: 'follow' });
    res.json(await resp.json());
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/mark-viewed', async (req, res) => {
  try {
    const { email, listingUrl } = req.body;
    const url = APPS_URL + '?action=markViewed&email=' + encodeURIComponent(email) + '&url=' + encodeURIComponent(listingUrl);
    await fetch(url, { redirect: 'follow' });
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/build-team', async (req, res) => {
  try {
    const { city } = req.body;
    const roles = ['Real Estate Agent','Real Estate Lawyer','Home Inspector','Insurance Agent'];
    async function searchRole(role) {
      const prompt = 'Search Google to find 3 to 5 real ' + role + ' professionals in ' + city + ', Canada who specialize in rental properties or real estate investment. Find their actual phone number, email, and website. Return JSON only: {"professionals":[{"name":"","company":"","phone":"","email":"","website":"","specialization":"","strength":"","years":"","recommended":false}],"referral_tip":"","recommendation":""}. Mark the best one recommended true.';
      const msgs = [{ role: 'user', content: prompt }];
      let d;
      let attempts = 0;
      while (attempts < 4) {
        attempts++;
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1200, system: 'Search the web then return only valid JSON. No markdown.', messages: msgs, tools: [{ type: 'web_search_20250305', name: 'web_search' }] })
        });
        d = await r.json();
        if (d.error) throw new Error(d.error.message);
        if (d.stop_reason !== 'tool_use') break;
        msgs.push({ role: 'assistant', content: d.content });
        const toolResults = d.content.filter(b => b.type === 'tool_use').map(b => ({ type: 'tool_result', tool_use_id: b.id, content: 'Search completed.' }));
        msgs.push({ role: 'user', content: toolResults });
      }
      const txt = d.content?.find(b => b.type === 'text')?.text || '';
      const m = txt.match(/\{[\s\S]*\}/);
      if (!m) return { role, professionals: [], referral_tip: '', recommendation: '' };
      const parsed = JSON.parse(m[0]);
      return { role, professionals: parsed.professionals || [], referral_tip: parsed.referral_tip || '', recommendation: parsed.recommendation || '' };
    }
    const results = await Promise.allSettled(roles.map(role => searchRole(role)));
    const allRoles = results.map((r, i) => r.status === 'fulfilled' ? r.value : { role: roles[i], professionals: [], referral_tip: '', recommendation: '' });
    res.json({ city, roles: allRoles });
  } catch(err) {
    console.error('Build team error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/save-market', async (req, res) => {
  try {
    const { email, city, province, neighbourhood, cls, condition } = req.body;
    const url = APPS_URL + '?action=saveMarket&email=' + encodeURIComponent(email) +
      '&city=' + encodeURIComponent(city || '') + '&province=' + encodeURIComponent(province || '') +
      '&neighbourhood=' + encodeURIComponent(neighbourhood || '') + '&cls=' + encodeURIComponent(cls || '') +
      '&condition=' + encodeURIComponent(condition || 'BRRRR');
    const resp = await fetch(url, { redirect: 'follow' });
    res.json(await resp.json());
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/get-market', async (req, res) => {
  try {
    const email = req.query.email || '';
    const url = APPS_URL + '?action=getMarket&email=' + encodeURIComponent(email);
    const resp = await fetch(url, { redirect: 'follow' });
    res.json(await resp.json());
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────
// FIXED: /find-realtors — max_tokens raised 2000 → 4096 (was
// truncating mid-JSON with a rich 3-5 realtor response), plus a
// repair fallback if a response is ever cut off anyway, plus a
// "keep concise" instruction to reduce truncation risk in general.
// ─────────────────────────────────────────────────────────────
app.post('/find-realtors', async (req, res) => {
  try {
    const { city, neighbourhood, condition } = req.body;
    const location = neighbourhood ? neighbourhood + ', ' + city : city;
    const investmentFocus = condition === 'BRRRR' ? 'BRRRR strategy and value-add' : 'turnkey rental';
    const prompt = 'I am a real estate investor looking to find an investor-friendly real estate agent in ' + location + ', Canada specializing in ' + investmentFocus + ' properties. Search Google to find 3 to 5 real options. For each include: name, company, years of experience, specialization, investment clients served last year, known strengths, response time, fees, online presence, phone, email, website. Also provide: best for new investor and referral strategies. Return JSON only: {"realtors":[{"name":"","company":"","phone":"","email":"","website":"","years":"","specialization":"","investment_clients":"","strengths":"","response_time":"","fees":"","reviews":"","recommended":false}],"recommendation":"","referral_tip":""}. Mark best one recommended true. Keep every field concise — a short phrase, not a paragraph.';
    const msgs = [{ role: 'user', content: prompt }];
    let d; let attempts = 0;
    while (attempts < 4) {
      attempts++;
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          system: 'Search the web then return only valid JSON. No markdown.',
          messages: msgs,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }]
        })
      });
      d = await r.json();
      if (d.error) throw new Error(d.error.message);
      if (d.stop_reason !== 'tool_use') break;
      msgs.push({ role: 'assistant', content: d.content });
      const toolResults = d.content.filter(b => b.type === 'tool_use').map(b => ({ type: 'tool_result', tool_use_id: b.id, content: 'Search completed.' }));
      msgs.push({ role: 'user', content: toolResults });
    }
    const txt = d.content?.find(b => b.type === 'text')?.text || '';
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('No results found');

    let parsed;
    try {
      parsed = JSON.parse(m[0]);
    } catch (parseErr) {
      console.warn('find-realtors: JSON parse failed, attempting repair:', parseErr.message);
      let repaired = m[0];
      const lastCompleteObj = repaired.lastIndexOf('},');
      if (lastCompleteObj > -1) {
        repaired = repaired.substring(0, lastCompleteObj + 1) + ']}';
        try {
          parsed = JSON.parse(repaired);
          console.warn('find-realtors: repair succeeded, some results may be truncated');
        } catch (repairErr) {
          throw new Error('AI response was cut off and could not be repaired — try again');
        }
      } else {
        throw new Error('AI response was cut off and could not be repaired — try again');
      }
    }

    res.json(parsed);
  } catch(err) {
    console.error('Find realtors error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/extract-pdf', async (req, res) => {
  try {
    const { pdf, password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4096, messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } }, { type: 'text', text: 'Extract all text from this document.' }] }] })
    });
    const data = await response.json();
    res.json({ text: data.content?.find(b => b.type === 'text')?.text || '' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────
// VERA proxy — /extract-financials route
// ─────────────────────────────────────────────────────────────

const FINANCIALS_SYSTEM = `You are a financial document reader for a Canadian mortgage qualification tool. You will be shown one or more documents — pay stubs, T4s, Notices of Assessment, bank statements, investment/RRSP statements, loan/credit statements, or a credit report. Extract ONLY what is actually stated or clearly derivable from the documents. NEVER invent or force a number that isn't supported by what's shown. If something isn't clearly present, use null.

Return ONLY valid JSON, no markdown, no code fences:
{
  "grossAnnualIncome": number or null — total gross (pre-tax) annual income, combining all income documents shown (pay stubs annualized, T4 box 14, NOA line 15000, self-employment net income) plus any recurring deposits clearly identifiable as income on a bank statement,
  "monthlyExpenses": number or null — your best estimate of average monthly living expenses, based on outgoing transactions visible on a bank statement with itemized transaction detail (excluding debt payments already captured elsewhere, and excluding any amount being saved or invested). If only a balance summary is shown with no transaction detail, use null and say so in notes,
  "totalAssets": number or null — sum of liquid balances shown across bank, investment, and RRSP statements,
  "monthlyDebtPayments": number or null — sum of all recurring monthly debt obligations found (car loans, credit card minimum payments, student loans, lines of credit) — do NOT include rent or the mortgage being applied for,
  "availableDownPayment": number or null — funds specifically identifiable as available for a down payment, from bank/investment statements shown. If documents don't distinguish down-payment funds from general assets, use the same figure as totalAssets,
  "creditScore": number or null — the credit score shown on a credit report (Equifax or TransUnion), if one of the documents is a credit report,
  "documentsSeen": [ { "name": "filename as given", "recognizedType": "e.g. Pay stub, T4, NOA, Bank statement, Investment statement, Credit card statement, Credit report, Unrecognized" } ],
  "notes": "one short sentence flagging anything uncertain or missing that would affect accuracy, or empty string if nothing to flag"
}

Be conservative: if a document is blurry, partial, or ambiguous, do not guess — reflect that in "notes" instead of forcing a number. Expenses in particular require real transaction-level detail to estimate honestly — a balance-only statement is not enough.`;

app.post('/extract-financials', async (req, res) => {
  try {
    const { documents } = req.body; // [{ name, mimeType, base64 }]
    if (!documents || !Array.isArray(documents) || !documents.length) {
      return res.status(400).json({ error: 'No documents provided' });
    }
    if (documents.length > 10) {
      return res.status(400).json({ error: 'Too many documents in one request — please select 10 or fewer' });
    }

    const content = [];
    documents.forEach(function(doc) {
      if (doc.mimeType === 'application/pdf') {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: doc.base64 } });
      } else if (doc.mimeType && doc.mimeType.indexOf('image/') === 0) {
        content.push({ type: 'image', source: { type: 'base64', media_type: doc.mimeType, data: doc.base64 } });
      }
      content.push({ type: 'text', text: 'The document above is named: ' + doc.name });
    });
    content.push({ type: 'text', text: 'Now extract the financial data as instructed.' });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: FINANCIALS_SYSTEM,
        messages: [{ role: 'user', content: content }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('extract-financials: Anthropic API error', response.status, errText);
      return res.status(502).json({ error: 'Upstream AI request failed (' + response.status + ')' });
    }

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const txt = data.content?.find(function(b) { return b.type === 'text'; })?.text || '';
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Could not extract financial data from the documents provided');
    res.json(JSON.parse(m[0]));

  } catch (err) {
    console.error('extract-financials error:', err.message);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

app.get('/', (req, res) => res.json({ status: 'VERA proxy running' }));
app.listen(process.env.PORT || 3000, () => console.log('Proxy started'));
