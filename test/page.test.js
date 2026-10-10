const test = require('node:test');
const assert = require('node:assert/strict');
const { calendarUrl } = require('../src/calendar');
const { resolveDate } = require('../src/dates');
const { renderPage, renderErrorPage } = require('../src/page');

const up = {
  direction: 'up', name: 'こだま916号', type: 'こだま', number: 916, car: 'N700系', special: false,
  dest: '東京', from: '小田原', to: '東京', dep: '08:03', arr: '08:36',
};
const down = {
  direction: 'down', name: 'ひかり653号', type: 'ひかり', number: 653, car: 'N700系', special: true,
  dest: '新大阪', from: '東京', to: '小田原', dep: '17:33', arr: '18:06',
};

test('calendarUrl: 列車の内容を入れた予定作成画面の URL', () => {
  const url = new URL(calendarUrl('2026-10-07', up, { account: 'someone@example.com' }));
  assert.equal(url.origin + url.pathname, 'https://calendar.google.com/calendar/render');
  const q = url.searchParams;
  assert.equal(q.get('action'), 'TEMPLATE');
  assert.equal(q.get('text'), '🚄 08:03→08:36 こだま916号');
  assert.equal(q.get('dates'), '20261007T080300/20261007T083600');
  assert.equal(q.get('ctz'), 'Asia/Tokyo');
  assert.equal(q.get('location'), '小田原駅');
  assert.equal(q.get('details'), '小田原 08:03発 → 東京 08:36着');
  assert.equal(q.get('authuser'), 'someone@example.com');
});

test('calendarUrl: アカウント指定なし・日付をまたぐ列車', () => {
  const url = new URL(calendarUrl('2026-10-07', { ...up, dep: '23:50', arr: '00:20' }));
  assert.equal(url.searchParams.get('authuser'), null);
  assert.equal(url.searchParams.get('dates'), '20261007T235000/20261008T002000');
});

test('resolveDate: YYYY-MM-DD・M/D・曜日', () => {
  const today = '2026-10-04'; // 日曜
  assert.equal(resolveDate('2026-10-07', today), '2026-10-07');
  assert.equal(resolveDate('10/7', today), '2026-10-07');
  assert.equal(resolveDate('1/8', today), '2027-01-08');
  assert.equal(resolveDate('水', today), '2026-10-07');
  assert.equal(resolveDate('水曜', today), '2026-10-07');
  assert.equal(resolveDate('日', today), '2026-10-04');
  assert.throws(() => resolveDate('来週', today), /指定してください/);
});

test('renderPage: 往路・復路と登録リンクを出す', () => {
  const html = renderPage(
    { date: '2026-10-07', warning: null, up: [up, { ...up, name: 'こだま918号', arr: null }], down: [down] },
    { account: 'someone@example.com', generatedAt: '2026-10-04 18:00', today: '2026-10-04' },
  );
  assert.match(html, /<title>新幹線 10\/7\(水\)<\/title>/);
  assert.ok(!html.includes('N700'));
  assert.match(html, /往路　小田原 → 東京/);
  assert.match(html, /復路　東京 → 小田原/);
  // 到着時刻が分からない列車にはリンクを出さない
  assert.equal(html.match(/カレンダーに<\/span>登録<\/a>/g).length, 2);
  assert.match(html, /到着時刻不明/);
  assert.match(html, /◆ 臨時列車/);
  assert.match(html, /登録先: someone@example.com/);
  // URL 中の & はエスケープされている
  assert.ok(!/href="[^"]*&(?!amp;)/.test(html));
});

test('renderPage: 警告を表示し、HTML をエスケープする', () => {
  const html = renderPage(
    { date: '2026-12-24', warning: '<b>注意</b>', up: [{ ...up, name: '<script>' }], down: [] },
    { generatedAt: '2026-10-04 18:00', today: '2026-10-04' },
  );
  assert.match(html, /&lt;b&gt;注意&lt;\/b&gt;/);
  assert.match(html, /&lt;script&gt;/);
  assert.equal(html.match(/<script>/g).length, 1); // ページ自身の script だけ
  assert.ok(!html.includes('登録先:'));
});

const emptyDay = (date) => ({ date, warning: null, up: [], down: [] });
const navOf = (html) => html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));

test('renderPage: 前日・翌日・今日へのリンクと日付の入力欄', () => {
  const nav = navOf(renderPage(emptyDay('2026-10-07'), { generatedAt: '', today: '2026-10-04' }));
  assert.match(nav, /<a class="btn" id="prev" href="\/2026-10-06">/);
  assert.match(nav, /<a class="btn" id="next" href="\/2026-10-08">/);
  assert.match(nav, /<a class="btn" href="\/2026-10-04">今日<\/a>/);
  assert.match(nav, /<input type="date" id="date" value="2026-10-07" min="2026-10-04" max="2026-11-04"/);
});

test('renderPage: 今日より前・1ヶ月より先へは移動できない', () => {
  const first = navOf(renderPage(emptyDay('2026-10-04'), { generatedAt: '', today: '2026-10-04' }));
  assert.match(first, /<span class="btn disabled" id="prev">/);
  assert.ok(!first.includes('今日'));
  const last = navOf(renderPage(emptyDay('2026-11-04'), { generatedAt: '', today: '2026-10-04' }));
  assert.match(last, /<span class="btn disabled" id="next">/);
});

test('renderErrorPage: エラーを表示し、日付は移動できる', () => {
  const html = renderErrorPage('2026-10-07', 'HTTP 503', { today: '2026-10-04' });
  assert.match(html, /時刻表を取得できませんでした: HTTP 503/);
  assert.match(html, /id="next" href="\/2026-10-08"/);
});

test('renderPage: 公開用の静的ページ向けに、日付ページの URL の形を変えられる', () => {
  const html = renderPage(emptyDay('2026-10-07'), { generatedAt: '', today: '2026-10-04', linkTemplate: './{date}.html' });
  const nav = navOf(html);
  assert.match(nav, /id="next" href="\.\/2026-10-08\.html"/);
  assert.match(nav, /data-link-template="\.\/\{date\}\.html"/);
});

test('renderPage: 登録先アカウントがなければ、ページには書かず入力欄を出す', () => {
  const html = renderPage(
    { date: '2026-10-07', warning: null, up: [up], down: [] },
    { generatedAt: '', today: '2026-10-04' },
  );
  assert.match(html, /<input type="email" id="account"/);
  assert.ok(!/href="[^"]*authuser/.test(html));
  assert.ok(!html.includes('登録先:'));

  const withAccount = renderPage(
    { date: '2026-10-07', warning: null, up: [up], down: [] },
    { account: 'someone@example.com', generatedAt: '', today: '2026-10-04' },
  );
  assert.ok(!withAccount.includes('id="account"'));
  assert.match(withAccount, /authuser=someone%40example\.com/);
});

test('renderPage: 検索エンジンに載らないようにする', () => {
  const html = renderPage(emptyDay('2026-10-07'), { generatedAt: '', today: '2026-10-04' });
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
});
