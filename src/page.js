/**
 * 往路・復路の列車一覧を、カレンダー登録リンクと日付移動つきの HTML ページにする。
 */
const { calendarUrl } = require('./calendar');
const { weekdayOf, addDays } = require('./dates');

const SPECIAL_NOTE = '臨時列車、または運転日により行先・停車駅などが変わる列車';
// 公式サイトの画面で選べる範囲（当日から約1ヶ月先）に合わせる
const NAV_RANGE_DAYS = 31;
// 日付ごとのページの URL。公開用の静的ページでは ./{date}.html になる
const DEFAULT_LINK_TEMPLATE = '/{date}';
// 公開用のページで、カレンダーの登録先アカウントをブラウザに覚えておくときのキー
const ACCOUNT_STORAGE_KEY = 'odawara-shinkansen:calendarAccount';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function dateLabel(date) {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}(${weekdayOf(date)})`;
}

function pageTitle(date) {
  return `新幹線 ${dateLabel(date)}`;
}

function renderTrain(date, train, account) {
  const type = train.type === 'ひかり' ? 'hikari' : 'kodama';
  const special = train.special
    ? `<span class="special" title="${SPECIAL_NOTE}">◆</span>` : '';
  const action = train.dep && train.arr
    ? `<a class="add" href="${escapeHtml(calendarUrl(date, train, { account }))}" target="_blank" rel="noopener"><span class="long">カレンダーに</span>登録</a>`
    : '<span class="unknown">到着時刻不明</span>';
  return `
      <li class="train">
        <span class="time">${train.dep ?? '--:--'}<span class="arrow">→</span>${train.arr ?? '--:--'}</span>
        <span class="name ${type}">${special}${escapeHtml(train.name)}</span>
        ${action}
      </li>`;
}

function renderColumn(date, title, trains, account) {
  // 出発時刻の「時」ごとに区切ると、目で追いやすい
  const groups = new Map();
  for (const t of trains) {
    const hour = t.dep.slice(0, 2);
    if (!groups.has(hour)) groups.set(hour, []);
    groups.get(hour).push(t);
  }
  const body = [...groups].map(([hour, ts]) => `
    <li class="hour"><span>${Number(hour)}時</span>
      <ul>${ts.map((t) => renderTrain(date, t, account)).join('')}
      </ul>
    </li>`).join('');
  return `
  <section>
    <h2>${title}</h2>
    <ul class="hours">${body}
    </ul>
  </section>`;
}

function renderNav(date, today, linkTemplate) {
  const max = addDays(today, NAV_RANGE_DAYS);
  const href = (d) => escapeHtml(linkTemplate.replace('{date}', d));
  const link = (id, target, text, enabled) => (enabled
    ? `<a class="btn" id="${id}" href="${href(target)}">${text}</a>`
    : `<span class="btn disabled" id="${id}">${text}</span>`);
  return `
    <nav class="nav" aria-label="日付の移動" data-link-template="${escapeHtml(linkTemplate)}">
      ${link('prev', addDays(date, -1), '‹ 前日', date > today)}
      <input type="date" id="date" value="${date}" min="${today}" max="${max}" aria-label="日付を選ぶ">
      ${link('next', addDays(date, 1), '翌日 ›', date < max)}
      ${date !== today ? `<a class="btn" href="${href(today)}">今日</a>` : ''}
    </nav>`;
}

const STYLE = `
  :root {
    --bg: #f6f5f3; --surface: #ffffff; --text: #1d1b19; --muted: #77716b; --border: #e6e2dd;
    --row-hover: #f3f1ee; --kodama: #1f5fd1; --hikari: #c92a2a; --link: #0b6e66;
    --link-bg: #e3f2f0; --warn-bg: #fdf3d8; --warn-text: #7a4b00;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #121110; --surface: #1c1a18; --text: #f2efec; --muted: #a09992; --border: #2f2c29;
      --row-hover: #25221f; --kodama: #79a8ff; --hikari: #ff8a80; --link: #5fd4c6;
      --link-bg: #173432; --warn-bg: #3a2c0c; --warn-text: #f5cd6b;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font-family: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
    line-height: 1.5;
  }
  main { max-width: 1040px; margin: 0 auto; padding: 28px 16px 48px; }
  header {
    display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between;
    gap: 12px 20px; margin-bottom: 20px;
  }
  h1 { font-size: 1.5rem; margin: 0; letter-spacing: .02em; }
  .sub { color: var(--muted); font-size: .875rem; margin-top: 2px; }
  .nav { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .btn, .nav input {
    font: inherit; font-size: .875rem; color: var(--text); background: var(--surface);
    border: 1px solid var(--border); border-radius: 8px; padding: 5px 12px;
    text-decoration: none; white-space: nowrap;
  }
  .nav input { padding: 4px 8px; color-scheme: light dark; }
  a.btn:hover { background: var(--row-hover); }
  .btn.disabled { color: var(--muted); opacity: .5; }
  .warning, .error {
    flex-basis: 100%; background: var(--warn-bg); color: var(--warn-text); border-radius: 8px;
    padding: 10px 14px; font-size: .875rem;
  }
  .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
  @media (max-width: 760px) { .columns { grid-template-columns: 1fr; } }
  section {
    background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: clip;
  }
  h2 {
    position: sticky; top: 0; z-index: 1; margin: 0; padding: 12px 16px;
    font-size: 1rem; background: var(--surface); border-bottom: 1px solid var(--border);
  }
  ul { list-style: none; margin: 0; padding: 0; }
  .hours { padding-bottom: 6px; }
  .hour > span {
    display: block; padding: 10px 16px 2px; font-size: .75rem; color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .train {
    display: grid; grid-template-columns: 7.5em 1fr auto; align-items: center; gap: 12px;
    padding: 5px 16px; font-variant-numeric: tabular-nums;
  }
  .train:hover { background: var(--row-hover); }
  .time { font-weight: 600; white-space: nowrap; }
  .arrow { color: var(--muted); font-weight: 400; margin: 0 .3em; }
  .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name.kodama { color: var(--kodama); }
  .name.hikari { color: var(--hikari); }
  .special { color: var(--warn-text); margin-right: 2px; cursor: help; }
  .add {
    font-size: .8125rem; color: var(--link); background: var(--link-bg); text-decoration: none;
    padding: 3px 10px; border-radius: 999px; white-space: nowrap;
  }
  .add:hover { text-decoration: underline; }
  .add:visited { opacity: .7; }
  .unknown { font-size: .8125rem; color: var(--muted); }
  @media (max-width: 480px) {
    .train { grid-template-columns: auto 1fr auto; gap: 10px; }
    .long { display: none; }
  }
  footer { color: var(--muted); font-size: .75rem; margin-top: 20px; line-height: 1.7; }
  .account input {
    font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--border);
    border-radius: 6px; padding: 2px 8px; margin-left: 4px; width: min(16em, 100%);
  }
  /* 日付を移動している間（時刻の取得中）の表示 */
  .loading-bar {
    position: fixed; top: 0; left: 0; width: 100%; height: 3px; background: var(--link);
    transform-origin: left; transform: scaleX(0);
  }
  body.loading .loading-bar { animation: loading 6s cubic-bezier(.1, .6, .2, 1) forwards; }
  body.loading .columns { opacity: .45; transition: opacity .15s; }
  @keyframes loading { to { transform: scaleX(.9); } }
  @media (prefers-reduced-motion: reduce) {
    body.loading .loading-bar { animation: none; transform: scaleX(.5); }
  }
`;

const SCRIPT = `
  const go = (href) => { document.body.classList.add('loading'); location.href = href; };
  document.querySelectorAll('.nav a').forEach((a) => a.addEventListener('click', (e) => {
    if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey) document.body.classList.add('loading');
  }));
  const picker = document.getElementById('date');
  picker.addEventListener('change', () => {
    const template = document.querySelector('.nav').dataset.linkTemplate;
    if (picker.value && picker.value !== picker.defaultValue) go(template.replace('{date}', picker.value));
  });
  // ← → キーで前日・翌日
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input') || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const target = { ArrowLeft: 'prev', ArrowRight: 'next' }[e.key];
    const a = target && document.querySelector('a#' + target);
    if (a) go(a.href);
  });
  // 「戻る」でキャッシュから表示されたときに、読み込み中の表示を消す
  window.addEventListener('pageshow', () => document.body.classList.remove('loading'));

  // 公開用のページでは、登録先アカウントをページに書かず、入力された値をこのブラウザに覚えておく
  const accountInput = document.getElementById('account');
  if (accountInput) {
    const KEY = '${ACCOUNT_STORAGE_KEY}';
    const links = [...document.querySelectorAll('a.add')];
    const baseHrefs = links.map((a) => a.href);
    const apply = (account) => links.forEach((a, i) => {
      a.href = account ? baseHrefs[i] + '&authuser=' + encodeURIComponent(account) : baseHrefs[i];
    });
    let saved = '';
    try { saved = localStorage.getItem(KEY) || ''; } catch (e) {}
    accountInput.value = saved;
    apply(saved);
    accountInput.addEventListener('change', () => {
      const value = accountInput.value.trim();
      try {
        if (value) localStorage.setItem(KEY, value);
        else localStorage.removeItem(KEY);
      } catch (e) {}
      apply(value);
    });
  }
`;

function layout({ date, today, linkTemplate = DEFAULT_LINK_TEMPLATE, warning, content, footer }) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${pageTitle(date)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="loading-bar" aria-hidden="true"></div>
<main>
  <header>
    <div>
      <h1>${dateLabel(date)} の新幹線</h1>
      <div class="sub">小田原 ⇔ 東京・小田原に停まる列車のみ</div>
    </div>${renderNav(date, today, linkTemplate)}
    ${warning}
  </header>${content}
  <footer>${footer}
  </footer>
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

/**
 * @param {{date: string, warning: string|null, up: object[], down: object[]}} day getDay の結果
 * @param {object} options
 * @param {string} options.generatedAt 時刻表を取得した日時
 * @param {string} options.today 今日の日付 (YYYY-MM-DD)。これより前と1ヶ月より先には移動できない
 * @param {string} [options.account] カレンダーの登録先。省略すると、ページ上で入力してブラウザに覚えておく
 * @param {string} [options.linkTemplate] 日付ごとのページの URL（{date} を日付に置き換える）
 */
function renderPage(day, { account, generatedAt, today, linkTemplate }) {
  const { date } = day;
  const hasSpecial = [...day.up, ...day.down].some((t) => t.special);
  return layout({
    date,
    today,
    linkTemplate,
    warning: day.warning ? `<div class="warning">${escapeHtml(day.warning)}</div>` : '',
    content: `
  <div class="columns">${renderColumn(date, '往路　小田原 → 東京', day.up, account)}${renderColumn(date, '復路　東京 → 小田原', day.down, account)}
  </div>`,
    footer: `
    ${hasSpecial ? `◆ ${SPECIAL_NOTE}<br>` : ''}
    「カレンダーに登録」を押すと、Google カレンダーの予定作成画面が開きます。「保存」で登録されます。${account ? `（登録先: ${escapeHtml(account)}）` : `<br>
    <label class="account">登録先の Google アカウント<input type="email" id="account" placeholder="メールアドレス" autocomplete="email"></label>（このブラウザにだけ保存されます）`}<br>
    JR東海公式サイトの時刻表から取得（${escapeHtml(generatedAt)}）。← → キーでも日付を移動できます。`,
  });
}

/** 時刻表を取得できなかったときのページ。日付の移動はできるようにしておく。 */
function renderErrorPage(date, message, { today, linkTemplate }) {
  return layout({
    date,
    today,
    linkTemplate,
    warning: `<div class="error">時刻表を取得できませんでした: ${escapeHtml(message)}</div>`,
    content: '',
    footer: '',
  });
}

module.exports = { renderPage, renderErrorPage };
