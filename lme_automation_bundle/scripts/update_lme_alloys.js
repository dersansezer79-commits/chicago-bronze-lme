/*
 * update_lme_alloys.js
 *
 * This script updates the file `lme.json` by copying data from an
 * upstream source.  The upstream source defaults to your GitHub raw
 * JSON file, but it can be customised via the LME_SOURCE_URL
 * environment variable.  It makes no attempt to scrape prices from
 * websites that may block automated requests.  Instead it assumes
 * that you maintain a canonical `lme.json` in your repository and
 * simply mirrors it into this folder.
 *
 * The script writes the fetched JSON verbatim to `lme.json` and
 * prints it to stdout.  If the fetch fails, it leaves the existing
 * `lme.json` in place.
 */

const fs = require('fs');
const axios = require('axios');

async function main() {
  // Provide a sensible default: this should point to the raw URL of the
  // lme.json file in your GitHub repository.  Override by setting
  // LME_SOURCE_URL in the workflow environment or local shell.
  const defaultUrl = 'https://raw.githubusercontent.com/your-user/your-repo/main/lme.json';
  const url = process.env.LME_SOURCE_URL || defaultUrl;
  try {
    const res = await axios.get(url, { responseType: 'json' });
    const data = res.data;
    fs.writeFileSync('lme.json', JSON.stringify(data, null, 2));
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to fetch lme.json from', url);
    console.error(err);
    // In the event of failure, preserve the existing file if present
    if (fs.existsSync('lme.json')) {
      console.log(fs.readFileSync('lme.json', 'utf-8'));
    }
  }
}

main();