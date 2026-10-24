# Just Volleyball Skins

Site da comunidade para compartilhar skins do **Just Volleyball** por código, com imagens.

- Galeria de skins com busca (nome, autor ou código exato), filtro por tag e ordenação (recentes, mais copiadas, mais curtidas)
- Botão **Copiar código** em cada skin (conta quantas vezes foi copiada)
- Página de detalhes com galeria de até 4 imagens, curtidas e link compartilhável (`/#/skin/<id>`)
- Formulário de envio: nome, código, imagens (PNG/JPG/WEBP/GIF, até 5 MB cada), autor, descrição e tags
- Funciona no celular e respeita o modo escuro do sistema

## Deploy automático

Cada push na branch de produção (`claude/optimistic-hopper-5eckr8`, a branch principal do repositório)
coloca tudo no ar sozinho:

1. **GitHub Actions** roda os testes contra um Postgres real (`.github/workflows/ci.yml`).
2. **Netlify** faz o deploy de produção. Antes de publicar, o build roda `npm run migrate`, que aplica
   no Supabase as migrações de `supabase/migrations/` que ainda não foram aplicadas.
   Se uma migração falhar, ela é desfeita, o deploy falha e a versão anterior continua no ar.
3. O site estático e a API (Netlify Function) são publicados juntos.

Previews de branch e de pull request no Netlify **não** rodam migrações, então nunca mexem no banco de produção.
As migrações aplicadas ficam registradas na tabela `public.app_migrations`.

### Variáveis de ambiente no Netlify

Em **Site configuration → Environment variables**:

| Variável                    | Para quê |
|-----------------------------|----------|
| `SUPABASE_URL`              | Opcional. Padrão: `https://uojxjcnggbfljtkmurgq.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave secreta usada pela API (marque como *secret*). O escopo precisa incluir **Functions** e ter valor para **Production** |
| `SUPABASE_DB_URL`           | Conexão usada pelas migrações. No Supabase: **Connect → Connection string → Session pooler**. Pode deixar `[YOUR-PASSWORD]` na URL se usar a variável abaixo |
| `SUPABASE_DB_PASSWORD`      | Senha do banco (marque como *secret*). Recomendado: assim caracteres especiais na senha (`@ # / ? : %`) não precisam ser codificados na URL |
| `SUPABASE_DB_CA`            | Opcional. Certificado do Supabase (**Database Settings → SSL Configuration → Download certificate**), colado inteiro. Sem ele a conexão é criptografada, mas o certificado não é verificado |
| `ADMIN_TOKEN`               | Opcional. Permite apagar skins: `curl -X DELETE -H "x-admin-token: $ADMIN_TOKEN" https://justhouse.netlify.app/api/skins/<id>` |

O log de cada deploy de produção começa listando quais dessas variáveis o build enxerga (só os nomes).

Use a conexão **Session pooler** (porta 5432 em `*.pooler.supabase.com`). A conexão direta
(`db.<projeto>.supabase.co`) só funciona por IPv6, que o build do Netlify não tem.

### Mudando o banco

Crie um arquivo novo em `supabase/migrations/` com número maior que o último
(ex.: `002_adiciona_categoria.sql`). Não edite uma migração que já foi aplicada: ela não roda de novo.
Prefira SQL que possa rodar mais de uma vez sem erro (`if not exists`, `create or replace`).
Cada migração roda em uma transação. Para aplicar à mão: `SUPABASE_DB_URL=... npm run migrate`.

## Como as imagens são enviadas

As functions do Netlify aceitam no máximo 6 MB por requisição, por isso as imagens não passam
pela function: o navegador pede links de upload assinados (`POST /api/uploads`), envia cada imagem
direto para o Supabase Storage e então cria a skin (`POST /api/skins`). O servidor confere o formato
e o tamanho de cada imagem antes de publicar.

O limite de envios (10 a cada 10 minutos por IP) fica guardado no banco, porque as functions não
guardam memória entre requisições.

## Rodando localmente

Requer Node.js 20.12 ou superior.

```bash
npm install
npm start          # http://localhost:3000
```

### Testes

```bash
npm test
```

Os testes da API rodam contra um Postgres real com a migração aplicada (o Storage é simulado em memória).
Sem `TEST_DATABASE_URL` eles são pulados. Exemplo com Postgres local:

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
```

O teste cria um banco temporário e o apaga no final.

## Configuração local

Copie `.env.example` para `.env`. Variáveis usadas pelo servidor local:

| Variável                    | Descrição |
|-----------------------------|-----------|
| `SUPABASE_URL`              | URL do projeto, ex.: `https://uojxjcnggbfljtkmurgq.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave secreta do projeto (só no servidor) |
| `ADMIN_TOKEN`               | Opcional. Permite apagar skins: `curl -X DELETE -H "x-admin-token: $ADMIN_TOKEN" http://localhost:3000/api/skins/<id>` |
| `PORT`                      | Porta do servidor (padrão `3000`) |

Também é possível apagar skins direto no painel do Supabase (Table Editor → `skins`),
mas nesse caso as imagens ficam no bucket e precisam ser removidas à mão.

## Estrutura

```
server.js                        servidor local (npm start)
netlify/functions/api.js         API no Netlify
netlify.toml                     configuração do Netlify
scripts/migrate.js               aplica as migrações no deploy
.github/workflows/ci.yml         testes automáticos no GitHub
src/app.js                       rotas da API e validação
src/store.js                     acesso ao Supabase (funções SQL e Storage)
src/netlify.js                   adapta o app para Netlify Functions
supabase/migrations/001_init.sql tabelas, funções e bucket
public/                          frontend (HTML, CSS e JS puros)
test/                            testes (node:test)
```

## API

| Método | Rota                     | Descrição |
|--------|--------------------------|-----------|
| GET    | `/api/skins`             | Lista (`q`, `tag`, `sort=recent\|popular\|likes`, `page`) |
| GET    | `/api/skins/:id`         | Detalhes de uma skin |
| POST   | `/api/uploads`           | Pede links de upload (JSON: `files: [{ type, size }]`) |
| POST   | `/api/skins`             | Cria skin (JSON: `name`, `code`, `images` (caminhos de `/api/uploads`), `author`, `description`, `tags`) |
| POST   | `/api/skins/:id/copy`    | Registra uma cópia do código |
| POST   | `/api/skins/:id/like`    | Curte / descurte |
| GET    | `/api/tags`              | Tags mais usadas |
| DELETE | `/api/skins/:id`         | Remove skin (requer `x-admin-token`) |

Site de fãs, sem vínculo oficial com o Just Volleyball.
