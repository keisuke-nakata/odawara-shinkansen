/**
 * JR東海公式サイトの時刻表から、小田原⇔東京の停車列車と発着時刻を取得する。
 *
 * - 列車一覧: 小田原駅の「各駅の時刻表」（上り・下り各1リクエスト）。
 *   駅の時刻表なので、小田原に停車する列車（こだま・一部のひかり）だけが載っている。
 * - 到着時刻: 駅の時刻表には載っていないので、列車ごとに経路検索で補う。
 *   結果はキャッシュし、2回目以降は通信しない。
 *
 * テストしやすいよう、通信・キャッシュ・待機は呼び出し側から注入する。
 */

const CGI_URL = 'https://railway.jr-central.co.jp/cgi-bin/timetable/tokainr.cgi';

// CGI は EUC-JP なので、使う語句をあらかじめパーセントエンコードしておく
const EUC = {
  odawara: '%BE%AE%C5%C4%B8%B6', // 小田原
  tokyo: '%C5%EC%B5%FE', // 東京
  line: '%C5%EC%B3%A4%C6%BB%A1%A6%BB%B3%CD%DB%BF%B7%B4%B4%C0%FE', // 東海道・山陽新幹線
};

const SHINKANSEN_LINE = '東海道・山陽新幹線';

const DIRECTIONS = {
  up: { label: '上り', from: '小田原', to: '東京', diad: 2, ekis: EUC.odawara, ekie: EUC.tokyo },
  down: { label: '下り', from: '東京', to: '小田原', diad: 1, ekis: EUC.tokyo, ekie: EUC.odawara },
};

// 経路検索の利用列車フラグ (TRCB)。種別を1つに絞り、追い越す列車が返ってこないようにする。
// 0x01: 新幹線を利用, 0x02: のぞみを除く, 0x04: 特急・急行, 0x10: ホームライナー等,
// 0x200: ひかり, 0x400: こだま
const TRCB_BASE = 0x01 | 0x02 | 0x04 | 0x10;
const TRCB = { ひかり: TRCB_BASE | 0x200, こだま: TRCB_BASE | 0x400 };

// 経路検索の検索基準 (TYPE)
const SEARCH_BY_DEPARTURE = 0;
const SEARCH_BY_ARRIVAL = 1;

// RouteCsv の1区間あたりのフィールド数と、使うフィールドの位置
const LEG_FIELDS = 14;
const LEG = { line: 0, from: 1, to: 2, dep: 10, arr: 11, name: 13 };

const DEFAULT_CACHE_MAX_AGE_DAYS = 60;
const OFFICIAL_RANGE_DAYS = 31;

function parseDate(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`日付は YYYY-MM-DD 形式で指定してください: ${date}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function normalizeTime(time) {
  const [h, m] = time.split(':');
  return `${pad2(Number(h))}:${pad2(Number(m))}`;
}

function dateParams(date) {
  const { y, m, d } = parseDate(date);
  return `YEAR=${y - 1900}&MONH=${m - 1}&DATE=${d}`;
}

function stationTimetableUrl(date, direction) {
  const dir = DIRECTIONS[direction];
  return `${CGI_URL}?MODE=7&HOUR=0&${dateParams(date)}` +
    `&DIAF=${EUC.odawara}&DIAR=${EUC.line}&DIAD=${dir.diad}`;
}

function routeSearchUrl(date, direction, time, trainType, searchType) {
  const dir = DIRECTIONS[direction];
  const [h, m] = time.split(':').map(Number);
  return `${CGI_URL}?MODE=0&${dateParams(date)}&HOUR=${h}&MINT=${m}` +
    `&InsPos=0&CSVN=&TRCB=${TRCB[trainType]}&SEAT=0&TYPE=${searchType}` +
    `&EKIS=${dir.ekis}&EKIE=${dir.ekie}&EKI1=&EKI2=`;
}

/** "◆こだま916号（N700系）" → { name: 'こだま916号', type: 'こだま', number: 916, car: 'N700系', special: true } */
function parseTrainName(text) {
  const m = /^\s*(◆)?\s*(のぞみ|ひかり|こだま)(\d+)号(?:（(.+?)）)?/.exec(text);
  if (!m) return null;
  return {
    name: `${m[2]}${m[3]}号`,
    type: m[2],
    number: Number(m[3]),
    car: m[4] || null,
    special: Boolean(m[1]),
  };
}

/** 駅の時刻表ページ (MODE=7) を解析する。 */
function parseStationTimetable(html) {
  const dateMatch = /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*[（(]/.exec(html);
  const date = dateMatch ? `${dateMatch[1]}-${pad2(dateMatch[2])}-${pad2(dateMatch[3])}` : null;

  // 時の見出しと列車のセルが出現順に並んでいるので、まとめて走査する。
  // 臨時列車などは分の直後に ◆ が付く（例: <B>35</B>◆）
  const re = /<FONT size=4><B>(\d{1,2})<\/B>|class=S>([^<]+)<TR><TD nowrap class=M\w><B>(\d{1,2})<\/B>([^<]*)<TR><TD nowrap class=S>([^<]*)/gi;
  const trains = [];
  let cells = 0;
  let hour = null;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1] !== undefined) {
      hour = Number(m[1]);
      continue;
    }
    const train = parseTrainName(m[2]);
    if (!train || hour === null) continue;
    cells++;
    if (train.type === 'のぞみ') continue;
    trains.push({
      ...train,
      special: train.special || m[4].includes('◆'),
      time: `${pad2(hour)}:${pad2(m[3])}`,
      dest: m[5].trim(),
    });
  }

  // ページの形式が変わって列車を黙って取りこぼすことがないよう、列車名の数と突き合わせる
  const names = (html.match(/class=S>\s*◆?\s*(?:のぞみ|ひかり|こだま)\d+号/g) || []).length;
  if (names !== cells) {
    throw new Error(`時刻表の列車 ${names} 本のうち ${cells} 本しか読み取れませんでした。ページの形式が変わった可能性があります。`);
  }
  return { date, trains };
}

/** 経路検索の結果ページ (MODE=0) から、RouteCsv に埋め込まれた経路を取り出す。 */
function parseRouteSearch(html) {
  const routes = [];
  const re = /RouteCsv\[\d+\]\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const f = m[1].split(',');
    const legCount = Number(f[1]);
    const legs = [];
    for (let i = 0; i < legCount; i++) {
      const leg = f.slice(2 + i * LEG_FIELDS, 2 + (i + 1) * LEG_FIELDS);
      legs.push({
        line: leg[LEG.line],
        from: leg[LEG.from],
        to: leg[LEG.to],
        dep: normalizeTime(leg[LEG.dep]),
        arr: normalizeTime(leg[LEG.arr]),
        train: leg[LEG.name],
      });
    }
    routes.push({ legs });
  }
  return routes;
}

/** 経路検索の結果から、指定列車で乗り換えなしの経路を探す。 */
function findDirectLeg(routes, trainName) {
  for (const { legs } of routes) {
    if (legs.length !== 1) continue;
    const leg = legs[0];
    const train = parseTrainName(leg.train);
    if (leg.line === SHINKANSEN_LINE && train && train.name === trainName) return leg;
  }
  return null;
}

/**
 * 1本の列車について、経路検索で発着時刻を調べる。
 * - 上り: 小田原発の時刻で「出発」検索 → 小田原発・東京着
 * - 下り: 小田原発の時刻で「到着」検索 → 東京発・小田原着
 *   （小田原で停車中に追い越されることがあるので、小田原着は発車時刻より早いことがある）
 */
async function lookupTimes(date, direction, train, fetchText) {
  const searchType = direction === 'up' ? SEARCH_BY_DEPARTURE : SEARCH_BY_ARRIVAL;
  const html = await fetchText(routeSearchUrl(date, direction, train.time, train.type, searchType));
  const leg = findDirectLeg(parseRouteSearch(html), train.name);
  if (!leg) return null;
  if (direction === 'up' && leg.dep !== train.time) return null;
  return { dep: leg.dep, arr: leg.arr };
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/**
 * 指定日・指定方向の、小田原に停車する列車の一覧を返す。
 *
 * @param {string} date YYYY-MM-DD（公式サイトの都合で、当日から約1ヶ月先まで）
 * @param {'up'|'down'} direction up: 小田原→東京, down: 東京→小田原
 * @param {object} deps
 * @param {(url: string) => Promise<string>} deps.fetchText EUC-JP をデコード済みの本文を返す
 * @param {{get(key: string): any, set(key: string, value: any): void}} deps.cache
 * @param {(ms: number) => Promise<void>} [deps.sleep] 経路検索の前に呼ぶ（サーバー負荷への配慮）
 * @param {number} [deps.interval] 経路検索の間隔 (ms)
 * @param {string} [deps.today] キャッシュの鮮度判定に使う今日の日付 (YYYY-MM-DD)
 * @param {(done: number, total: number) => void} [deps.onProgress]
 */
async function getTrains(date, direction, deps) {
  const {
    fetchText,
    cache,
    sleep = async () => {},
    interval = 1000,
    today = date,
    cacheMaxAgeDays = DEFAULT_CACHE_MAX_AGE_DAYS,
    onProgress = () => {},
  } = deps;
  const dir = DIRECTIONS[direction];
  if (!dir) throw new Error(`direction は up か down です: ${direction}`);

  const timetable = parseStationTimetable(await fetchText(stationTimetableUrl(date, direction)));
  if (timetable.date !== date) {
    throw new Error(`${date} の時刻表を取得できませんでした（取得できたのは ${timetable.date} の時刻表）。`);
  }

  const result = [];
  for (const [i, train] of timetable.trains.entries()) {
    // 臨時列車（◆）は運転日によって時刻が変わりうるので、日付ごとにキャッシュする
    const key = [direction, train.name, train.time, train.special ? date : ''].join('|');
    let times = cache.get(key);
    if (times && daysBetween(times.checkedAt, today) > cacheMaxAgeDays) times = null;
    if (!times) {
      await sleep(interval);
      // 見つからなかったことも記録して、毎回問い合わせないようにする
      const found = await lookupTimes(date, direction, train, fetchText);
      times = { dep: null, arr: null, ...found, checkedAt: today };
      cache.set(key, times);
    }
    onProgress(i + 1, timetable.trains.length);

    // 下りで東京からの経路が見つからないのは、小田原始発など東京から乗れない列車
    if (direction === 'down' && !times.dep) continue;

    result.push({
      direction,
      name: train.name,
      type: train.type,
      number: train.number,
      car: train.car,
      special: train.special,
      dest: train.dest,
      from: dir.from,
      to: dir.to,
      // 上りの小田原発は駅の時刻表の値をそのまま使える。それ以外は経路検索の結果（不明なら null）
      dep: direction === 'up' ? train.time : times.dep,
      arr: times.arr,
    });
  }
  return result;
}

/**
 * 公式サイトは任意の日付を表示するが、画面上で選べるのは当日から1ヶ月先まで。
 * それより先は臨時列車やダイヤ改正が反映されていない可能性があるので、警告文を返す。
 */
function rangeWarning(date, today) {
  const days = daysBetween(today, date);
  if (days < 0) return `${date} は過去の日付です。`;
  if (days > OFFICIAL_RANGE_DAYS) {
    return `${date} は公式サイトで案内されている範囲（当日から約1ヶ月先）より先なので、` +
      '臨時列車やダイヤ改正が反映されていない可能性があります。';
  }
  return null;
}

/** 指定日の往路（上り）と復路（下り）をまとめて返す。 */
async function getDay(date, deps) {
  const up = await getTrains(date, 'up', deps);
  const down = await getTrains(date, 'down', deps);
  return { date, warning: rangeWarning(date, deps.today || date), up, down };
}

if (typeof module !== 'undefined') {
  module.exports = {
    DIRECTIONS,
    parseTrainName,
    parseStationTimetable,
    parseRouteSearch,
    findDirectLeg,
    stationTimetableUrl,
    routeSearchUrl,
    getTrains,
    getDay,
    rangeWarning,
  };
}
