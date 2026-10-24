const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createStore } = require('../src/store');
const { createApp, detectImageType, parseTags } = require('../src/app');
const { createHandler } = require('../src/netlify');

// Os testes da API rodam contra um Postgres real com a migração aplicada.
// Ex.: TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
const ADMIN_URL = process.env.TEST_DATABASE_URL;
const MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '001_init.sql'), 'utf8');

// PNG 1x1 válido.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let server;
let base;
let pool;
let dbName;
const files = new Map(); // Storage em memória.

async function setupDatabase() {
  const { Client, Pool } = require('pg');
  dbName = `jv_test_${crypto.randomBytes(4).toString('hex')}`;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  pool = new Pool({ connectionString: url.toString() });
  await pool.query(MIGRATION);
}

async function rpc(name, args) {
  assert.match(name, /^[a-z_]+$/);
  const keys = Object.keys(args);
  const sql = `SELECT public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) AS r`;
  const { rows } = await pool.query(sql, keys.map((k) => args[k]));
  return rows[0].r;
}

before(async () => {
  if (!ADMIN_URL) return;
  await setupDatabase();
  const store = createStore({
    rpc,
    storage: {
      createUploadUrl: async (p) => `https://storage.test/upload/${p}`,
      readHead: async (p, bytes) => (files.has(p) ? { head: files.get(p).subarray(0, bytes), size: files.get(p).length } : null),
      remove: async (paths) => paths.forEach((p) => files.delete(p)),
      publicUrl: (p) => `https://storage.test/skin-images/${p}`,
    },
  });
  const app = createApp({ store, adminToken: 'segredo', ipHeader: 'x-test-ip', uploadLimit: { max: 20, windowSeconds: 600 } });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!ADMIN_URL) return;
  server.close();
  await pool.end();
  const { Client } = require('pg');
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await admin.end();
});

const dbTest = (name, fn) => test(name, { skip: !ADMIN_URL && 'defina TEST_DATABASE_URL' }, fn);
const fileOf = (url) => url.split('/').pop();

const postJson = (url, body, headers = {}) =>
  fetch(base + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const post = (url) => postJson(url);

// Faz o envio completo como o navegador: pede os links, "envia" as imagens
// para o Storage em memória e cria a skin.
async function submit(fields = {}, images = [PNG], type = 'image/png') {
  const values = { name: 'Tubarão Neon', code: 'JV-ABC123', author: 'Ana', tags: 'Neon, animal, neon', ...fields };
  let paths = [];
  if (images.length) {
    const res = await postJson('/api/uploads', { files: images.map((b) => ({ type, size: b.length })) });
    if (res.status !== 200) return res;
    const { uploads } = await res.json();
    uploads.forEach((u, i) => {
      assert.equal(u.url, `https://storage.test/upload/${u.path}`);
      files.set(u.path, images[i]);
    });
    paths = uploads.map((u) => u.path);
  }
  return postJson('/api/skins', { ...values, images: paths });
}

test('detecta formatos de imagem pelo conteúdo', () => {
  assert.equal(detectImageType(PNG), 'png');
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(detectImageType(Buffer.from('GIF89a......')), 'gif');
  assert.equal(detectImageType(Buffer.from('<svg></svg>')), null);
});

test('normaliza tags', () => {
  assert.deepEqual(parseTags(' Neon, Animal Fofo ,neon,,a,b,c,d'), ['neon', 'animal-fofo', 'a', 'b', 'c']);
});

dbTest('cria, lista, busca e detalha uma skin', async () => {
  const res = await submit();
  assert.equal(res.status, 201);
  const skin = await res.json();
  assert.equal(skin.name, 'Tubarão Neon');
  assert.deepEqual(skin.tags, ['animal', 'neon']);
  assert.equal(skin.images.length, 1);

  assert.match(skin.images[0], /^https:\/\/storage\.test\/skin-images\/[0-9a-f-]{36}\.png$/);
  assert.ok(files.get(fileOf(skin.images[0])).equals(PNG));

  const list = await (await fetch(`${base}/api/skins?q=tubar`)).json();
  assert.ok(list.skins.some((s) => s.id === skin.id));

  const byCode = await (await fetch(`${base}/api/skins?q=JV-ABC123`)).json();
  assert.ok(byCode.skins.some((s) => s.id === skin.id));

  const byTag = await (await fetch(`${base}/api/skins?tag=neon`)).json();
  assert.ok(byTag.skins.some((s) => s.id === skin.id));

  const detail = await (await fetch(`${base}/api/skins/${skin.id}`)).json();
  assert.equal(detail.code, 'JV-ABC123');
});

dbTest('valida campos obrigatórios e imagens', async () => {
  let res = await submit({ name: '  ' });
  assert.equal(res.status, 400);

  res = await submit({ code: '' });
  assert.equal(res.status, 400);

  res = await submit({}, []);
  assert.equal(res.status, 400);

  res = await submit({}, [Buffer.from('<svg onload="alert(1)"></svg>')]);
  assert.equal(res.status, 400);

  res = await submit({}, [PNG, PNG, PNG, PNG, PNG]);
  assert.equal(res.status, 400);
});

dbTest('conta cópias e alterna curtidas', async () => {
  const skin = await (await submit({ name: 'Bola de Fogo' })).json();

  const copy = await (await post(`/api/skins/${skin.id}/copy`)).json();
  assert.equal(copy.copies, 1);

  let like = await (await post(`/api/skins/${skin.id}/like`)).json();
  assert.deepEqual(like, { liked: true, likes: 1 });
  like = await (await post(`/api/skins/${skin.id}/like`)).json();
  assert.deepEqual(like, { liked: false, likes: 0 });

  assert.equal((await post('/api/skins/999999/copy')).status, 404);
});

dbTest('exclusão exige token de admin', async () => {
  const skin = await (await submit({ name: 'Para apagar' })).json();
  const file = fileOf(skin.images[0]);
  assert.ok(files.has(file));

  let res = await fetch(`${base}/api/skins/${skin.id}`, { method: 'DELETE', headers: { 'x-admin-token': 'errado' } });
  assert.equal(res.status, 403);

  res = await fetch(`${base}/api/skins/${skin.id}`, { method: 'DELETE', headers: { 'x-admin-token': 'segredo' } });
  assert.equal(res.status, 204);
  assert.equal((await fetch(`${base}/api/skins/${skin.id}`)).status, 404);
  assert.ok(!files.has(file));
});

dbTest('ordena por cópias e pagina', async () => {
  const a = await (await submit({ name: 'Ordem A', tags: 'ordem' })).json();
  const b = await (await submit({ name: 'Ordem B', tags: 'ordem' })).json();
  await post(`/api/skins/${a.id}/copy`);

  const popular = await (await fetch(`${base}/api/skins?tag=ordem&sort=popular`)).json();
  assert.deepEqual(popular.skins.map((s) => s.id), [a.id, b.id]);

  const recent = await (await fetch(`${base}/api/skins?tag=ordem`)).json();
  assert.deepEqual(recent.skins.map((s) => s.id), [b.id, a.id]);
  assert.equal(recent.total, 2);
  assert.equal(recent.totalPages, 1);
});

dbTest('busca trata % e _ como texto', async () => {
  await submit({ name: '100% Praia' });
  const hit = await (await fetch(`${base}/api/skins?q=${encodeURIComponent('0% p')}`)).json();
  assert.equal(hit.total, 1);
  const miss = await (await fetch(`${base}/api/skins?q=${encodeURIComponent('_%_')}`)).json();
  assert.equal(miss.total, 0);
});

dbTest('valida pedidos de upload', async () => {
  const bad = [
    { files: [] },
    { files: [{ type: 'image/svg+xml', size: 10 }] },
    { files: [{ type: 'image/png', size: 6 * 1024 * 1024 }] },
    { files: Array.from({ length: 5 }, () => ({ type: 'image/png', size: 10 })) },
  ];
  for (const body of bad) assert.equal((await postJson('/api/uploads', body)).status, 400);
});

dbTest('rejeita imagens não enviadas, falsas ou de outra skin', async () => {
  // Caminho que nunca foi enviado.
  let res = await postJson('/api/skins', { name: 'X', code: 'Y', images: [`${crypto.randomUUID()}.png`] });
  assert.equal(res.status, 400);

  // Caminho fora do formato esperado.
  res = await postJson('/api/skins', { name: 'X', code: 'Y', images: ['../segredo.png'] });
  assert.equal(res.status, 400);

  // Conteúdo que não é PNG enviado como PNG: é recusado e apagado do Storage.
  const before = new Set(files.keys());
  res = await submit({}, [Buffer.from('<svg onload="alert(1)"></svg>')]);
  assert.equal(res.status, 400);
  assert.deepEqual(new Set(files.keys()), before);

  // Reaproveitar a imagem de outra skin não é permitido, e a imagem continua lá.
  const skin = await (await submit({ name: 'Original' })).json();
  const used = fileOf(skin.images[0]);
  res = await postJson('/api/skins', { name: 'Cópia', code: 'Z', images: [used] });
  assert.equal(res.status, 400);
  assert.ok(files.has(used));
});

dbTest('limita pedidos de upload por IP', async () => {
  const body = { files: [{ type: 'image/png', size: 10 }] };
  for (let i = 0; i < 20; i++) assert.equal((await postJson('/api/uploads', body, { 'x-test-ip': 'limite' })).status, 200);
  assert.equal((await postJson('/api/uploads', body, { 'x-test-ip': 'limite' })).status, 429);
  assert.equal((await postJson('/api/uploads', body, { 'x-test-ip': 'outro' })).status, 200);
});

test('handler do Netlify aceita /api e /.netlify/functions/api', async () => {
  const app = createApp({
    store: { topTags: async () => [{ tag: 'neon', count: 1 }] },
  });
  const handler = createHandler(app);
  for (const p of ['/api/tags', '/.netlify/functions/api/tags']) {
    const res = await handler({ path: p, httpMethod: 'GET', headers: {}, queryStringParameters: {}, body: null }, {});
    assert.equal(res.statusCode, 200, p);
    assert.deepEqual(JSON.parse(res.body), { tags: [{ tag: 'neon', count: 1 }] });
  }
});
