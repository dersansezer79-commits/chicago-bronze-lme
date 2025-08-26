// scripts/update-metals.js
import { writeFile, mkdir } from "fs/promises";

const API_KEY = process.env.METALS_DEV_API_KEY;
if (!API_KEY) throw new Error("Missing METALS_DEV_API_KEY");

const BASE = "https://api.metals.dev/v1";
const url = `${BASE}/latest?api_key=${API_KEY}&currency=USD&unit=kg`;

const resp = await fetch(url, { headers: { Accept: "application/json" } });
const data = await resp.json();

if (data.status !== "success") {
  throw new Error(`Metals.Dev error: ${data.error_code || ""} ${data.error_message || ""}`);
}

const m = data.metals || {};
const c = data.currencies || {};

// Not: latest döviz bölümünde değerler "1 birim para = kaç USD" şeklinde gelir.
// Bu yüzden "1 USD = kaç TRY" için tersini alıyoruz: 1 / c.TRY
const usdtry = c.TRY ? (1 / c.TRY) : null;

const out = {
  timestamp: data.timestamp ?? new Date().toISOString(),
  currency: "USD",
  unit: "kg",
  source: "metals.dev/latest",
  usd_per_kg: {
    aluminum: m.lme_aluminum ?? m.aluminum ?? null,
    copper:   m.lme_copper   ?? m.copper   ?? null,
    lead:     m.lme_lead     ?? m.lead     ?? null,
    nickel:   m.lme_nickel   ?? m.nickel   ?? null,
    zinc:     m.lme_zinc     ?? m.zinc     ?? null
  },
  usdtry
};

await mkdir("public/data", { recursive: true });
await writeFile("public/data/lme.json", JSON.stringify(out, null, 2), "utf8");

console.log("Wrote public/data/lme.json");
