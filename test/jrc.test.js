const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jrc = require('../src/jrc');

// fixtures は公式サイトから取得したままの EUC-JP の HTML
function fixture(name) {
  return new TextDecoder('euc-jp').decode(fs.readFileSync(path.join(__dirname, 'fixtures', name)));
}

test('parseTrainName: 列車名・車両・臨時マークを分解する', () => {
  assert.deepEqual(jrc.parseTrainName('こだま916号（N700系）'), {
    name: 'こだま916号', type: 'こだま', number: 916, car: 'N700系', special: false,
  });
  assert.equal(jrc.parseTrainName('◆ひかり642号（N700S系）').special, true);
  assert.equal(jrc.parseTrainName('東海道本線(小金井行)'), null);
});

test('parseStationTimetable: 小田原駅 上り', () => {
  const { date, trains } = jrc.parseStationTimetable(fixture('station-up-2026-10-04.html'));
  assert.equal(date, '2026-10-04');
  assert.deepEqual(trains[0], {
    name: 'こだま900号', type: 'こだま', number: 900, car: 'N700S系', special: false,
    time: '06:33', dest: '東京',
  });
  assert.ok(trains.some((t) => t.name === 'ひかり642号' && t.time === '10:39'));
  assert.ok(trains.every((t) => t.type !== 'のぞみ'));
  // 時刻順に並んでいる
  const times = trains.map((t) => t.time);
  assert.deepEqual(times, [...times].sort());
});

test('parseStationTimetable: 小田原駅 下り（小田原始発の列車も含む）', () => {
  const { date, trains } = jrc.parseStationTimetable(fixture('station-down-2026-10-07.html'));
  assert.equal(date, '2026-10-07');
  assert.equal(trains[0].name, 'ひかり733号');
  assert.equal(trains[0].time, '06:17');
  assert.equal(trains[0].dest, '広島');
});

test('parseStationTimetable: 分の後ろに ◆ が付く臨時列車も読み取る', () => {
  const { trains } = jrc.parseStationTimetable(fixture('station-up-2026-10-10.html'));
  const special = trains.filter((t) => t.special);
  assert.deepEqual(special.map((t) => [t.name, t.time]), [['こだま924号', '10:35']]);
  // 土曜なので平日のみ運転の列車は載っていない
  assert.ok(!trains.some((t) => t.name === 'こだま902号'));
});

test('parseStationTimetable: 読み取れない列車があればエラー', () => {
  const html = fixture('station-up-2026-10-10.html').replace('<B>35</B>◆', '<B>35</B><I>◆</I>');
  assert.throws(() => jrc.parseStationTimetable(html), /ページの形式が変わった可能性/);
});

test('parseRouteSearch / findDirectLeg: 東京→小田原の到着基準検索', () => {
  const routes = jrc.parseRouteSearch(fixture('route-down-kodama801-2026-10-07.html'));
  const leg = jrc.findDirectLeg(routes, 'こだま801号');
  assert.equal(leg.from, '東京');
  assert.equal(leg.to, '小田原');
  assert.equal(leg.dep, '06:30');
  assert.equal(leg.arr, '07:03');
  assert.equal(jrc.findDirectLeg(routes, 'こだま803号'), null);
});

// 駅の時刻表は fixture、経路検索は「小田原発の33分前に東京発・2分前に小田原着」を返す偽物
function fakeSite(stationFixture) {
  const station = fixture(stationFixture);
  const { trains } = jrc.parseStationTimetable(station);
  const calls = { station: 0, route: 0 };
  const shift = (time, min) => {
    const t = Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + min;
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  };
  async function fetchText(url) {
    const q = new URL(url).searchParams;
    if (q.get('MODE') === '7') {
      calls.station++;
      return station;
    }
    calls.route++;
    const time = `${q.get('HOUR').padStart(2, '0')}:${q.get('MINT').padStart(2, '0')}`;
    const train = trains.find((t) => t.time === time);
    if (!train || train.name === 'ひかり733号') return '<html>経路なし</html>';
    const csv = ['0_0', 1, '東海道・山陽新幹線', '東京', '小田原', '83.9km', '33分', '', '', 1, 1, '#0',
      shift(time, -33), shift(time, -2), '', `${train.name}（${train.car}）`].join(',');
    return `<script>RouteCsv[0] = "${csv}";</script>`;
  }
  return { fetchText, calls, trains };
}

function memoryCache() {
  const data = new Map();
  return { get: (k) => data.get(k), set: (k, v) => data.set(k, v), data };
}

test('getTrains: 下りは東京から乗れない列車を除き、2回目は経路検索しない', async () => {
  const site = fakeSite('station-down-2026-10-07.html');
  const cache = memoryCache();
  const deps = { fetchText: site.fetchText, cache, today: '2026-10-04' };

  const first = await jrc.getTrains('2026-10-07', 'down', deps);
  assert.equal(first.length, site.trains.length - 1);
  assert.ok(first.every((t) => t.name !== 'ひかり733号'));
  assert.deepEqual(first[0], {
    direction: 'down', name: 'ひかり631号', type: 'ひかり', number: 631, car: 'N700系',
    special: false, dest: '新大阪', from: '東京', to: '小田原', dep: '06:23', arr: '06:54',
  });
  assert.equal(site.calls.route, site.trains.length);

  const second = await jrc.getTrains('2026-10-07', 'down', deps);
  assert.deepEqual(second, first);
  assert.equal(site.calls.route, site.trains.length);
});

test('getTrains: 古いキャッシュは取り直す', async () => {
  const site = fakeSite('station-down-2026-10-07.html');
  const cache = memoryCache();
  await jrc.getTrains('2026-10-07', 'down', { fetchText: site.fetchText, cache, today: '2026-10-04' });
  const before = site.calls.route;
  await jrc.getTrains('2026-10-07', 'down', {
    fetchText: site.fetchText, cache, today: '2027-01-01', cacheMaxAgeDays: 60,
  });
  assert.equal(site.calls.route, before * 2);
});

test('getTrains: 要求と違う日付の時刻表が返ってきたらエラー', async () => {
  const site = fakeSite('station-down-2026-10-07.html');
  await assert.rejects(
    jrc.getTrains('2026-10-08', 'down', { fetchText: site.fetchText, cache: memoryCache() }),
    /2026-10-08 の時刻表を取得できませんでした/,
  );
});

test('rangeWarning: 過去と1ヶ月より先の日付だけ警告する', () => {
  assert.equal(jrc.rangeWarning('2026-10-07', '2026-10-04'), null);
  assert.equal(jrc.rangeWarning('2026-11-04', '2026-10-04'), null);
  assert.match(jrc.rangeWarning('2026-12-24', '2026-10-04'), /反映されていない可能性/);
  assert.match(jrc.rangeWarning('2026-10-03', '2026-10-04'), /過去の日付/);
});
