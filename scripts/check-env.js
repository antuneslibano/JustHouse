// Mostra no log do deploy quais variáveis de ambiente o build enxerga (só os nomes,
// nunca os valores). Não falha o build: uma variável com escopo só "Functions"
// não aparece aqui e mesmo assim chega à API.
const VARS = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL', 'SUPABASE_DB_URL', 'SUPABASE_DB_PASSWORD', 'SUPABASE_DB_CA', 'ADMIN_TOKEN'];

console.log('Variáveis de ambiente visíveis no build:');
for (const name of VARS) {
  console.log(`  ${(process.env[name] || '').trim() ? 'ok      ' : 'ausente '} ${name}`);
}
if (!(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()) {
  console.warn(
    'Aviso: SUPABASE_SERVICE_ROLE_KEY não está visível. A API precisa dela: confira em ' +
      'Environment variables se o nome está certo, se o escopo inclui Functions e se há valor para Production.',
  );
}
