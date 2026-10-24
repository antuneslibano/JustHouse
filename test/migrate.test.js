const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');
const { migrate, connectionConfig } = require('../scripts/migrate');

const ADMIN_URL = process.env.TEST_DATABASE_URL;

async function withDatabase(fn) {
  const name = `jv_migrate_${crypto.randomBytes(4).toString('hex')}`;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  url.searchParams.set('sslmode', 'disable');
  try {
    await fn(url.toString());
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  }
}

async function query(url, sql) {
  const client = new Client({ connectionString: url.replace('sslmode=disable', '') });
  await client.connect();
  try {
    return (await client.query(sql)).rows;
  } finally {
    await client.end();
  }
}

const opts = { skip: !ADMIN_URL && 'defina TEST_DATABASE_URL' };
const quiet = () => {};

test('aplica as migrações do projeto uma única vez', opts, async () => {
  await withDatabase(async (url) => {
    assert.deepEqual(await migrate(url, { log: quiet }), ['001_init.sql']);
    assert.deepEqual(await migrate(url, { log: quiet }), []);
    const [{ n }] = await query(url, 'SELECT count(*)::int AS n FROM public.skins');
    assert.equal(n, 0);
  });
});

test('migração com erro é desfeita e não é registrada', opts, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-migrations-'));
  fs.writeFileSync(path.join(dir, '001_ok.sql'), 'CREATE TABLE ok (id int);');
  fs.writeFileSync(path.join(dir, '002_bad.sql'), 'CREATE TABLE parcial (id int); SELECT * FROM nao_existe;');
  try {
    await withDatabase(async (url) => {
      await assert.rejects(migrate(url, { dir, log: quiet }), /Falha na migração 002_bad\.sql/);
      const applied = await query(url, 'SELECT name FROM public.app_migrations ORDER BY name');
      assert.deepEqual(applied.map((r) => r.name), ['001_ok.sql']);
      const [{ exists }] = await query(url, "SELECT to_regclass('public.parcial') IS NOT NULL AS exists");
      assert.equal(exists, false);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('lê a conexão do Supabase e aceita senha com caracteres especiais', () => {
  const url = 'postgresql://postgres.abc:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:5432/postgres';
  assert.throws(() => connectionConfig(url, ''), /\[YOUR-PASSWORD\]/);

  const config = connectionConfig(url, 'a@b#c/d?e:f%g');
  assert.equal(config.user, 'postgres.abc');
  assert.equal(config.password, 'a@b#c/d?e:f%g');
  assert.equal(config.host, 'aws-0-sa-east-1.pooler.supabase.com');
  assert.equal(config.port, 5432);

  assert.equal(connectionConfig('postgresql://u:p%40ss%23@h:5432/postgres', '').password, 'p@ss#');
  assert.equal(connectionConfig('postgresql://u:50%off@h:5432/postgres', '').password, '50%off');
});
