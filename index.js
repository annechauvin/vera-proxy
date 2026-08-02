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

// ── KNOWLEDGE BASE HELPERS (NEW) ──
const KB_DIR = path.join(__dirname, 'knowledge');
if (!fs.existsSync(KB_DIR)) fs.mkdirSync(KB_DIR);

function readKnowledge(category) {
  const file = path.join(KB_DIR, category + '.txt');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

// ── NEW: Save knowledge by category ──
app.post('/knowledge', (req, res) => {
  try {
    const { category, text, password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!category || !text) {
      return res.status(400).json({ error: 'category and text required' });
    }
    const safe = category.replace(/[^a-zA-Z0-9-_]/g, '');
    fs.writeFileSync(path.join(KB_DIR, safe + '.txt'), text, 'utf8');
    res.json({ success: true, category: safe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── NEW: Read knowledge by category ──
app.get('/knowledge/:category', (req, res) => {
  try {
    const safe = req.params.category.replace(/[^a-zA-Z0-9-_]/g, '');
    const text = readKnowledge(safe);
    res.json({ category: safe, text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── NEW: List all knowledge categories ──
app.get('/knowledge', (req, res) => {
  try {
    const files = fs.existsSync(KB_DIR)
      ? fs.readdirSync(KB_DIR).filter(f => f.endsWith('.txt')).map(f => ({
          category: f.replace('.txt', ''),
          size: fs.statSync(path.join(KB_DIR, f)).size
        }))
      : [];
    res.json({ categories: files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

// Extract listing data using Claude
app.post('/extract', async (req, res) => {
  try {
    const { text } = req.body;

    // ── NEW: Load property-analysis knowledge base ──
    const knowledge = readKnowledge('property-analysis');
    const systemPrompt = knowledge
      ? EXTRACT_SYSTEM + '\n\n=== VERA KNOWLEDGE BASE ===\n' + knowledge
      : EXTRACT_SYSTEM;

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
        system: systemPrompt,
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

// Send data to Apps Script
app.post('/analyze', async (req, res) => {
  try {
    const response = await fetch(
      'https://script.google.com/macros/s/AKfycbyy9SrBK9JW2M2lBbCKJmVdDMpulRnZYL_uinL2LHEw9b5UoUeAVAi3MmnYNXR7mIcH/exec',
      {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      }
    );
    const text = await response.text();
    console.log('Apps Script response:', text.slice(0, 300));
    res.json(JSON.parse(text));
  } catch (err) {
    console.error('Analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── NEW: Extract text from PDF for admin knowledge base ──
app.post('/extract-pdf', async (req, res) => {
  try {
    const { pdf, password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
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
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: pdf }
            },
            {
              type: 'text',
              text: 'Extract all the text from this document. Return only the raw text content, no formatting, no commentary.'
            }
          ]
        }]
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const text = data.content?.find(b => b.type === 'text')?.text || '';
    res.json({ text });
  } catch (err) {
    console.error('PDF extract error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── NEW: Generate VERA insights from property data ──
app.post('/insights', async (req, res) => {
  try {
    const { prompt } = req.body;
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
        system: 'You are VERA, a real estate investment assistant. Return only valid JSON as requested. No markdown, no explanation.',
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const txt = data.content?.find(b => b.type === 'text')?.text || '';
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Could not parse insights response');
    res.json(JSON.parse(m[0]));
  } catch (err) {
    console.error('Insights error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'VERA proxy running' }));

app.listen(process.env.PORT || 3000, () => console.log('Proxy started'));
