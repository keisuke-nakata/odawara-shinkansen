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
