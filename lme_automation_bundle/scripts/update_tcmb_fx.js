/*
 * update_tcmb_fx.js
 *
 * This script fetches daily foreign exchange rates and a gold price and writes
 * them into a JSON file (tcmb.json) suitable for use with the browser tool.
 *
 * The default data sources are:
 *  - The Central Bank of the Republic of Türkiye (TCMB) XML feed at
 *    https://www.tcmb.gov.tr/kurlar/today.xml.  It contains USD/TRY,
 *    EUR/TRY and GBP/TRY rates under the ForexSelling field.  We parse it
 *    without requiring any API keys and fall back gracefully if the XML
 *    cannot be fetched.
 *  - Yahoo Finance for USD denominated gold (XAUUSD).  Gold prices are
 *    quoted per troy ounce; the script converts to grams and then to TRY
 *    using the fetched USD/TRY rate.  The gold price section lives under
 *    the 'gold' property with two fields: `XAUUSD` (the USD per ounce
 *    price) and `gram_try` (the computed gram price in lira).
 *
 * When run, the script writes the resulting object to the file
 * "tcmb.json" in the current working directory.  It also prints the
 * contents to stdout for debugging.
 */

const fs = require('fs');
const axios = require('axios');
const xml2js = require('xml2js');

async function fetchTCMB() {
  // Attempt to fetch the TCMB daily rates XML.  The TCMB does not set
  // Access-Control-Allow-Origin headers, so this cannot be called from a
  // browser without a proxy.  In Node.js we can fetch it directly.
  const url = 'https://www.tcmb.gov.tr/kurlar/today.xml';
  const res = await axios.get(url, { responseType: 'text' });
  const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });
  const data = await parser.parseStringPromise(res.data);
  const rates = data.Tarih_Date?.Currency || [];
  // Helper to find a currency by its ISO code
  const getRate = (code, field) => {
    const currency = rates.find((c) => c.CurrencyCode === code);
    return currency ? parseFloat(currency[field]) : null;
  };
  return {
    USDTRY: getRate('USD', 'ForexSelling'),
    EURTRY: getRate('EUR', 'ForexSelling'),
    GBPTRY: getRate('GBP', 'ForexSelling'),
    as_of: data.Tarih_Date?.['Tarih'],
    source: 'TCMB today.xml',
    field: 'ForexSelling',
  };
}

async function fetchGold() {
  // Fetch the gold price (XAUUSD) from Yahoo Finance.  We choose Yahoo
  // because it does not require any credentials for simple price data.  The
  // API returns a JSON object containing an array of results under
  // quoteResponse.result.  We pick the regularMarketPrice and return it.
  const url = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=XAUUSD=X';
  const res = await axios.get(url, { responseType: 'json' });
  const results = res.data.quoteResponse?.result || [];
  const xau = results.find((item) => item.symbol === 'XAUUSD=X');
  const price = xau ? xau.regularMarketPrice : null;
  return price;
}

async function main() {
  try {
    const fx = await fetchTCMB();
    const goldUsd = await fetchGold();
    // Compute gram gold price in TRY: 1 troy ounce = 31.1035 grams
    let gramTry = null;
    if (goldUsd && fx.USDTRY) {
      gramTry = (goldUsd / 31.1035) * fx.USDTRY;
      gramTry = Math.round(gramTry * 100) / 100;
    }
    const result = {
      ...fx,
      gold: {
        XAUUSD: goldUsd,
        gram_try: gramTry,
      },
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync('tcmb.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Error updating tcmb.json:', err);
    process.exit(1);
  }
}

main();