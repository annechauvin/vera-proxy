const express = require('express');
const fetch = require('node-fetch');
const app = express();

app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Extract listing data using Claude
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
        system: `You are a data extraction engine for a Canadian real estate investment analysis tool.
Extract fields from the user text and return ONLY valid JSON. DO NOT calculate. DO NOT guess. DO NOT invent numbers.
If a field is not explicitly in the text, set it to null.
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
}
Rules: PropertyTax=annual $. Rents=monthly $ per unit. Percentages as numbers (20 for 20%). duplex=2, triplex=3, fourplex=4. NEVER invent numbers.`,
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
    res.status(500).json({ error: err.message });
  }
});

// Send data to Apps Script
app.post('/analyze', async (req, res) => {
  try {
    const response = await fetch(
      'https://script.google.com/macros/s/AKfycbzH3A8bv1jaTA089o6aP07_v8RmQs3-RCr-Nw62Hs5DjptO4018Q9fre4TT5CxWRij-/exec',
      {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      }
    );
    const text = await response.text();
    res.json(JSON.parse(text));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'VERA proxy running' }));

app.listen(process.env.PORT || 3000, () => console.log('Proxy started'));
