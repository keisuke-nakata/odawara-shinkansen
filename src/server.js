/**
 * 手元で動かす小さな Web サーバー。/2026-10-07 のような URL を開くと、その日の時刻表を表示する。
 */
const http = require('node:http');
const { renderPage, renderErrorPage } = require('./page');
const { isValidDate, nowInTokyo } = require('./dates');

// すでに起動しているサーバーがこのツールのものか確かめるための URL と応答
const HEALTH_PATH = '/__health';
const HEALTH_BODY = 'odawara-shinkansen';

/**
 * @param {object} options
 * @param {(date: string, today: string) => Promise<object>} options.loadDay getDay の結果を返す
 * @param {() => string} options.today 今日の日付 (YYYY-MM-DD)
 * @param {string} [options.account] カレンダーの登録先アカウント
 * @param {(message: string) => void} [options.log]
 */
function createServer({ loadDay, today, account, log = () => {} }) {
  // 公式サイトへの問い合わせが同時に走らないよう、1件ずつ処理する
  let queue = Promise.resolve();
  const serialized = (fn) => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };

  return http.createServer(async (req, res) => {
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
      res.end(body);
    };
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === HEALTH_PATH) return send(200, HEALTH_BODY, { 'Content-Type': 'text/plain' });

    const todayDate = today();
    if (pathname === '/') return send(302, '', { Location: `/${todayDate}` });

    const date = pathname.slice(1);
    if (!isValidDate(date)) return send(404, 'Not Found', { 'Content-Type': 'text/plain' });

    const started = Date.now();
    try {
      const day = await serialized(() => loadDay(date, todayDate));
      send(200, renderPage(day, { account, generatedAt: nowInTokyo(), today: todayDate }));
      log(`${date} を表示しました（${((Date.now() - started) / 1000).toFixed(1)}秒）`);
    } catch (e) {
      send(500, renderErrorPage(date, e.message, { today: todayDate }));
      log(`${date} の取得に失敗しました: ${e.message}`);
    }
  });
}

/** 指定ポートで動いているのがこのツールのサーバーか */
async function isOurServer(origin) {
  try {
    const res = await fetch(`${origin}${HEALTH_PATH}`);
    return (await res.text()) === HEALTH_BODY;
  } catch {
    return false;
  }
}

module.exports = { createServer, isOurServer };
