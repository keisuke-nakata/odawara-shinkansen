const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
// 表示する範囲は今日から31日先まで（公式サイトの画面で選べる範囲に合わせる）
const RANGE_DAYS = 31;

function todayInTokyo() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

/** 例: 2026-10-04 18:20 */
function nowInTokyo() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date());
}

/** YYYY-MM-DD 形式で、実在する日付か */
function isValidDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) &&
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}

function weekdayOf(date) {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

function toIso(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isWithinRange(date, today) {
  return date >= today && date <= addDays(today, RANGE_DAYS);
}

/**
 * コマンドラインで指定された日付を YYYY-MM-DD にする。
 * - 2026-10-07
 * - 10/7 … 今日より前なら来年
 * - 水 … 今日を含めて次の水曜日
 */
function resolveDate(input, today) {
  if (isValidDate(input)) return input;

  const md = /^(\d{1,2})\/(\d{1,2})$/.exec(input);
  if (md) {
    const year = Number(today.slice(0, 4));
    const date = toIso(year, Number(md[1]), Number(md[2]));
    const resolved = date < today ? toIso(year + 1, Number(md[1]), Number(md[2])) : date;
    if (isValidDate(resolved)) return resolved;
  }

  const wd = WEEKDAYS.indexOf(input.replace(/曜日?$/, ''));
  if (wd !== -1) {
    const diff = (wd - WEEKDAYS.indexOf(weekdayOf(today)) + 7) % 7;
    return addDays(today, diff);
  }

  throw new Error(`日付は 2026-10-07、10/7、水 のどれかの形で指定してください: ${input}`);
}

module.exports = {
  RANGE_DAYS, todayInTokyo, nowInTokyo, isValidDate, isWithinRange, weekdayOf, resolveDate, addDays,
};
