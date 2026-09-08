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

IMPORTANT — PropertyUsage: this tool is used by investors buying purely as a rental investment. Default to "Full rental" in every case. Only use "Owner-occupied duplex"/"Owner-occupied triplex" if the person pasting the listing explicitly states THEY THEMSELVES plan to live in one of the units — this must come from their own note, never from the listing text. A listing describing the property as "ideal for owner occupancy," "great for an owner-occupier," or similar is marketing language about the property's general suitability for *some* hypothetical buyer — it says nothing about this specific buyer's actual plans, and must NOT be treated as evidence for "Owner-occupied duplex"/"Owner-occupied triplex". When in doubt, use "Full rental".

IMPORTANT — AsIsRent fields (current, actual rent only): AsIsRent1-4 must reflect the rent actually being collected TODAY, not a hypothetical, estimated, market, or post-renovation figure. Listings routinely describe upside potential using phrases like "could rent for," "estimated rent," "market rent is," "each unit could fetch," or "approximate income based on" — these describe what the property MIGHT earn, not what it currently earns, and must NOT be used for AsIsRent. Use these three rules in order:
1. If the listing states an actual current rent being paid today (e.g. "currently rents for," "tenant pays," "rented at," an explicit current lease amount), use that figure.
2. If the listing indicates the unit is, or will be, VACANT — including "building can be vacant on closing," "vacant possession," family/related-party tenants likely not paying market rate, or a property described as needing renovation before it can be rented at the stated potential — set AsIsRent to 0, not null. A vacant or not-yet-rentable unit has zero actual current income; this is a confident fact, not a guess, even when a hypothetical post-renovation rent is also mentioned elsewhere in the listing.
3. Only if the listing gives neither a current rent nor any vacancy/condition signal — genuinely no information either way — set AsIsRent to null.
Never substitute a "could rent for" or similar potential figure into AsIsRent under any of these three cases. Treating an aspirational number as today's actual income is a serious error: it makes a property that genuinely needs renovation and a rent increase look like it already performs at that level today.

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
// VERA proxy — NEW route: /record-signup
// Forwards to Apps Script's recordSignup action.
// ─────────────────────────────────────────────────────────────
app.post('/record-signup', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    const response = await fetch(APPS_URL, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'recordSignup', email: email })
    });
    const text = await response.text();
    res.json(JSON.parse(text));
  } catch (err) {
    console.error('record-signup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// VERA proxy — refinance-projection
// ─────────────────────────────────────────────────────────────
app.post('/refinance-projection', async (req, res) => {
  try {
    const { arv } = req.body;
    if (!arv) return res.status(400).json({ error: 'arv is required' });
    const response = await fetch(APPS_URL, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'refinanceProjection', arv: arv })
    });
    const text = await response.text();
    res.json(JSON.parse(text));
  } catch (err) {
    console.error('refinance-projection error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// VERA proxy — /extract-financials route
// ─────────────────────────────────────────────────────────────

const FINANCIALS_SYSTEM = `You are a financial document reader for a Canadian mortgage qualification tool. You will be shown one or more documents — pay stubs, T4s, Notices of Assessment, bank statements, investment/RRSP statements, loan/credit statements, a credit report, or a budget app's category expense summary. Extract ONLY what is actually stated or clearly derivable from the documents. NEVER invent or force a number that isn't supported by what's shown. If something isn't clearly present, use null.

IMPORTANT on income sources: a pay stub or T4 is ALWAYS employment income — put its net pay figure in "employmentIncome", never leave it uncategorized. Only use "sideIncome" for freelance/investment/business income, and "otherIncome" for alimony/child support/pensions/government benefits. grossAnnualIncome MUST be calculated as (employmentIncome + sideIncome + otherIncome) × 12 — never return a grossAnnualIncome total without also populating whichever specific source(s) it came from.

IMPORTANT on expenses — reading a budget app's category summary: this is a clean table or list of category names with amounts (e.g. "Groceries: $487", "Dining Out: $120"), usually for a specific month or period, NOT a raw bank statement transaction list. Read every row. Map the budget app's own category names to the closest match in the allowed list below — e.g. "Food & Dining" or "Dining Out" → Restaurant, "Housing" or "Rent/Mortgage" → Rent, "Health & Fitness" → Gym or Health depending on what's clearly meant, "Subscriptions" → Membership. If a document shows a specific month or date range, use that month; if unclear, use the most reasonable single month it represents. Each category row becomes ONE transaction entry with that category's full amount — do not attempt to break a category total back down into individual purchases.

Be conservative about NUMBERS: if a document is blurry, partial, or ambiguous, do not guess a number — reflect that in "notes" instead.

Return ONLY valid JSON, no markdown, no code fences:
{
  "employmentIncome": number or null — monthly salary or wages from a primary job, from pay stubs or T4,
  "sideIncome": number or null — monthly income from freelance work, investments, or a side business, if shown,
  "otherIncome": number or null — monthly alimony, child support, pensions, or government benefits, if shown,
  "grossAnnualIncome": number or null — (employmentIncome + sideIncome + otherIncome) × 12. If none of the three sources above could be populated, this must also be null — do not report a total with no source behind it,
  "monthlyExpenses": number or null — the total monthly expense figure, if the budget app summary shows one directly (its own grand total),
  "totalAssets": number or null — sum of liquid balances shown across bank, investment, and RRSP statements,
  "monthlyDebtPayments": number or null — sum of all recurring monthly debt obligations found (car loans, credit card minimum payments, student loans, lines of credit) — do NOT include rent or the mortgage being applied for,
  "availableDownPayment": number or null — funds specifically identifiable as available for a down payment, from bank/investment statements shown. If documents don't distinguish down-payment funds from general assets, use the same figure as totalAssets,
  "creditScore": number or null — the credit score shown on a credit report (Equifax or TransUnion), if one of the documents is a credit report,
  "transactions": [
    {
      "category": "one of: Groceries, Restaurant, Hair, Transportation, Health, Entertainment, Professional dues, Membership, Gym, Utilities, Rent, Gifts, School, Shopping, Trip, Other",
      "type": "Expense",
      "month": "3-letter or matching abbreviation: Jan, Feb, Mar, Apr, May, Jun, July, Aug, Sept, Oct, Nov, Dec — the month this category total represents",
      "amount": number — the category's full amount for that month, as shown in the budget app summary
    }
  ] — one entry per category per month shown in the budget app summary. If multiple months' summaries are provided, include one row per category per month,
  "statementTotals": [
    {
      "documentName": "filename as given",
      "totalDebits": number or null — this document's own stated grand total, if it shows one, used to sanity-check that the category rows add up correctly
    }
  ] — one entry per document shown,
  "documentsSeen": [ { "name": "filename as given", "recognizedType": "e.g. Pay stub, T4, NOA, Bank statement, Investment statement, Credit card statement, Credit report, Budget app summary, Unrecognized" } ],
  "notes": "one short sentence flagging anything uncertain or missing that would affect accuracy, or empty string if nothing to flag"
}`;

app.post('/extract-financials', async (req, res) => {
  try {
    const { documents } = req.body;
    if (!documents || !Array.isArray(documents) || !documents.length) {
      return res.status(400).json({ error: 'No documents provided' });
    }
    if (documents.length > 15) {
      return res.status(400).json({ error: 'Too many documents in one request — please select 15 or fewer' });
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
        max_tokens: 4096,
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

    let parsed;
    try {
      parsed = JSON.parse(m[0]);
    } catch (parseErr) {
      console.warn('extract-financials: JSON parse failed, attempting repair:', parseErr.message);
      let repaired = m[0];
      const lastCompleteEntry = repaired.lastIndexOf('},');
      if (lastCompleteEntry > -1) {
        repaired = repaired.substring(0, lastCompleteEntry + 1);
        const openBraces = (repaired.match(/{/g)||[]).length - (repaired.match(/}/g)||[]).length;
        const openBrackets = (repaired.match(/\[/g)||[]).length - (repaired.match(/\]/g)||[]).length;
        for (let i = 0; i < openBrackets; i++) repaired += ']';
        for (let i = 0; i < openBraces; i++) repaired += '}';
        try {
          parsed = JSON.parse(repaired);
          console.warn('extract-financials: repair succeeded, some data may be missing');
        } catch (repairErr) {
          throw new Error('AI response was cut off and could not be repaired — try selecting fewer documents');
        }
      } else {
        throw new Error('AI response was cut off and could not be repaired — try selecting fewer documents');
      }
    }

    res.json(parsed);

  } catch (err) {
    console.error('extract-financials error:', err.message);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});
// ─────────────────────────────────────────────────────────────
// VERA proxy — NEW route: /update-gds-tds
// ─────────────────────────────────────────────────────────────

app.post('/update-gds-tds', async (req, res) => {
  try {
    const {
      email,
      applicant1Income, applicant2Income, childSupport, alimony, sideHustle, rentalIncome1, rentalIncome2,
      mortgagePayment, propertyTaxes, heatingCosts, condoFees,
      carLoan, studentLoan, creditCardPayments, rentalProperty1Mortgage, rentalProperty2Mortgage, otherDebtPayments,
      expectedAnnualRentalIncome, expectedMonthlyPropertyTaxes, expectedMonthlyHeatingCosts, expectedMonthlyCondoFees
    } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    const response = await fetch(APPS_URL, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'updateGdsTds',
        email: email,
        applicant1Income: applicant1Income || 0,
        applicant2Income: applicant2Income || 0,
        childSupport: childSupport || 0,
        alimony: alimony || 0,
        sideHustle: sideHustle || 0,
        rentalIncome1: rentalIncome1 || 0,
        rentalIncome2: rentalIncome2 || 0,
        mortgagePayment: mortgagePayment || 0,
        propertyTaxes: propertyTaxes || 0,
        heatingCosts: heatingCosts || 0,
        condoFees: condoFees || 0,
        carLoan: carLoan || 0,
        studentLoan: studentLoan || 0,
        creditCardPayments: creditCardPayments || 0,
        rentalProperty1Mortgage: rentalProperty1Mortgage || 0,
        rentalProperty2Mortgage: rentalProperty2Mortgage || 0,
        otherDebtPayments: otherDebtPayments || 0,
        expectedAnnualRentalIncome: expectedAnnualRentalIncome != null ? expectedAnnualRentalIncome : 12000,
        expectedMonthlyPropertyTaxes: expectedMonthlyPropertyTaxes != null ? expectedMonthlyPropertyTaxes : 300,
        expectedMonthlyHeatingCosts: expectedMonthlyHeatingCosts != null ? expectedMonthlyHeatingCosts : 100,
        expectedMonthlyCondoFees: expectedMonthlyCondoFees != null ? expectedMonthlyCondoFees : 0
      })
    });
    const text = await response.text();
    res.json(JSON.parse(text));
  } catch (err) {
    console.error('update-gds-tds error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// VERA proxy — NEW route: /update-income-expenses
// ─────────────────────────────────────────────────────────────
app.post('/update-income-expenses', async (req, res) => {
  try {
    const { email, expenseTransactions, salaryByMonth, otherIncomeByMonth } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    const response = await fetch(APPS_URL, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'updateIncomeExpenses',
        email: email,
        expenseTransactions: expenseTransactions || [],
        salaryByMonth: salaryByMonth || {},
        otherIncomeByMonth: otherIncomeByMonth || {}
      })
    });
    const text = await response.text();
    res.json(JSON.parse(text));
  } catch (err) {
    console.error('update-income-expenses error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'VERA proxy running' }));
app.listen(process.env.PORT || 3000, () => console.log('Proxy started'));


// ─────────────────────────────────────────────────────────────
// VERA proxy — NEW route: /search-properties
//
// Uses Claude's built-in web search tool to find real, current
// listings matching the user's saved criteria — searching public,
// already-crawlable sites (Kijiji, REW.ca, brokerage sites, etc.),
// the same category of source Google itself surfaces. This is NOT
// a scraper hitting any site's servers directly, and it is NOT MLS
// data — it's a search, same as a person typing the query into
// Google themselves, just automated and summarized.
//
// Requires ANTHROPIC_API_KEY to already be set in your environment
// (same one your /extract and /insights routes already use).
// ─────────────────────────────────────────────────────────────
app.post('/search-properties', async (req, res) => {
  try {
    const {
      city, propertyType, condition, conditionKey, priceMin, priceMax,
      neighborhoods, bedrooms, parking, lotSize
    } = req.body;

    if (!city) return res.status(400).json({ error: 'city is required' });

    const criteriaLines = [
      `City: ${city}`,
      propertyType ? `Property type(s): ${propertyType}` : null,
      priceMin || priceMax ? `Price range: ${priceMin ? '$'+Number(priceMin).toLocaleString() : 'no min'} to ${priceMax ? '$'+Number(priceMax).toLocaleString() : 'no max'}` : null,
      neighborhoods ? `Preferred neighbourhoods: ${neighborhoods}` : null,
      bedrooms ? `Bedrooms: ${bedrooms}` : null,
      parking ? `Parking: ${parking}` : null,
      lotSize ? `Lot size / outdoor space: ${lotSize}` : null,
      condition ? `Condition preference: ${condition}` : null
    ].filter(Boolean).join('\n');

    const focusInstruction = conditionKey === 'valueadd'
      ? '\n\nThe user specifically wants VALUE-ADD / BRRRR POTENTIAL properties only — focus your search on properties needing updates, below-market rents, or renovation potential. Do not return turnkey/move-in-ready properties.'
      : conditionKey === 'turnkey'
      ? '\n\nThe user specifically wants TURNKEY POTENTIAL properties only — focus your search on move-in ready properties with minimal work needed. Do not return properties needing significant renovation.'
      : '';

    const SEARCH_SYSTEM = `You are a real estate search assistant. Search the public web for CURRENT, REAL property listings matching the given criteria. Only include listings you actually find via search — never invent or guess at a listing that didn't appear in your search results.

IMPORTANT — availability: only return properties that are currently ACTIVE and available for purchase. If a source page indicates a property is Sold, Pending, Under Contract, or otherwise no longer available, EXCLUDE it entirely — do not include it in the results at all.

IMPORTANT — price: many listings omit price from search snippets. Make a genuine effort to find the actual asking price by checking the listing page itself, not just the snippet. Only leave price null if you genuinely cannot find it after trying — do not guess or estimate a price.

IMPORTANT — strategyBucket: classify each listing as exactly one of "BRRRR Potential" or "Turnkey Potential", based on the listing's actual stated condition and rent-to-price ratio. Only an actual analysis and property walkthrough can confirm which one a property truly is — this is a preliminary read, so the word "Potential" always matters here, never drop it or state either as confirmed fact.

After searching, respond with ONLY a JSON object (no other text, no markdown fences) in exactly this shape:
{
  "listings": [
    {
      "address": "string — the address or general location as stated in the listing, or \\"Location not disclosed\\" if the source doesn't give one",
      "price": number or null,
      "propertyType": "string — e.g. Duplex, Triplex, Fourplex, or whatever the listing states",
      "status": "string — one of: Active, Unknown (never include Sold/Pending listings at all, per the instruction above)",
      "strategyBucket": "string — exactly \\"BRRRR Potential\\" or \\"Turnkey Potential\\"",
      "description": "string — a brief 1-2 sentence paraphrase in your own words, never a verbatim copy of the listing text",
      "sourceUrl": "string — the actual URL where you found this listing",
      "sourceName": "string — e.g. Kijiji, REW.ca, Realtor.ca, or the brokerage site name"
    }
  ],
  "searchSummary": "string — one sentence on what was searched for and roughly how many relevant results were found"
}

If you find no matching listings at all, return {"listings": [], "searchSummary": "..."} explaining that plainly. Never fabricate a listing to fill space. Limit to the 8 most relevant results.`;

    const userMsg = `Find current property listings matching these criteria:\n\n${criteriaLines}${focusInstruction}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: SEARCH_SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(500).json({ error: 'Search API error: ' + errText.slice(0, 300) });
    }

    const data = await response.json();

    // Final text response is in the last text-type content block —
    // tool_use / server_tool_use / web_search_tool_result blocks come
    // before it when the model actually searched.
    const textBlocks = (data.content || []).filter(b => b.type === 'text');
    const rawText = textBlocks.length ? textBlocks[textBlocks.length - 1].text : '';

    let parsed;
    try {
      parsed = JSON.parse(rawText.trim());
    } catch (parseErr) {
      // Same repair pattern as extract-financials — strip markdown fences
      // or leading/trailing junk the model might have added despite instructions.
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      try {
        parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch (repairErr) {
        return res.status(500).json({ error: 'Could not parse search results', raw: rawText.slice(0, 500) });
      }
    }

    if (!parsed.listings) parsed.listings = [];
    res.json({ success: true, ...parsed });

  } catch (err) {
    console.error('search-properties error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
