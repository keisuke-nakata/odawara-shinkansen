const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildSite } = require('../scripts/build-site');
const jrc = require('../src/jrc');

function fixture(name) {
  return new TextDecoder('euc-jp').decode(fs.readFileSync(path.join(__dirname, 'fixtures', name)));
}

// 公式サイトの偽物。駅の時刻表は 10/7 の fixture の日付だけを書き換えて返す。
// 経路検索は、上りは「小田原発の33分後に東京着」、下りは「33分前に東京発・2分前に小田原着」
function fakeSite({ failOn } = {}) {
  const station = { 1: fixture('station-down-2026-10-07.html'), 2: fixture('station-up-2026-10-07.html') };
  const trains = {
    down: jrc.parseStationTimetable(station[1]).trains,
    up: jrc.parseStationTimetable(station[2]).trains,
  };
  const shift = (time, min) => {
    const t = Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + min;
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  };
  return async (url) => {
    const q = new URL(url).searchParams;
    const date = `${1900 + Number(q.get('YEAR'))}/${Number(q.get('MONH')) + 1}/${q.get('DATE')}`;
    if (date === failOn) throw new Error('HTTP 503');
    if (q.get('MODE') === '7') return station[q.get('DIAD')].replace('2026/10/7', date);

    const time = `${q.get('HOUR').padStart(2, '0')}:${q.get('MINT').padStart(2, '0')}`;
    const up = q.get('TYPE') === '0';
    const train = trains[up ? 'up' : 'down'].find((t) => t.time === time);
    if (!train || train.name === 'ひかり733号') return '<html>経路なし</html>';
    const [from, to, dep, arr] = up
      ? ['小田原', '東京', time, shift(time, 33)]
      : ['東京', '小田原', shift(time, -33), shift(time, -2)];
    const csv = ['0_0', 1, '東海道・山陽新幹線', from, to, '', '', '', '', 1, 1, '#0', dep, arr, '', train.name];
    return `<script>RouteCsv[0] = "${csv.join(',')}";</script>`;
  };
}

function memoryCache() {
  const data = new Map();
  return { get: (k) => data.get(k), set: (k, v) => data.set(k, v) };
}

const noSleep = async () => {};

test('buildSite: 日付ごとのページと、今日へ移動する index を作る', async (t) => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));

  const { dates } = await buildSite({
    outDir,
    today: '2026-10-07',
    daysAhead: 2,
    deps: { fetchText: fakeSite(), cache: memoryCache(), sleep: noSleep },
  });
  assert.deepEqual(dates, ['2026-10-07', '2026-10-08', '2026-10-09']);
  assert.deepEqual(fs.readdirSync(outDir).sort(),
    ['2026-10-07.html', '2026-10-08.html', '2026-10-09.html', 'index.html', 'robots.txt']);

  const page = fs.readFileSync(path.join(outDir, '2026-10-08.html'), 'utf8');
  assert.match(page, /10\/8\(木\) の新幹線/);
  assert.match(page, /08:03<span class="arrow">→<\/span>08:36/);
  assert.match(page, /id="prev" href="\.\/2026-10-07\.html"/);
  assert.match(page, /id="next" href="\.\/2026-10-09\.html"/);
  // 登録先アカウントはページに書かない
  assert.ok(!/href="[^"]*authuser/.test(page));
  assert.ok(!/[\w.-]+@[\w-]+\.[a-z]+/.test(page));

  const index = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
  assert.match(index, /const dates = \["2026-10-07","2026-10-08","2026-10-09"\]/);
  assert.equal(fs.readFileSync(path.join(outDir, 'robots.txt'), 'utf8'), 'User-agent: *\nDisallow: /\n');
});

test('buildSite: 1日でも取得に失敗したら、エラーにして前回のページを残す', async (t) => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outDir, 'index.html'), '前回のページ');

  await assert.rejects(
    buildSite({
      outDir,
      today: '2026-10-07',
      daysAhead: 2,
      deps: { fetchText: fakeSite({ failOn: '2026/10/8' }), cache: memoryCache(), sleep: noSleep },
    }),
    /取得できなかった日があります:\n2026-10-08: HTTP 503/,
  );
  assert.equal(fs.readFileSync(path.join(outDir, 'index.html'), 'utf8'), '前回のページ');
});
