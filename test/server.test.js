const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer, isOurServer } = require('../src/server');

// 偽の loadDay で起動し、空いているポートの origin を返す
async function start(loadDay) {
  const server = createServer({ loadDay, today: () => '2026-10-04' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

test('server: 日付の URL でその日のページを返す', async (t) => {
  const requested = [];
  const { server, origin } = await start(async (date, today) => {
    requested.push([date, today]);
    return { date, warning: null, up: [], down: [] };
  });
  t.after(() => server.close());

  const res = await fetch(`${origin}/2026-10-07`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /10\/7\(水\) の新幹線/);
  assert.deepEqual(requested, [['2026-10-07', '2026-10-04']]);
});

test('server: / は今日へ転送、不正な URL は 404', async (t) => {
  const { server, origin } = await start(async () => assert.fail('呼ばれないはず'));
  t.after(() => server.close());

  const root = await fetch(`${origin}/`, { redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/2026-10-04');
  assert.equal((await fetch(`${origin}/2026-02-30`)).status, 404);
  assert.equal((await fetch(`${origin}/favicon.ico`)).status, 404);
});

test('server: 取得に失敗したらエラーページ', async (t) => {
  const { server, origin } = await start(async () => { throw new Error('HTTP 503'); });
  t.after(() => server.close());

  const res = await fetch(`${origin}/2026-10-07`);
  assert.equal(res.status, 500);
  assert.match(await res.text(), /時刻表を取得できませんでした: HTTP 503/);
});

test('server: 同時のリクエストは1件ずつ処理する', async (t) => {
  let running = 0;
  let maxRunning = 0;
  const { server, origin } = await start(async (date) => {
    running++;
    maxRunning = Math.max(maxRunning, running);
    await new Promise((r) => setTimeout(r, 20));
    running--;
    return { date, warning: null, up: [], down: [] };
  });
  t.after(() => server.close());

  await Promise.all(['2026-10-07', '2026-10-08', '2026-10-09'].map((d) => fetch(`${origin}/${d}`)));
  assert.equal(maxRunning, 1);
});

test('isOurServer: このツールのサーバーかどうか', async (t) => {
  const { server, origin } = await start(async () => ({}));
  t.after(() => server.close());

  assert.equal(await isOurServer(origin), true);
  assert.equal(await isOurServer('http://127.0.0.1:1'), false);
});

// fetch では Host ヘッダーを変えられないので http.request を使う
function getWithHost(origin, pathname, host) {
  const http = require('node:http');
  return new Promise((resolve, reject) => {
    const req = http.request(`${origin}${pathname}`, { headers: { Host: host } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

test('server: 127.0.0.1 / localhost 以外の Host 宛てのリクエストは断る（DNS リバインディング対策）', async (t) => {
  const { server, origin } = await start(async () => assert.fail('呼ばれないはず'));
  t.after(() => server.close());
  const { port } = server.address();

  assert.equal(await getWithHost(origin, '/2026-10-07', 'evil.example'), 403);
  assert.equal(await getWithHost(origin, '/__health', `evil.example:${port}`), 403);
  assert.equal(await getWithHost(origin, '/__health', `localhost:${port}`), 200);
});

test('server: 今日から31日先より外の日付は、公式サイトに問い合わせずに断る', async (t) => {
  const { server, origin } = await start(async () => assert.fail('呼ばれないはず'));
  t.after(() => server.close());

  for (const date of ['2026-10-03', '2026-11-05', '2099-01-01']) {
    const res = await fetch(`${origin}/${date}`);
    assert.equal(res.status, 404);
    assert.match(await res.text(), /表示できるのは今日から31日先までです/);
  }
});
