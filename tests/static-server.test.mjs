import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStaticServer } from '../scripts/static-server.mjs';

test('static assets revalidate without retransmission and changed assets are sent again', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'selene-cache-'));
  await writeFile(path.join(root, 'index.html'), '<h1>SELENE</h1>');
  await writeFile(path.join(root, 'rover.glb'), 'original-model');
  await mkdir(path.join(root, '_next/static'), { recursive: true });
  await writeFile(path.join(root, '_next/static/app-12345678.js'), 'export{}');
  const server = createStaticServer(root);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const first = await fetch(`${url}/rover.glb`);
  assert.equal(await first.text(), 'original-model');
  const etag = first.headers.get('etag');
  for (const headers of [
    { 'If-None-Match': etag },
    { 'If-Modified-Since': first.headers.get('last-modified') },
  ]) {
    const cached = await fetch(`${url}/rover.glb`, { headers });
    assert.equal(cached.status, 304);
    assert.equal(await cached.text(), '');
  }
  const priority = await fetch(`${url}/rover.glb`, {
    headers: {
      'If-None-Match': '"different"',
      'If-Modified-Since': first.headers.get('last-modified'),
    },
  });
  assert.equal(priority.status, 200);
  await priority.arrayBuffer();
  await writeFile(
    path.join(root, 'rover.glb'),
    'updated-model-with-new-content',
  );
  const changed = await fetch(`${url}/rover.glb`, {
    headers: { 'If-None-Match': etag },
  });
  assert.equal(changed.status, 200);
  assert.equal(await changed.text(), 'updated-model-with-new-content');
  const html = await fetch(url);
  assert.equal(html.headers.get('cache-control'), 'no-cache');
  await html.arrayBuffer();
  const hashed = await fetch(`${url}/_next/static/app-12345678.js`, {
    method: 'HEAD',
  });
  assert.match(hashed.headers.get('cache-control'), /immutable/);
  assert.equal(await hashed.text(), '');
  assert.equal((await fetch(`${url}/%2e%2e%2fpackage.json`)).status, 403);
});
