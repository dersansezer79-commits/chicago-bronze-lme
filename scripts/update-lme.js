// scripts/update-lme.js
// COMEX Copper (Stooq) → USD/tonne. Keeps previous value if fetch/parse fails.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.resolve(__dirname, '..');
const LME_FILE   = path.join(REPO_ROOT, 'lme.json');

const LB_PER_TONNE = 2204.62262185;
// Stable headered CSV: Symbol,Date,Time,Open,High,Low,Close,Volume
const STOOQ_URL = 'https://stooq.com/q/l/?s=hg.f&f=sd2t2ohlcv&h&e=csv';

function readPrev() {
  try {
    const j = JSON.parse(fs.readFileSync(LME_FILE, 'utf8'));
    if (typeof j.usd_per_tonne === 'number') return j;
  } catch {}
  return { usd_per_tonne: 9803, as_of: 'fallback' };
}

async function retry(fn, tries = 3, delayMs = 1200) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { lastErr = e; }
    await new Promise(r => setTimeout(r, delayMs));
  }
  throw lastErr;
}

async function fetchCsv() {
  const res = await fetch(STOOQ_URL, {
    headers: { 'user-agent': 'github-action', 'accept': 'text/csv,*/*' },
    cache: 'no-store'
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.text();
}

function parseUsdPerLb(csv) {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error('Unexpected CSV: not enough lines');

  const header = lines[0].split(',').map(s => s.trim().toLowerCase());
  const closeIdx = header.indexOf('close');
  if (closeIdx === -1) throw new Error('No Close column: ' + header.join('|'));

  // Prefer the first valid data row after header
  let row = null;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(s => s.trim());
    if (cols.length >= header.length && cols[closeIdx] && cols[0]) { row = cols; break; }
  }
  if (!row) throw new Error('No data row found. CSV head: ' + lines.slice(0, 3).join(' / '));

  let usdPerLb = parseFloat(row[closeIdx]);
  if (!Number.isFinite(usdPerLb)) {
    throw new Error('Close not numeric: "' + row[closeIdx] + '" | Row: ' + row.join(','));
  }

  // Safety: some feeds return cents/lb (e.g., 449.2 -> $4.492)
  if (usdPerLb > 20) usdPerLb = usdPerLb / 100;

  return usdPerLb;
}

async function main() {
  const prev = readPrev();
  let next = prev;

  try {
    const csv = await retry(() => fetchCsv(), 3, 1500);
    const usdPerLb = parseUsdPerLb(csv);
    const usdPerTonne = Math.round(usdPerLb * LB_PER_TONNE);
    next = { usd_per_tonne: usdPerTonne, as_of: new Date().toISOString() };
    console.log('Fetched USD/lb =', usdPerLb, '→ USD/t =', usdPerTonne);
  } catch (err) {
    console.warn('Fetch/parse failed, keeping previous. Reason:', err.message || err);
    next = { usd_per_tonne: prev.usd_per_tonne, as_of: new Date().toISOString() };
  }

  fs.writeFileSync(LME_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  console.log('Wrote', LME_FILE, next);
}

main().catch(e => {
  console.error('Unexpected error:', e);
  const prev = readPrev();
  fs.writeFileSync(
    LME_FILE,
    JSON.stringify({ usd_per_tonne: prev.usd_per_tonne, as_of: new Date().toISOString() }, null, 2) + '\n',
    'utf8'
  );
});
