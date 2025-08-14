// scripts/update-lme.js
// Robust updater: fetch COMEX Copper (USD/lb) from Stooq CSV, convert to USD/tonne.
// If fetch/parse fails, keep the previous lme.json value so the site stays stable.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.resolve(__dirname, '..');
const LME_FILE   = path.join(REPO_ROOT, 'lme.json');

const LB_PER_TONNE = 2204.62262185;

// Read previous lme.json (or a safe default)
function readPrev() {
  try {
    const txt = fs.readFileSync(LME_FILE, 'utf8');
    const j = JSON.parse(txt);
    if (typeof j.usd_per_tonne === 'number') return j;
  } catch {}
  return { usd_per_tonne: 9803, as_of: 'fallback' };
}

// Fetch last copper futures price (USD/lb) from Stooq CSV
// Endpoint returns a 1-line CSV like: HG.F,2025-08-14,17:00,3.79
async function fetchUsdPerLb() {
  const url = 'https://stooq.com/q/l/?s=hg.f&i=h'; // hourly last price
  const res = await fetch(url, { headers: { 'user-agent': 'github-action' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const csv = await res.text();
  // Try the formats Stooq uses
  // 1) "HG.F,2025-08-14,17:00,3.79"
  // 2) "HG.F,3.79"
  const parts = csv.trim().split(',');
  const maybe = parseFloat(parts[parts.length - 1]);
  if (!Number.isFinite(maybe)) throw new Error('CSV parse failed: ' + csv);
  return maybe; // USD per lb
}

async function main() {
  const prev = readPrev();

  let next = prev;
  try {
    const usdPerLb = await fetchUsdPerLb();
    const usdPerTonne = Math.round(usdPerLb * LB_PER_TONNE);
    next = { usd_per_tonne: usdPerTonne, as_of: new Date().toISOString() };
    console.log('Fetched USD/lb =', usdPerLb, '→ USD/t =', usdPerTonne);
  } catch (err) {
    console.warn('Fetch failed, keeping previous value. Reason:', err.message || err);
    next = { usd_per_tonne: prev.usd_per_tonne, as_of: new Date().toISOString() };
  }

  fs.writeFileSync(LME_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  console.log('Wrote', LME_FILE, next);
}

main().catch(e => {
  console.error('Unexpected error:', e);
  // Never fail the workflow: keep site stable
  const prev = readPrev();
  fs.writeFileSync(LME_FILE, JSON.stringify({ usd_per_tonne: prev.usd_per_tonne, as_of: new Date().toISOString() }, null, 2) + '\n', 'utf8');
});
