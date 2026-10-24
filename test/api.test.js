const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createStore } = require('../src/store');
const { createApp, detectImageType, parseTags } = require('../src/app');

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
      upload: async (p, buffer) => {
        if (files.has(p)) throw new Error('arquivo já existe');
        files.set(p, buffer);
      },
      remove: async (paths) => paths.forEach((p) => files.delete(p)),
      publicUrl: (p) => `https://storage.test/skin-images/${p}`,
    },
  });
  const app = createApp({ store, adminToken: 'segredo', submitLimit: { windowMs: 60_000, max: 100 } });
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

function skinForm(fields = {}, images = [PNG]) {
  const form = new FormData();
  const values = { name: 'Tubarão Neon', code: 'JV-ABC123', author: 'Ana', tags: 'Neon, animal, neon', ...fields };
  for (const [k, v] of Object.entries(values)) form.append(k, v);
  images.forEach((img, i) => form.append('images', new Blob([img]), `img${i}.png`));
  return form;
}

const post = (url, body) => fetch(base + url, { method: 'POST', body });

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
  const res = await post('/api/skins', skinForm());
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
  let res = await post('/api/skins', skinForm({ name: '  ' }));
  assert.equal(res.status, 400);

  res = await post('/api/skins', skinForm({ code: '' }));
  assert.equal(res.status, 400);

  res = await post('/api/skins', skinForm({}, []));
  assert.equal(res.status, 400);

  res = await post('/api/skins', skinForm({}, [Buffer.from('<svg onload="alert(1)"></svg>')]));
  assert.equal(res.status, 400);

  res = await post('/api/skins', skinForm({}, [PNG, PNG, PNG, PNG, PNG]));
  assert.equal(res.status, 400);
});

dbTest('conta cópias e alterna curtidas', async () => {
  const skin = await (await post('/api/skins', skinForm({ name: 'Bola de Fogo' }))).json();

  const copy = await (await post(`/api/skins/${skin.id}/copy`)).json();
  assert.equal(copy.copies, 1);

  let like = await (await post(`/api/skins/${skin.id}/like`)).json();
  assert.deepEqual(like, { liked: true, likes: 1 });
  like = await (await post(`/api/skins/${skin.id}/like`)).json();
  assert.deepEqual(like, { liked: false, likes: 0 });

  assert.equal((await post('/api/skins/999999/copy')).status, 404);
});

dbTest('exclusão exige token de admin', async () => {
  const skin = await (await post('/api/skins', skinForm({ name: 'Para apagar' }))).json();
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
  const a = await (await post('/api/skins', skinForm({ name: 'Ordem A', tags: 'ordem' }))).json();
  const b = await (await post('/api/skins', skinForm({ name: 'Ordem B', tags: 'ordem' }))).json();
  await post(`/api/skins/${a.id}/copy`);

  const popular = await (await fetch(`${base}/api/skins?tag=ordem&sort=popular`)).json();
  assert.deepEqual(popular.skins.map((s) => s.id), [a.id, b.id]);

  const recent = await (await fetch(`${base}/api/skins?tag=ordem`)).json();
  assert.deepEqual(recent.skins.map((s) => s.id), [b.id, a.id]);
  assert.equal(recent.total, 2);
  assert.equal(recent.totalPages, 1);
});

dbTest('busca trata % e _ como texto', async () => {
  await post('/api/skins', skinForm({ name: '100% Praia' }));
  const hit = await (await fetch(`${base}/api/skins?q=${encodeURIComponent('0% p')}`)).json();
  assert.equal(hit.total, 1);
  const miss = await (await fetch(`${base}/api/skins?q=${encodeURIComponent('_%_')}`)).json();
  assert.equal(miss.total, 0);
});
