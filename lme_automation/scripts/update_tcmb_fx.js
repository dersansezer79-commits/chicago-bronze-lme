// ESM + native fetch (Node 18+) — writes tcmb.json
import { writeFileSync } from "node:fs";
import { parseStringPromise } from "xml2js";

const TCMB_URL = "https://www.tcmb.gov.tr/kurlar/today.xml";
const YF_URL = "https://query1.finance.yahoo.com/v7/finance/quote?symbols=XAUUSD=X";

const toFloatTR = (s) => (s == null ? null : parseFloat(String(s).replace(",", ".")));

async function fetchTCMB() {
  const r = await fetch(TCMB_URL, { cache: "no-store" });
  if (!r.ok) throw new Error("TCMB HTTP " + r.status);
  const xml = await r.text();
  const js = await parseStringPromise(xml);

  const list = js.Tarih_Date.Currency;
  const find = (code) => list.find((c) => (c.$.Kod || c.$.Code) === code);
  const get = (cur, key) => (cur && cur[key] && cur[key][0] ? toFloatTR(cur[key][0]) : null);

  const usd = find("USD");
  const eur = find("EUR");
  const gbp = find("GBP");

  return {
    as_of: js.Tarih_Date.$.Tarih || js.Tarih_Date.$.Date || new Date().toISOString().slice(0, 10),
    source: "TCMB today.xml",
    field: "ForexSelling",
    USDTRY: get(usd, "ForexSelling") || get(usd, "BanknoteSelling") || get(usd, "ForexBuying") || get(usd, "BanknoteBuying"),
    EURTRY: get(eur, "ForexSelling") || get(eur, "BanknoteSelling") || get(eur, "ForexBuying") || get(eur, "BanknoteBuying"),
    GBPTRY: get(gbp, "ForexSelling") || get(gbp, "BanknoteSelling") || get(gbp, "ForexBuying") || get(gbp, "BanknoteBuying"),
  };
}

async function fetchGoldUSDoz() {
  const r = await fetch(YF_URL, { cache: "no-store" });
  if (!r.ok) throw new Error("Yahoo HTTP " + r.status);
  const js = await r.json();
  const q = js.quoteResponse.result?.[0];
  return q?.regularMarketPrice ?? q?.postMarketPrice ?? null;
}

try {
  const fx = await fetchTCMB();
  let xauusd = null, gram_try = null;
  try {
    xauusd = await fetchGoldUSDoz();
    if (xauusd && fx.USDTRY) gram_try = (xauusd * fx.USDTRY) / 31.1035;
  } catch {}
  const out = {
    ...fx,
    gold: { XAUUSD: xauusd, gram_try: gram_try ? Number(gram_try.toFixed(2)) : null },
    updated_at: new Date().toISOString(),
  };
  writeFileSync("tcmb.json", JSON.stringify(out, null, 2));
  console.log("Wrote tcmb.json");
} catch (e) {
  console.error(e);
  process.exit(1);
}
