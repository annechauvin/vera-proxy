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

// ── KNOWLEDGE BASE (file-based fallback) ──
const KB_DIR = path.join(__dirname, 'knowledge');
if (!fs.existsSync(KB_DIR)) fs.mkdirSync(KB_DIR);

function readKnowledge(category) {
  const file = path.join(KB_DIR, category + '.txt');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

app.post('/knowledge', (req, res) => {
  try {
    const { category, text, password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
    if (!category || !text) return res.status(400).json({ error: 'category and text required' });
    const safe = category.replace(/[^a-zA-Z0-9-_]/g, '');
    fs.writeFileSync(path.join(KB_DIR, safe + '.txt'), text, 'utf8');
    res.json({ success: true, category: safe });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/knowledge/:category', (req, res) => {
  try {
    const safe = req.params.category.replace(/[^a-zA-Z0-9-_]/g, '');
    res.json({ category: safe, text: readKnowledge(safe) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/knowledge', (req, res) => {
  try {
    const files = fs.existsSync(KB_DIR)
      ? fs.readdirSync(KB_DIR).filter(f => f.endsWith('.txt')).map(f => ({
          category: f.replace('.txt', ''),
          size: fs.statSync(path.join(KB_DIR, f)).size
        }))
      : [];
    res.json({ categories: files });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Extract listing ──
const EXTRACT_SYSTEM = `You are a smart real estate data extraction engine for a Canadian rental property investment tool.

The user will paste a property listing, realtor notes, or any free-form text. Your job is to extract data AND intelligently infer facts from the language used.

SMART READING RULES — infer from context:

UNIT COUNT:
- "single", "single family", "single-family", "SFH", "bungalow", "house", "cottage", "1 unit", "one unit" = 1
- "duplex", "semi-detached", "2 unit", "two unit", "up/down", "upper and lower" = 2  
- "triplex", "3 unit", "three unit" = 3
- "fourplex", "quadplex", "4 unit", "four unit" = 4
- If unit types are listed, count them

CONDITION / RENOVATION:
- If listing uses: "potential", "savvy investor", "as-is", "handyman", "needs work", "fixer", "estate sale", "priced to sell", "opportunity", "great bones", "TLC", "sweat equity" → set RenovationEstimate to a non-zero value (use 15000 as a conservative placeholder)
- If listing uses: "turnkey", "move-in ready", "renovated", "updated", "pristine", "immaculate" → RenovationEstimate = 0

UTILITIES / EXPENSES:
- "paid by tenants", "tenant pays", "tenants pay", "hydro included by tenant" → set that utility to 0
- "included", "owner pays", "landlord pays" → note that expense as owner-paid (keep as null for user to fill)
- "heat included", "all utilities included" → Utilities_Heat = 0 wait for user to confirm

RENTS:
- "$X/mo", "$X per month", "rents for $X", "generating $X", "income of $X/month" → extract as rent
- "gross income $X/yr" → divide by 12 and by units for monthly rent per unit
- "potential rent", "market rent" → still extract as AsIsRent

PROPERTY TAX:
- "tax $X", "taxes $X/yr", "municipal $X", "property tax $X" → extract annual amount
- If given monthly, multiply by 12

INSURANCE:
- "insurance $X", "insured for $X/yr" → annual amount

FINANCING (extract if mentioned):
- "X% down", "X% downpayment" → DownpaymentPercentage as whole number (20 for 20%)
- "X% rate", "X% interest", "at X%" → InterestRate as whole number
- "X year amort", "X yr amortization" → AmortizationPeriod

USAGE:
- "investment", "rental", "fully rented", "income property", "tenant occupied" = "Full rental"
- "owner occupied", "live in one unit", "owner-occupied", "house hack" = "Owner-occupied duplex" or "Owner-occupied triplex"
- Default to "Full rental"

FINAL RULES (always apply):
- PropertyTax: annual dollars. If monthly multiply by 12.
- All rents: monthly dollars per unit.
- Percentages as whole numbers: 20 for 20%, 5 for 5%.
- duplex=2, triplex=3, fourplex=4. Max 4 units.
- NEVER invent numbers not explicitly in the text.
- If unsure, set to null — never guess.

RETURN only this exact JSON, no markdown, no explanation:
{
  "PropertyAddress": string or null,
  "PropertyNeighborhood": string or null,
  "ListingDescription": "copy full text here",
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
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: EXTRACT_SYSTEM,
        messages: [{ role: 'user', content: text }]
      })
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

// ── Send data to Apps Script ──
app.post('/analyze', async (req, res) => {
  try {
    const response = await fetch(APPS_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const text = await response.text();
    console.log('Apps Script response:', text.slice(0, 300));
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
    const isChat = mode === 'chat'; // chat returns plain text
    const isMarket = mode === 'market'; // market returns JSON

    // Fetch knowledge
    let knowledge = '';
    try {
      const cat = category || 'Analyse a property';
      knowledge = await Promise.race([
        fetchKnowledge(cat),
        new Promise(resolve => setTimeout(() => resolve(''), 15000))
      ]) || '';
      if (knowledge) console.log('Knowledge loaded:', knowledge.length, 'chars for', cat);
      else console.log('No knowledge loaded for', cat);
    } catch(kErr) { knowledge = ''; }

    // For chat without knowledge: decline politely
    if (isChat && !knowledge) {
      return res.json({ answer: 'I am not able to access my knowledge base right now. Please try again in a moment.' });
    }

    const sysPrompt = isChat
      ? `You are VERA, a Canadian multifamily real estate investment assistant. You are helpful, direct, and knowledgeable.

Answer every question fully and specifically. Never deflect to Google Maps or suggest the user find someone else. Never say "that falls outside what I can help with." Just answer.

If asked about streets in a neighbourhood, list the main streets. If asked about a city, give specific data. If asked anything real-estate related, answer it directly and practically.

${knowledge ? 'Use this knowledge base as your primary source:\n\n' + knowledge : ''}

Be conversational and specific. No bullet points unless it helps clarity. No deflection. Just answer.`
      : 'You are VERA, a real estate investment assistant trained by Anne Chauvin. Return only valid JSON as requested. No markdown, no explanation.' + (knowledge ? '\n\n=== ANNE CHAUVIN KNOWLEDGE BASE ===\n' + knowledge : '');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        system: sysPrompt,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const txt = data.content?.find(b => b.type === 'text')?.text || '';

    if (isChat) {
      res.json({ answer: txt });
    } else {
      const m = txt.match(/\{[\s\S]*\}/);
      if (!m) {
        res.json({ answer: txt });
        return;
      }
      res.json(JSON.parse(m[0]));
    }
  } catch (err) {
    console.error('Insights error:', err.message);
    res.status(500).json({ error: err.message });
  }
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
      const capPct = capRate > 1 ? capRate * 100 : capRate * 100;
      const totalROI = Number(r.totalROI) || 0;
      const totalROIPct = totalROI > 1 ? totalROI * 100 : totalROI * 100;
      return {
        addr: r.addr || '', city: r.city || '', neighbourhood: r.neighbourhood || '',
        date: r.date || '', units, type: units===1?'Single':units===2?'Duplex':units===3?'Triplex':'Fourplex',
        asking: Number(r.asking)||0, capRate: capPct, cashflow: Number(r.cashflow)||0,
        coc: Number(r.coc)||0, totalROI: totalROIPct, cashToClose: Number(r.cashToClose)||0,
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

// ── Extract PDF ──
app.post('/extract-pdf', async (req, res) => {
  try {
    const { pdf, password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 4096,
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } },
          { type: 'text', text: 'Extract all the text from this document. Return only the raw text content, no formatting, no commentary.' }
        ]}]
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    res.json({ text: data.content?.find(b => b.type === 'text')?.text || '' });
  } catch (err) {
    console.error('PDF extract error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Fetch listing (OneHome test) ──
app.get('/fetch-listing', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'url required' });
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html', 'Accept-Language': 'en-CA' }
    });
    const text = await response.text();
    res.json({ status: response.status, length: text.length, preview: text.substring(0, 500) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Property search endpoints ──
app.post('/save-search', async (req, res) => {
  try {
    const { email, city, propertyType, maxPrice } = req.body;
    const url = APPS_URL + '?action=saveSearch&email=' + encodeURIComponent(email) +
      '&city=' + encodeURIComponent(city) +
      '&propertyType=' + encodeURIComponent(propertyType) +
      '&maxPrice=' + encodeURIComponent(maxPrice || '');
    const resp = await fetch(url, { redirect: 'follow' });
    const data = await resp.json();
    res.json(data);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/get-listings', async (req, res) => {
  try {
    const email = req.query.email || '';
    const url = APPS_URL + '?action=getListings&email=' + encodeURIComponent(email);
    const resp = await fetch(url, { redirect: 'follow' });
    const data = await resp.json();
    res.json(data);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/fetch-now', async (req, res) => {
  try {
    const url = APPS_URL + '?action=fetchNow';
    fetch(url, { redirect: 'follow' }); // fire and forget
    res.json({ success: true, message: 'Fetching listings in background...' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/mark-viewed', async (req, res) => {
  try {
    const { email, listingUrl } = req.body;
    const url = APPS_URL + '?action=markViewed&email=' + encodeURIComponent(email) +
      '&url=' + encodeURIComponent(listingUrl);
    await fetch(url, { redirect: 'follow' });
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Fetch full listing page ──
app.post('/fetch-listing-text', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-CA,en;q=0.9'
      }
    });
    const html = await resp.text();
    // Extract readable text - remove HTML tags
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 8000);
    res.json({ text, url });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Save single listing ──
app.post('/save-listing', async (req, res) => {
  try {
    const { email, listing } = req.body;
    const url = APPS_URL + '?action=saveListing' +
      '&email=' + encodeURIComponent(email) +
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

// ── Search Kijiji listings ──
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
      'alberta': 'l9003', 'vancouver': 'l1700227', 'victoria-bc': 'l1700228', 'kelowna': 'l1700222',
      'british-columbia': 'l9007', 'winnipeg': 'l1700192', 'manitoba': 'l9008',
      'saskatoon': 'l1700239', 'regina': 'l1700238', 'saskatchewan': 'l9056', 'canada': 'l0'
    };
    
    const locationId = LOCATION_IDS[region] || 'l0';
    const maxPriceNum = maxPrice ? parseInt(maxPrice) : 0;
    let allListings = [];
    
    for (const t of types) {
      const url = `https://www.kijiji.ca/b-house-for-sale/${region}/${t}/k0c35${locationId}`;
      console.log('Fetching Kijiji:', url);
      
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-CA,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br'
        }
      });
      
      const html = await resp.text();
      console.log('Response status:', resp.status, 'HTML length:', html.length);
      
      // Extract listings using regex
      const linkRe = /href="(\/v-house-for-sale\/[^"]+)"/g;
      const priceRe = /\$\s*([0-9,]+)(?:\.00)?/g;
      const titleRe = /"title"\s*:\s*"([^"]+)"/g;
      const descRe = /"description"\s*:\s*"([^"]+)"/g;
      
      const urls = new Set();
      const listings = [];
      let m;
      
      // Get all listing URLs
      while ((m = linkRe.exec(html)) !== null) {
        const listingUrl = 'https://www.kijiji.ca' + m[1];
        if (!urls.has(listingUrl) && !m[1].includes('?') && m[1].split('/').length >= 5) {
          urls.add(listingUrl);
        }
      }
      
      // Get prices
      const prices = [];
      while ((m = priceRe.exec(html)) !== null) {
        const p = parseInt(m[1].replace(/,/g, ''));
        if (p >= 50000) prices.push(p);
      }
      
      // Get titles from JSON-LD
      const titles = [];
      while ((m = titleRe.exec(html)) !== null) {
        if (m[1].length > 10) titles.push(m[1]);
      }
      
      // Get descriptions
      const descs = [];
      while ((m = descRe.exec(html)) !== null) {
        if (m[1].length > 20) descs.push(m[1].substring(0, 200));
      }
      
      let i = 0;
      for (const listingUrl of urls) {
        const price = prices[i] || 0;
        if (maxPriceNum > 0 && price > maxPriceNum) { i++; continue; }
        
        allListings.push({
          url: listingUrl,
          price: price,
          addr: titles[i] || listingUrl.split('/').slice(-2, -1)[0].replace(/-/g, ' '),
          type: t,
          city: region,
          description: descs[i] || '',
          dateFound: new Date().toLocaleDateString('en-CA', {month:'short', day:'numeric', year:'numeric'}),
          status: 'New'
        });
        
        if (++i >= 20) break;
      }
    }
    
    console.log('Total listings found:', allListings.length);
    res.json(allListings);
  } catch(err) {
    console.error('Kijiji search error:', err.message);
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

// ── Build team with web search ──
app.post('/build-team', async (req, res) => {
  try {
    const { city, prompt } = req.body;

    // First call - with web search tool
    const response1 = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        system: 'You are a real estate investment team researcher. Search the web to find REAL, VERIFIABLE professionals in the requested city. Use Google to find actual businesses, websites, Google reviews, BBB listings, and local directories. Return only valid JSON as requested. No markdown, no explanation outside the JSON.',
        messages: [{ role: 'user', content: prompt }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    });

    let data1 = await response1.json();
    if (data1.error) throw new Error(data1.error.message);

    // Handle tool use - continue conversation with search results
    let messages = [{ role: 'user', content: prompt }];
    
    while (data1.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: data1.content });
      
      const toolResults = data1.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: 'Search completed - use results to find real professionals.' }));
      
      messages.push({ role: 'user', content: toolResults });

      const response2 = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 8192,
          system: 'You are a real estate investment team researcher. Search the web to find REAL, VERIFIABLE professionals. Return only valid JSON as requested.',
          messages,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }]
        })
      });
      
      data1 = await response2.json();
      if (data1.error) throw new Error(data1.error.message);
    }

    const txt = data1.content?.find(b => b.type === 'text')?.text || '';
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Could not parse team response');
    res.json(JSON.parse(m[0]));

  } catch(err) {
    console.error('Build team error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'VERA proxy running' }));
app.listen(process.env.PORT || 3000, () => console.log('Proxy started'));
