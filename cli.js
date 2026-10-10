#!/usr/bin/env node
/**
 * 指定日の小田原⇔東京の新幹線（小田原停車列車のみ）を、往路・復路並べて表示する。
 *
 *   node cli.js [日付] [--text | --json] [--no-open] [--port 番号] [--account メールアドレス]
 *
 * 日付は 2026-10-07 / 10/7 / 水 のどれか（省略すると今日）。
 * 既定では手元で Web サーバーを起動してブラウザで開く。画面上で日付を移動でき、
 * 各列車にカレンダー登録リンクが付く。Ctrl+C で終了。
 * 登録先の Google アカウントは --account か config.json の calendarAccount で指定する。
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { getDay } = require('./src/jrc');
const { createServer, isOurServer } = require('./src/server');
const { todayInTokyo, weekdayOf, resolveDate } = require('./src/dates');
const { fetchText, loadCache, sleep } = require('./src/node-io');

const CONFIG_FILE = path.join(__dirname, 'config.json');
const DEFAULT_PORT = 8741;

function parseArgs(argv) {
  const opts = { format: 'html', open: true, port: DEFAULT_PORT, account: null, date: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--text') opts.format = 'text';
    else if (a === '--json') opts.format = 'json';
    else if (a === '--no-open') opts.open = false;
    else if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--account') opts.account = argv[++i];
    else if (a.startsWith('--')) throw new Error(`不明なオプションです: ${a}`);
    else opts.date = a;
  }
  return opts;
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

function formatTrain(t) {
  const mark = t.special ? '◆' : ' ';
  return `  ${t.dep ?? '--:--'} → ${t.arr ?? '--:--'}  ${mark}${t.name}`;
}

function printText({ date, up, down }) {
  console.log(`${date} (${weekdayOf(date)})\n`);
  console.log('往路 小田原 → 東京');
  up.forEach((t) => console.log(formatTrain(t)));
  console.log('\n復路 東京 → 小田原');
  down.forEach((t) => console.log(formatTrain(t)));
  if ([...up, ...down].some((t) => t.special)) {
    console.log('\n◆ 臨時列車、または運転日により行先・停車駅などが変わる列車');
  }
}

function openInBrowser(url) {
  if (process.platform !== 'darwin') return Promise.resolve();
  return new Promise((resolve) => execFile('open', [url], () => resolve()));
}

function serve(date, opts) {
  const origin = `http://127.0.0.1:${opts.port}`;
  const url = `${origin}/${date}`;
  const cache = loadCache();
  const server = createServer({
    loadDay: (d, today) => getDay(d, { fetchText, cache, sleep, today }),
    today: todayInTokyo,
    account: opts.account ?? readConfig().calendarAccount ?? null,
    log: (message) => console.log(message),
  });

  server.on('error', async (e) => {
    // すでに起動していれば、そのサーバーで開くだけにする
    if (e.code === 'EADDRINUSE' && await isOurServer(origin)) {
      console.log(`起動中のサーバーで開きます: ${url}`);
      if (opts.open) await openInBrowser(url);
      process.exit(0);
    }
    console.error(e.code === 'EADDRINUSE'
      ? `ポート ${opts.port} は別のプログラムが使っています。--port で別の番号を指定してください。`
      : e.message);
    process.exit(1);
  });

  // 自分の PC からだけ開けるよう、127.0.0.1 で待ち受ける
  server.listen(opts.port, '127.0.0.1', () => {
    console.log(`${url} で表示しています（終了するには Ctrl+C）`);
    if (opts.open) openInBrowser(url);
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const today = todayInTokyo();
  const date = opts.date ? resolveDate(opts.date, today) : today;
  if (opts.format === 'html') return serve(date, opts);

  let progress = '';
  const day = await getDay(date, {
    fetchText,
    cache: loadCache(),
    sleep,
    today,
    onProgress: (done, total) => {
      if (!process.stderr.isTTY) return;
      progress = `時刻を取得中… ${done}/${total}`;
      process.stderr.write(`\r${progress}`);
    },
  });
  if (progress) process.stderr.write(`\r${' '.repeat(progress.length * 2)}\r`);
  if (day.warning) console.error(`注意: ${day.warning}\n`);

  if (opts.format === 'json') console.log(JSON.stringify(day, null, 2));
  else printText(day);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
