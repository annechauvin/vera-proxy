const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const APPS_URL = 'https://script.google.com/macros/s/AKfycbx8GaIdXWbDkTrqlcgM5kvGX_iMIYfKxl8Z8udZAV9n_kDDYZo9QHPiC99M8jAdEdfW/exec';

// ── Fetch knowledge from Google Sheet ──
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

// ── Knowledge base (file-based fallback) ──
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

// ── Extract listing ──
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

// ── Send to Apps Script calculator ──
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

// ── VERA Insights + Chat ──
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
      ? 'You are VERA, a Canadian multifamily real estate investment assistant. Answer ONLY using the knowledge base provided. Be specific and practical. Plain conversational text only.' + (knowledge ? '\n\n=== KNOWLEDGE BASE ===\n' + knowledge : '')
      : 'You are VERA, a real estate investment assistant trained by Anne Chauvin. Answer in plain conversational text. Be specific and practical.' + (knowledge ? '\n\n=== KNOWLEDGE BASE ===\n' + knowledge : '');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2048, system: sysPrompt, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
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

// ── Get knowledge by category ──
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

// ── Get user analyses ──
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

// ── Save listing ──
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
    const data = await resp.json();
    res.json(data);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Search Kijiji ──
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

// ── Fetch listing text ──
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

// ── Save search criteria ──
app.post('/save-search', async (req, res) => {
  try {
    const { email, city, propertyType, maxPrice } = req.body;
    const url = APPS_URL + '?action=saveSearch&email=' + encodeURIComponent(email) + '&city=' + encodeURIComponent(city) + '&propertyType=' + encodeURIComponent(propertyType) + '&maxPrice=' + encodeURIComponent(maxPrice || '');
    const resp = await fetch(url, { redirect: 'follow' });
    res.json(await resp.json());
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Get listings ──
app.get('/get-listings', async (req, res) => {
  try {
    const email = req.query.email || '';
    const url = APPS_URL + '?action=getListings&email=' + encodeURIComponent(email);
    const resp = await fetch(url, { redirect: 'follow' });
    res.json(await resp.json());
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Mark viewed ──
app.post('/mark-viewed', async (req, res) => {
  try {
    const { email, listingUrl } = req.body;
    const url = APPS_URL + '?action=markViewed&email=' + encodeURIComponent(email) + '&url=' + encodeURIComponent(listingUrl);
    await fetch(url, { redirect: 'follow' });
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Build team ──
app.post('/build-team', async (req, res) => {
  try {
    const { city } = req.body;
    const roles = ['Real Estate Agent','Mortgage Broker or Agent','Insurance Agent','Real Estate Lawyer','Home Inspector','Contractor','Property Manager'];
    const allRoles = [];

    for (const role of roles) {
      const prompt = `I am a real estate investor in ${city}, Canada. Give me 3 to 5 ${role} options who work with investment properties.

For each, provide exactly:
NAME: [name]
YEARS: [years of experience]
SPECIALIZATION: [e.g. investment properties, multi-family, BRRRR]
CLIENTS: [investment clients per year]
STRENGTHS: [key strength]
AVAILABILITY: [response time]
FEES: [fee structure]
REVIEWS: [online presence or rating]
RECOMMENDED: [yes or no]
---

After the list add:
BEST FOR NEW INVESTOR: [who and why]
REFERRAL TIP: [how to get referrals from this type of professional]`;

      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1500, system: 'You are a Canadian real estate team researcher. Follow the exact format. Plain text only.', messages: [{ role: 'user', content: prompt }] })
        });
        const d = await r.json();
        const txt = d.content?.find(b => b.type === 'text')?.text || '';
        const professionals = [];
        const blocks = txt.split('---').filter(b => b.trim());
        for (const block of blocks) {
          const pro = {};
          for (const line of block.trim().split('\n')) {
            const colonIdx = line.indexOf(':');
            if (colonIdx === -1) continue;
            const k = line.substring(0, colonIdx).trim().toUpperCase();
            const v = line.substring(colonIdx + 1).trim();
            if (k === 'NAME') pro.name = v;
            else if (k === 'YEARS') pro.years = v;
            else if (k === 'SPECIALIZATION') pro.specialization = v;
            else if (k === 'CLIENTS') pro.investment_clients = v;
            else if (k === 'STRENGTHS') pro.strengths = v;
            else if (k === 'AVAILABILITY') pro.response_time = v;
            else if (k === 'FEES') pro.fees = v;
            else if (k === 'REVIEWS') pro.online = v;
            else if (k === 'RECOMMENDED') pro.recommended = v.toLowerCase().startsWith('yes');
          }
          if (pro.name) professionals.push(pro);
        }
        const bestMatch = txt.match(/BEST FOR NEW INVESTOR[:\s]+([^\n]+)/i);
        const referralMatch = txt.match(/REFERRAL TIP[:\s]+([^\n]+)/i);
        allRoles.push({ role, search_tip: 'Search: investor ' + role + ' ' + city, recommendation: bestMatch ? bestMatch[1].trim() : '', referral_tip: referralMatch ? referralMatch[1].trim() : '', professionals: professionals.slice(0, 5) });
      } catch(e) {
        allRoles.push({ role, search_tip: '', recommendation: '', referral_tip: '', professionals: [] });
      }
    }

    res.json({ city, roles: allRoles, top_picks_summary: 'Top picks selected for investment experience in ' + city + '.', referral_strategy: 'Start with your realtor and mortgage agent — they anchor your referral network.' });

  } catch(err) {
    console.error('Build team error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Extract PDF ──
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

app.get('/', (req, res) => res.json({ status: 'VERA proxy running' }));
app.listen(process.env.PORT || 3000, () => console.log('Proxy started'));
