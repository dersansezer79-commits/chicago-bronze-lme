// Node 20+ (global fetch). Install: fast-xml-parser
// Writes: lme_automation/tcmb.json
// Sources: TCMB today.xml (ForexSelling) + Metals.Dev (XAUUSD)

import { writeFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';

const TCMB_URL = 'https://www.tcmb.gov.tr/kurlar/today.xml';
const METALS_URL = `https://api.metals.dev/v1/latest?api_key=${process.env.METALS_DEV_API_KEY || ''}&currency=USD`;

function pick(obj, path, dflt=null) {
  try { return path.split('.').reduce((o,k)=>o?.[k], obj) ?? dflt; } catch { return dflt; }
}
const toNum = (s) => {
  const n = Number(String(s).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const GR_PER_OZ = 31.1034768;

async function getTCMB() {
  const r = await fetch(TCMB_URL, { cache: 'no-store' });
  if (!r.ok) throw new Error(`TCMB fetch ${r.status}`);
  const xml = await r.text();
  const parser = new XMLParser({ ignoreAttributes:false, attributeNamePrefix:'' });
  const j = parser.parse(xml);
  const list = pick(j, 'Tarih_Date.Currency', []);
  const find = (code) => {
    const c = list.find(it => String(it?.Kod).toUpperCase() === code);
    return toNum(c?.ForexSelling);
  };
  const date = pick(j, 'Tarih_Date.Tarih') || new Date().toISOString().slice(0,10);
  return {
    as_of: date,
    source: 'TCMB today.xml',
    field: 'ForexSelling',
    USDTRY: find('USD'),
    EURTRY: find('EUR'),
    GBPTRY: find('GBP')
  };
}

async function getXAUUSD() {
  try {
    const r = await fetch(METALS_URL, { cache:'no-store' });
    if (!r.ok) throw new Error('metals.dev error');
    const j = await r.json();
    // Accept several possible shapes
    const x1 = toNum(j?.metals?.gold?.price);          // { metals: { gold: { price } } }
    const x2 = toNum(j?.prices?.XAUUSD ?? j?.XAUUSD);  // { prices: { XAUUSD } } or flat
    const x3 = toNum(j?.gold ?? j?.XAU ?? j?.xauusd);
    return x1 ?? x2 ?? x3 ?? null;
  } catch (e) {
    console.warn('XAUUSD fetch failed:', e.message);
    return null;
  }
}

(async () => {
  const tcmb = await getTCMB();
  const xauusd = await getXAUUSD();

  const gram_try = (xauusd != null && Number.isFinite(tcmb.USDTRY))
    ? (xauusd / GR_PER_OZ) * tcmb.USDTRY
    : null;

  const out = {
    ...tcmb,
    gold: { XAUUSD: xauusd, gram_try },
    updated_at: new Date().toISOString()
  };

  await writeFile('lme_automation/tcmb.json', JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('Wrote lme_automation/tcmb.json');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
