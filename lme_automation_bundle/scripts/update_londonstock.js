/*
 * update_londonstock.js
 *
 * Fetches FTSE index data from Yahoo Finance and writes the results to
 * `londonstock.json`.  The script queries the Yahoo Finance quote API
 * for the FTSE 100 (^FTSE) and FTSE 250 (^FTMC) indices.  It then
 * extracts the current price, daily change and percent change along
 * with the short name of each index.
 *
 * The resulting JSON takes the form:
 * {
 *   "as_of": "2025-08-25T05:10:00Z",
 *   "indices": {
 *     "^FTSE": { "shortName": "FTSE 100", "price": 8200.00, "change": -12.3, "changePercent": -0.15 },
 *     "^FTMC": { "shortName": "FTSE 250", "price": 20500.00, "change": 5.1, "changePercent": 0.02 }
 *   }
 * }
 */

const fs = require('fs');
const axios = require('axios');

async function fetchIndices(symbols) {
  const encoded = symbols.map(encodeURIComponent).join(',');
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encoded}`;
  const res = await axios.get(url, { responseType: 'json' });
  const results = res.data.quoteResponse?.result || [];
  const out = {};
  results.forEach((entry) => {
    out[entry.symbol] = {
      shortName: entry.shortName,
      price: entry.regularMarketPrice,
      change: entry.regularMarketChange,
      changePercent: entry.regularMarketChangePercent,
    };
  });
  return out;
}

async function main() {
  try {
    const indices = await fetchIndices(['^FTSE', '^FTMC']);
    const result = {
      as_of: new Date().toISOString(),
      indices,
    };
    fs.writeFileSync('londonstock.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Error fetching London stock indices:', err);
    process.exit(1);
  }
}

main();