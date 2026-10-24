const { createSupabaseStore } = require('../../src/store');
const { createApp } = require('../../src/app');
const { createHandler } = require('../../src/netlify');

// A URL do projeto é pública (aparece nos links das imagens); a variável só é
// necessária para apontar para outro projeto.
const DEFAULT_SUPABASE_URL = 'https://uojxjcnggbfljtkmurgq.supabase.co';

let handler;

exports.handler = async (event, context) => {
  const env = (name) => (process.env[name] || '').trim();
  const SUPABASE_URL = env('SUPABASE_URL') || DEFAULT_SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
  const missing = Object.entries({ SUPABASE_SERVICE_ROLE_KEY })
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) {
    // Só os nomes das variáveis, nunca os valores.
    const message = `Servidor não configurado: falta ${missing.join(' e ')} nas variáveis de ambiente do Netlify (escopo Functions).`;
    console.error(message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: message }),
    };
  }

  handler ??= createHandler(
    createApp({
      store: createSupabaseStore({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY }),
      adminToken: env('ADMIN_TOKEN'),
      ipHeader: 'x-nf-client-connection-ip',
    }),
  );
  return handler(event, context);
};
