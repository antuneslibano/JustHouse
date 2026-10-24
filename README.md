# Just Volleyball Skins

Site da comunidade para compartilhar skins do **Just Volleyball** por código, com imagens.

- Galeria de skins com busca (nome, autor ou código exato), filtro por tag e ordenação (recentes, mais copiadas, mais curtidas)
- Botão **Copiar código** em cada skin (conta quantas vezes foi copiada)
- Página de detalhes com galeria de até 4 imagens, curtidas e link compartilhável (`/#/skin/<id>`)
- Formulário de envio: nome, código, imagens (PNG/JPG/WEBP/GIF, até 5 MB cada), autor, descrição e tags
- Funciona no celular e respeita o modo escuro do sistema

## Configurando o Supabase

O site usa o banco Postgres do Supabase para as skins e o Supabase Storage para as imagens.

1. No painel do projeto, abra **SQL Editor → New query**, cole o conteúdo de
   [`supabase/migrations/001_init.sql`](supabase/migrations/001_init.sql) e clique em **Run**.
   Isso cria as tabelas, as funções e o bucket público `skin-images`. Pode rodar de novo sem problema.
2. Em **Project Settings → API Keys**, copie a chave **service_role** (ou uma *secret key* `sb_secret_…`).
3. Copie `.env.example` para `.env` e preencha `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.

A chave service_role é secreta: ela fica só no servidor e nunca vai para o navegador.
As tabelas têm RLS ligado sem políticas públicas, então a chave anon não consegue ler nem alterar nada.

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

## Configuração

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
server.js                        inicia o servidor
src/app.js                       rotas da API e validação
src/store.js                     acesso ao Supabase (funções SQL e Storage)
supabase/migrations/001_init.sql tabelas, funções e bucket
public/                          frontend (HTML, CSS e JS puros)
test/                            testes (node:test)
```

## API

| Método | Rota                     | Descrição |
|--------|--------------------------|-----------|
| GET    | `/api/skins`             | Lista (`q`, `tag`, `sort=recent\|popular\|likes`, `page`) |
| GET    | `/api/skins/:id`         | Detalhes de uma skin |
| POST   | `/api/skins`             | Envia skin (multipart: `name`, `code`, `images[]`, `author`, `description`, `tags`) |
| POST   | `/api/skins/:id/copy`    | Registra uma cópia do código |
| POST   | `/api/skins/:id/like`    | Curte / descurte |
| GET    | `/api/tags`              | Tags mais usadas |
| DELETE | `/api/skins/:id`         | Remove skin (requer `x-admin-token`) |

Site de fãs, sem vínculo oficial com o Just Volleyball.
