/**
 * Node で動かすときの通信・キャッシュ・待機（cli.js と scripts/build-site.js で共通）。
 */
const fs = require('node:fs');
const path = require('node:path');

const CACHE_FILE = path.join(__dirname, '..', '.cache', 'arrivals.json');
const USER_AGENT = 'Mozilla/5.0 (compatible; odawara-commute-helper)';

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return new TextDecoder('euc-jp').decode(await res.arrayBuffer());
}

/** 到着時刻のキャッシュ。.cache/arrivals.json に保存する */
function loadCache(file = CACHE_FILE) {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return {
    get: (key) => data[key],
    set: (key, value) => {
      data[key] = value;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    },
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { fetchText, loadCache, sleep };
