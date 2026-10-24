# Just Volleyball Skins

Site da comunidade para compartilhar skins do **Just Volleyball** por código, com imagens.

- Galeria de skins com busca (nome, autor ou código exato), filtro por tag e ordenação (recentes, mais copiadas, mais curtidas)
- Botão **Copiar código** em cada skin (conta quantas vezes foi copiada)
- Página de detalhes com galeria de até 4 imagens, curtidas e link compartilhável (`/#/skin/<id>`)
- Formulário de envio: nome, código, imagens (PNG/JPG/WEBP/GIF, até 5 MB cada), autor, descrição e tags
- Funciona no celular e respeita o modo escuro do sistema

## Rodando localmente

Requer Node.js 18 ou superior.

```bash
npm install
npm start          # http://localhost:3000
npm test           # testes da API
```

## Configuração

| Variável      | Padrão   | Descrição |
|---------------|----------|-----------|
| `PORT`        | `3000`   | Porta do servidor |
| `DATA_DIR`    | `./data` | Pasta do banco SQLite (`skins.db`) e das imagens enviadas (`uploads/`) |
| `ADMIN_TOKEN` | *(vazio)*| Se definido, permite apagar skins: `curl -X DELETE -H "x-admin-token: $ADMIN_TOKEN" http://localhost:3000/api/skins/<id>` |

Em produção, mantenha `DATA_DIR` em um disco persistente e faça backup dessa pasta.

## Estrutura

```
server.js        inicia o servidor
src/app.js       rotas da API e servidor de arquivos
src/db.js        esquema do banco SQLite
public/          frontend (HTML, CSS e JS puros)
test/            testes (node:test)
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
