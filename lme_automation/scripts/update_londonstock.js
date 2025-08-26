// Fetch FTSE 100 (^FTSE) and FTSE 250 (^FTMC) closing prices from Stooq
// and write londonstock.json without any external dependencies.

import { writeFileSync } from 'node:fs';

// Download two indices (FTSE 100, FTSE 250) as CSV from Stooq.
// ukx = FTSE 100, ftmc = FTSE 250, daily frequency (i=d).
const STOOQ_URL = 'https://stooq.com/q/l/?s=ukx,ftmc&i=d';

async function fetchStooq() {
  const res = await fetch(STOOQ_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`);
  const text = (await res.text()).trim();
  // CSV header + one row per index:
  // symbol,date,time,open,high,low,close,volume
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split(',');
  const indexMap = Object.fromEntries(
    headers.map((h, i) => [h.toLowerCase(), i])
  );
  const result = {};
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const symbol = cols[indexMap.symbol].toLowerCase();
    const close = parseFloat(cols[indexMap.close]);
    // Map Stooq symbols to Yahoo‑style codes
    if (symbol === 'ukx') {
      result['^FTSE'] = {
        shortName: 'FTSE 100',
        price: Number.isFinite(close) ? close : null,
        source: 'stooq'
      };
    } else if (symbol === 'ftmc') {
      result['^FTMC'] = {
        shortName: 'FTSE 250',
        price: Number.isFinite(close) ? close : null,
        source: 'stooq'
      };
    }
  }
  return result;
}

async function main() {
  try {
    const indices = await fetchStooq();
    const out = {
      as_of: new Date().toISOString(),
      indices
    };
    writeFileSync('londonstock.json', JSON.stringify(out, null, 2));
    console.log('Wrote londonstock.json');
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

main();
