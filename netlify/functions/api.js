const { createSupabaseStore } = require('../../src/store');
const { createApp } = require('../../src/app');
const { createHandler } = require('../../src/netlify');

let handler;

exports.handler = async (event, context) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_TOKEN } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variáveis de ambiente do Netlify.');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Servidor não configurado.' }),
    };
  }

  handler ??= createHandler(
    createApp({
      store: createSupabaseStore({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY }),
      adminToken: ADMIN_TOKEN || '',
      ipHeader: 'x-nf-client-connection-ip',
    }),
  );
  return handler(event, context);
};
