// Aplica as migrações pendentes de supabase/migrations no banco do Supabase.
// Roda no build de produção do Netlify (ver netlify.toml) antes de publicar o site:
// se uma migração falhar, o deploy falha e a versão anterior continua no ar.
//
// SUPABASE_DB_URL: string de conexão "Session pooler" do Supabase.
// SUPABASE_DB_CA (opcional): certificado do Supabase (PEM) para verificar o servidor.
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const DIR = path.join(__dirname, '..', 'supabase', 'migrations');

function connectionConfig(raw) {
  const url = new URL(raw);
  const sslmode = url.searchParams.get('sslmode');
  url.searchParams.delete('sslmode');
  if (sslmode === 'disable') return { connectionString: url.toString(), ssl: false };

  const ca = process.env.SUPABASE_DB_CA;
  if (!ca) console.warn('Aviso: SUPABASE_DB_CA não definido; a conexão é criptografada, mas o certificado não é verificado.');
  return { connectionString: url.toString(), ssl: ca ? { ca } : { rejectUnauthorized: false } };
}

async function migrate(databaseUrl, { dir = DIR, log = console.log } = {}) {
  const files = fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const client = new Client(connectionConfig(databaseUrl));
  await client.connect();
  try {
    // Evita duas execuções ao mesmo tempo (dois deploys seguidos).
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['justhouse-migrations']);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.app_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE public.app_migrations ENABLE ROW LEVEL SECURITY;
    `);
    const { rows } = await client.query('SELECT name FROM public.app_migrations');
    const applied = new Set(rows.map((r) => r.name));

    const pending = files.filter((f) => !applied.has(f));
    if (pending.length === 0) log('Banco já está atualizado.');
    for (const file of pending) {
      log(`Aplicando ${file}…`);
      await client.query('BEGIN');
      try {
        await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
        await client.query('INSERT INTO public.app_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Falha na migração ${file}: ${e.message}`);
      }
    }
    return pending;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  const envFile = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error('Defina SUPABASE_DB_URL (Supabase → Connect → Session pooler) nas variáveis de ambiente do Netlify.');
    process.exit(1);
  }
  migrate(url).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { migrate };
