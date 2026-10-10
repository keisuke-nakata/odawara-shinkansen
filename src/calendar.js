/**
 * Google カレンダーの予定作成画面を、列車の内容を入れた状態で開く URL を作る。
 * 開いた画面で「保存」を押すと登録される。
 */

const { addDays } = require('./dates');

const CALENDAR_URL = 'https://calendar.google.com/calendar/render';

// 例: 🚄 08:03→08:36 こだま916号
function eventTitle(train) {
  return `🚄 ${train.dep}→${train.arr} ${train.name}`;
}

function eventDetails(train) {
  return `${train.from} ${train.dep}発 → ${train.to} ${train.arr}着`;
}

// 2026-10-07 + 08:03 → 20261007T080300
function compactDateTime(date, time) {
  return `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
}

/**
 * @param {string} date 乗車日 (YYYY-MM-DD)
 * @param {{name: string, from: string, to: string, dep: string, arr: string}} train
 * @param {{account?: string}} [options] account: 登録先の Google アカウント（メールアドレス）
 */
function calendarUrl(date, train, { account } = {}) {
  const endDate = train.arr < train.dep ? addDays(date, 1) : date;
  const params = [
    ['action', 'TEMPLATE'],
    ['text', eventTitle(train)],
    ['dates', `${compactDateTime(date, train.dep)}/${compactDateTime(endDate, train.arr)}`],
    ['ctz', 'Asia/Tokyo'],
    ['location', `${train.from}駅`],
    ['details', eventDetails(train)],
  ];
  if (account) params.push(['authuser', account]);
  return `${CALENDAR_URL}?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

module.exports = { calendarUrl, eventTitle };
