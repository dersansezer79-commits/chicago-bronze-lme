// Node 20+ (global fetch)
// Writes: lme_automation/tcmb.json
// Sources: TCMB today.xml (ForexSelling) + Metals.Dev (XAUUSD)

import { writeFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';

const TCMB_URL = 'https://www.tcmb.gov.tr/kurlar/today.xml';
const METALS_URL = `https://api.metals.dev/v1/latest?api_key=${process.env.METALS_DEV_API_KEY ?? ''}&currency=USD`;
const GR_PER_OZ = 31.1034768;

const num = (x) => {
  if (x == null) return null;
  const n = Number(String(x).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const pick = (o, path, d = null) =>
  path.split('.').reduce((a, k) => a?.[k], o) ?? d;

async function fetchTCMB() {
  const res = await fetch(TCMB_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`TCMB fetch ${res.status}`);
  const xml = await res.text();

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
  const j = parser.parse(xml);
  const list = pick(j, 'Tarih_Date.Currency', []);

  const get = (code) => {
    const c = list.find((it) => String(it?.Kod).toUpperCase() === code);
    return num(c?.ForexSelling);
  };

  return {
    as_of: pick(j, 'Tarih_Date.Tarih') || new Date().toISOString().slice(0, 10),
    source: 'TCMB today.xml',
    field: 'ForexSelling',
    USDTRY: get('USD'),
    EURTRY: get('EUR'),
    GBPTRY: get('GBP'),
  };
}

async function fetchXAUUSD() {
  try {
    const r = await fetch(METALS_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error(`metals.dev ${r.status}`);
    const j = await r.json();
    // accept multiple shapes
    return (
      num(j?.metals?.gold?.price) ||
      num(j?.prices?.XAUUSD) ||
      num(j?.XAUUSD) ||
      num(j?.gold) ||
      num(j?.XAU) ||
      num(j?.xauusd) ||
      null
    );
  } catch (e) {
    console.warn('XAUUSD fetch failed:', e.message);
    return null;
  }
}

(async () => {
  const fx = await fetchTCMB();
  const xauusd = await fetchXAUUSD();

  const gram_try =
    xauusd != null && Number.isFinite(fx.USDTRY)
      ? (xauusd / GR_PER_OZ) * fx.USDTRY
      : null;

  const out = {
    ...fx,
    gold: { XAUUSD: xauusd, gram_try },
    updated_at: new Date().toISOString(),
  };

  await writeFile('lme_automation/tcmb.json', JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('Wrote lme_automation/tcmb.json');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
