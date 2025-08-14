import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LME_URL = 'https://www.lme.com/Metals/Non-ferrous/LME-Copper#Overview';

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

function parsePrice(html) {
  const patterns = [
    /USD\/t[^0-9]*([0-9][0-9,]*\.?[0-9]*)/i,
    /([0-9][0-9,]*\.?[0-9]*)\s*USD\/t/i,
    /US\$\s*\/t[^0-9]*([0-9][0-9,]*\.?[0-9]*)/i
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      const n = Number(m[1].replace(/,/g, ''));
      if (Number.isFinite(n) && n > 1000) return n;
    }
  }
  return null;
}

function readPrev(jsonPath) {
  try {
    const raw = fs.readFileSync(jsonPath, 'utf8');
    const obj = JSON.parse(raw);
    return typeof obj.usd_per_tonne === 'number' ? obj.usd_per_tonne : 10200;
  } catch {
    return 10200;
  }
}

async function main() {
  const jsonPath = path.join(__dirname, '..', 'lme.json');
  const prev = readPrev(jsonPath);

  let price = null;
  try {
    const html = await fetchText(LME_URL);
    price = parsePrice(html);
  } catch {
    // ignore errors; use previous
  }

  const value = price ?? prev;
  const as_of = new Date().toISOString();
  const payload = { usd_per_tonne: value, as_of };
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  console.log('Updated lme.json:', payload);
}

main().catch(err => {
  console.error(err);
  process.exit(0);
});
