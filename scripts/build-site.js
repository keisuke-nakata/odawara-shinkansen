#!/usr/bin/env node
/**
 * 公開用の静的ページを site/ に作る（GitHub Pages に置く）。
 *
 *   node scripts/build-site.js
 *
 * - site/YYYY-MM-DD.html … 今日から31日先までの日付ごとのページ（日付の移動つき）
 * - site/index.html … 開いた日の（日本時間の）今日のページへ移動する
 * - site/robots.txt … 検索エンジンに載らないようにする
 *
 * カレンダーの登録先アカウントはページに書かない（見るブラウザで入力して覚えておく）。
 * 1日でも取得に失敗したら終了コード 1 で終わる（GitHub Actions では公開せず、前回のページが残る）。
 */
const fs = require('node:fs');
const path = require('node:path');
const { getDay } = require('../src/jrc');
const { renderPage } = require('../src/page');
const { todayInTokyo, nowInTokyo, addDays } = require('../src/dates');

const ROOT = path.join(__dirname, '..');
const DAYS_AHEAD = 31;
const LINK_TEMPLATE = './{date}.html';

function indexPage(dates) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>小田原⇔東京 新幹線</title>
<script>
  const dates = ${JSON.stringify(dates)};
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
  location.replace('./' + (dates.includes(today) ? today : dates[0]) + '.html');
</script>
</head>
<body><a href="./${dates[0]}.html">時刻表を開く</a></body>
</html>
`;
}

/**
 * @param {object} options
 * @param {string} options.outDir
 * @param {object} options.deps getDay に渡す fetchText・cache・sleep
 * @param {string} [options.today]
 * @param {number} [options.daysAhead]
 * @param {number} [options.dayInterval] 日付ごとの取得の間隔 (ms)。公式サイトへの負荷を抑える
 * @param {(message: string) => void} [options.log]
 */
async function buildSite({
  outDir, deps, today = todayInTokyo(), daysAhead = DAYS_AHEAD, dayInterval = 1000, log = () => {},
}) {
  const generatedAt = nowInTokyo();
  const dates = Array.from({ length: daysAhead + 1 }, (_, i) => addDays(today, i));
  const pages = {};
  const failures = [];

  for (const [i, date] of dates.entries()) {
    if (i > 0) await deps.sleep(dayInterval);
    try {
      const day = await getDay(date, { ...deps, today });
      pages[`${date}.html`] = renderPage(day, { generatedAt, today, linkTemplate: LINK_TEMPLATE });
      log(`${date}: 往路 ${day.up.length} 本・復路 ${day.down.length} 本`);
    } catch (e) {
      failures.push(`${date}: ${e.message}`);
      log(`${date}: 失敗 ${e.message}`);
    }
  }
  if (failures.length) throw new Error(`取得できなかった日があります:\n${failures.join('\n')}`);

  pages['index.html'] = indexPage(dates);
  pages['robots.txt'] = 'User-agent: *\nDisallow: /\n';
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, content] of Object.entries(pages)) fs.writeFileSync(path.join(outDir, name), content);
  return { dates };
}

if (require.main === module) {
  const { fetchText, loadCache, sleep } = require('../src/node-io');
  buildSite({
    outDir: path.join(ROOT, 'site'),
    deps: { fetchText, cache: loadCache(), sleep },
    log: (message) => console.log(message),
  }).then(({ dates }) => {
    console.log(`site/ に ${dates.length} 日分のページを作りました`);
  }).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { buildSite };
