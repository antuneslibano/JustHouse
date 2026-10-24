const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/db');
const { createApp, detectImageType, parseTags } = require('../src/app');

// PNG 1x1 válido.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let server;
let base;
let tmp;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-skins-'));
  const app = createApp({
    db: openDatabase(':memory:'),
    uploadsDir: path.join(tmp, 'uploads'),
    adminToken: 'segredo',
    submitLimit: { windowMs: 60_000, max: 100 },
  });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

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

test('cria, lista, busca e detalha uma skin', async () => {
  const res = await post('/api/skins', skinForm());
  assert.equal(res.status, 201);
  const skin = await res.json();
  assert.equal(skin.name, 'Tubarão Neon');
  assert.deepEqual(skin.tags, ['animal', 'neon']);
  assert.equal(skin.images.length, 1);

  const img = await fetch(base + skin.images[0]);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');

  const list = await (await fetch(`${base}/api/skins?q=tubar`)).json();
  assert.ok(list.skins.some((s) => s.id === skin.id));

  const byCode = await (await fetch(`${base}/api/skins?q=JV-ABC123`)).json();
  assert.ok(byCode.skins.some((s) => s.id === skin.id));

  const byTag = await (await fetch(`${base}/api/skins?tag=neon`)).json();
  assert.ok(byTag.skins.some((s) => s.id === skin.id));

  const detail = await (await fetch(`${base}/api/skins/${skin.id}`)).json();
  assert.equal(detail.code, 'JV-ABC123');
});

test('valida campos obrigatórios e imagens', async () => {
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

test('conta cópias e alterna curtidas', async () => {
  const skin = await (await post('/api/skins', skinForm({ name: 'Bola de Fogo' }))).json();

  const copy = await (await post(`/api/skins/${skin.id}/copy`)).json();
  assert.equal(copy.copies, 1);

  let like = await (await post(`/api/skins/${skin.id}/like`)).json();
  assert.deepEqual(like, { liked: true, likes: 1 });
  like = await (await post(`/api/skins/${skin.id}/like`)).json();
  assert.deepEqual(like, { liked: false, likes: 0 });

  assert.equal((await post('/api/skins/999999/copy')).status, 404);
});

test('exclusão exige token de admin', async () => {
  const skin = await (await post('/api/skins', skinForm({ name: 'Para apagar' }))).json();
  const file = path.join(tmp, 'uploads', path.basename(skin.images[0]));
  assert.ok(fs.existsSync(file));

  let res = await fetch(`${base}/api/skins/${skin.id}`, { method: 'DELETE', headers: { 'x-admin-token': 'errado' } });
  assert.equal(res.status, 403);

  res = await fetch(`${base}/api/skins/${skin.id}`, { method: 'DELETE', headers: { 'x-admin-token': 'segredo' } });
  assert.equal(res.status, 204);
  assert.equal((await fetch(`${base}/api/skins/${skin.id}`)).status, 404);
  assert.ok(!fs.existsSync(file));
});
