
// scripts/update-alloys-from-csv.js
// Update alloys.json from alloy-premiums.csv at repo root.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.resolve(__dirname, '..');
const ALLOYS_FILE = path.join(REPO_ROOT, 'alloys.json');
const CSV_FILE    = path.join(REPO_ROOT, 'alloy-premiums.csv');

function readJSONSafe(p, fallback){
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return fallback; }
}

function parseCSV(csvText){
  const lines = csvText.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = lines[0].split(',').map(h=>h.trim());
  return lines.slice(1).filter(Boolean).map(line => {
    const cols = line.split(',').map(c=>c.trim());
    const row = {};
    headers.forEach((h,i)=> row[h] = cols[i] ?? '');
    return row;
  });
}

function toNum(v){
  if(v===undefined || v===null || v==='') return undefined;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

function ensureDefaults(Alloys){
  if(!Alloys || typeof Alloys !== 'object'){
    Alloys = { version: 'bootstrap', defaults: { ops_usd_per_kg: 0.5, margin_pct: 12, lme_multiplier: 1 }, alloys: {} };
  }
  if(!Alloys.defaults) Alloys.defaults = { ops_usd_per_kg: 0.5, margin_pct: 12, lme_multiplier: 1 };
  if(!Alloys.alloys)   Alloys.alloys   = {};
  return Alloys;
}

function applyRow(row, Alloys){
  const key = (row.key || row.Alloy || '').trim();
  if(!key) return { key: null, changed: false, reason: 'no-key' };

  const a = Alloys.alloys[key] || {};
  const before = JSON.stringify(a);

  // required
  const premium = toNum(row.premium_usd_per_kg ?? row.premium);
  if(premium !== undefined) a.premium_usd_per_kg = premium;

  // optional overrides
  const maybe = {
    density_kg_m3: toNum(row.density_kg_m3),
    lme_multiplier: toNum(row.lme_multiplier),
    ops_usd_per_kg: toNum(row.ops_usd_per_kg),
    margin_pct:     toNum(row.margin_pct),
  };
  for(const [k,v] of Object.entries(maybe)){ if(v !== undefined) a[k] = v; }

  // capacity
  const lim = {
    max_len_mm:       toNum(row.max_len_mm),
    max_od_mm:        toNum(row.max_od_mm),
    min_bore_wall_mm: toNum(row.min_bore_wall_mm),
  };
  const fl  = {
    max_od_mm:  toNum(row.flange_max_od_mm),
    max_thk_mm: toNum(row.flange_max_thk_mm),
  };
  if(Object.values(lim).some(v => v !== undefined)) a.limits = { ...(a.limits||{}), ...Object.fromEntries(Object.entries(lim).filter(([,v])=>v!==undefined)) };
  if(Object.values(fl).some(v => v !== undefined))  a.flange = { ...(a.flange||{}), ...Object.fromEntries(Object.entries(fl).filter(([,v])=>v!==undefined)) };

  // if creating, seed sensible defaults
  if(!Alloys.alloys[key]){
    a.label = a.label || key.replaceAll('_',' ');
    a.density_kg_m3 = a.density_kg_m3 || 8000;
    a.lme_multiplier = a.lme_multiplier ?? 0.8;
    a.ops_usd_per_kg = a.ops_usd_per_kg ?? (Alloys.defaults.ops_usd_per_kg ?? 0.5);
    a.margin_pct     = a.margin_pct     ?? (Alloys.defaults.margin_pct     ?? 12);
  }

  Alloys.alloys[key] = a;
  const after = JSON.stringify(a);
  return { key, changed: before !== after, reason: 'updated' };
}

async function main(){
  if(!fs.existsSync(CSV_FILE)){
    console.warn('CSV file missing at', CSV_FILE, '— nothing to update.');
    process.exit(0);
  }
  const csvText = fs.readFileSync(CSV_FILE, 'utf8');
  const rows = parseCSV(csvText);
  if(!rows.length){
    console.warn('CSV appears empty — nothing to update.');
    process.exit(0);
  }

  let Alloys = readJSONSafe(ALLOYS_FILE, null);
  Alloys = ensureDefaults(Alloys);

  const changes = [];
  for(const row of rows){
    const res = applyRow(row, Alloys);
    if(res.key && res.changed) changes.push(res.key);
  }

  Alloys.version = new Date().toISOString();
  fs.writeFileSync(ALLOYS_FILE, JSON.stringify(Alloys, null, 2) + '\n', 'utf8');
  console.log('Updated alloys:', changes.length ? changes.join(', ') : '(no field changes)');
  console.log('Wrote', ALLOYS_FILE);
}

main().catch(e => {
  console.error('Unexpected error:', e);
  process.exit(0); // do not fail the workflow
});
