// scripts/update-lme.js
import fs from "fs";

const LB_PER_TONNE = 2204.62262185; // 1 metric ton = 2204.62 lb

async function fetchCopperUSDPerTonne() {
  try {
    // Free public spot feed (USD/lb). Not official LME settlement.
    const res = await fetch("https://api.metals.live/v1/spot", {
      headers: { "User-Agent": "github-action" }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arr = await res.json(); // e.g. [{gold:...},{silver:...},{copper: 3.89}, ...]
    let priceLb = null;
    for (const row of arr) {
      if (row && typeof row.copper !== "undefined") priceLb = Number(row.copper);
    }
    if (!isFinite(priceLb)) throw new Error("No copper in feed");

    const usdPerTonne = Math.round(priceLb * LB_PER_TONNE);
    return { usd_per_tonne: usdPerTonne, as_of: new Date().toISOString() };
  } catch (err) {
    // Fallback: keep last value so your site stays stable
    const prev = JSON.parse(fs.readFileSync("lme.json", "utf8"));
    return { usd_per_tonne: prev.usd_per_tonne, as_of: new Date().toISOString() };
  }
}

const out = await fetchCopperUSDPerTonne();
fs.writeFileSync("lme.json", JSON.stringify(out, null, 2) + "\n");
console.log("Updated:", out);
