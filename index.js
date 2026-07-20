const express = require('express');
const fetch = require('node-fetch');
const app = express();

app.use(express.json());

// Allow VERA to call this proxy
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  next();
});

app.options('/analyze', (req, res) => res.sendStatus(200));

app.post('/analyze', async (req, res) => {
  try {
    const response = await fetch(
      'https://script.google.com/macros/s/AKfycbzH3A8bv1jaTA089o6aP07_v8RmQs3-RCr-Nw62Hs5DjptO4018Q9fre4TT5CxWRij-/exec',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      }
    );
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'VERA proxy running' }));

app.listen(process.env.PORT || 3000);
