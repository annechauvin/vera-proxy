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
    console.log('Apps Script response:', text.slice(0, 200));
    const data = JSON.parse(text);
    res.json(data);
  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'VERA proxy running' }));

app.listen(process.env.PORT || 3000, () => console.log('Proxy started'));
