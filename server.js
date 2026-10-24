const fs = require('node:fs');
const path = require('node:path');
const { createSupabaseStore } = require('./src/store');
const { createApp } = require('./src/app');

const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const PORT = Number(process.env.PORT) || 3000;
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (veja o arquivo .env.example).');
  process.exit(1);
}

const app = createApp({
  store: createSupabaseStore({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY }),
  adminToken: process.env.ADMIN_TOKEN || '',
});

app.listen(PORT, () => {
  console.log(`Just Volleyball Skins rodando em http://localhost:${PORT}`);
});
