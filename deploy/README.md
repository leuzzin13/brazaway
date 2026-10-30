# Deploy do BrasaWay (piloto)

```
 Lovable (frontend)  ──login/Realtime/Storage──▶  Supabase (Auth + Postgres/PostGIS + Realtime + Storage)
        │                                                   ▲
        └──── HTTPS + Bearer <token do Supabase> ──▶  API BrasaWay (Node) ──┘  conecta como postgres
                                                        │
                                                        └──▶ Valhalla (rotas de caminhão, tiles do Sudeste)
```

O banco fica todo no Supabase: Frota, camadas, cidades e reportes. A API e o Valhalla rodam juntos num servidor
(VPS ou o Mac com túnel). O Lovable só fala com o Supabase para login, tempo real e fotos. O resto vai pela API.

## 1. Supabase

1. Crie o projeto em supabase.com, região **São Paulo (sa-east-1)**. Para o piloto, o plano **Pro** é o indicado: o
   banco com as camadas passa de 500 MB, que é o limite do Free.
2. Pegue a connection string em Project Settings → Database → Connection string → **Session pooler** ou Direct
   (porta 5432, nunca a 6543) e rode da sua máquina, com psql instalado:
   ```bash
   SUPABASE_DB_URL='postgresql://postgres.<ref>:<senha>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres' \
     deploy/supabase/aplicar.sh
   ```
   O script aplica as migrations (menos a `0300`, que só existe para o Postgres local), todos os seeds, a blindagem
   (`9000`) e o bucket de comprovantes (`9100`). Pode rodar de novo a cada atualização.

   **Sem psql ou sem acesso à porta 5432** (rede só HTTPS, como numa sessão do Claude na nuvem): o
   `deploy/supabase/aplicar_api.py` aplica os mesmos arquivos pela API de gerenciamento do Supabase, em lotes de até
   900 kB. Precisa de um token pessoal (supabase.com/dashboard/account/tokens, dá acesso à conta toda: só em variável
   de ambiente) e do ref do projeto:
   ```bash
   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=<ref> deploy/supabase/aplicar_api.py   # --simular mostra os lotes
   ```
   Se cair no meio, rode de novo com `--desde <arquivo>` (o erro mostra qual).
3. Authentication → URL Configuration: em Site URL coloque o domínio do Lovable e adicione o mesmo domínio em
   Redirect URLs.
4. Authentication → Providers → Email: ligado. Para o piloto, desligue "Confirm email" se for usar senha.
5. A primeira empresa e o primeiro owner são criados com o service_role (onboarding comercial). Use
   `db/seed/demo/frota_demo.sql.tpl` como modelo, ou me peça o SQL com o nome da transportadora e o e-mail do dono.

**Segurança:** a senha do banco, a `service_role key` e as chaves da Anthropic/Voyage vão **só** no servidor da API.
Nunca no Lovable e nunca no chat. No Lovable entram apenas a URL do Supabase e a **anon key**.

## 2. API + Valhalla (servidor)

Máquina mínima: 4 vCPU, 16 GB de RAM, 40 GB de disco. Cobertura: Sudeste + Sul + Centro-Oeste (PBF fundido ~1,6 GB,
tiles ~2,1 GB; o build usa ~8 GB temporários). Use `./scripts/build-tiles-regioes.sh --swap` em vez de só
`docker compose up valhalla`: ele baixa os 3 extratos, aplica as correções locais do OSM (sem elas o Rio volta a
desviar caminhão por uma regra suspensa) e gera um PBF único sem duplicatas de divisa (PBF regionais lidos juntos
quebram o grafo na divisa entre estados).

```bash
git clone https://github.com/leuzzin13/brazaway && cd brazaway
./scripts/build-tiles-regioes.sh --swap   # 1ª vez: baixa Sudeste+Sul+Centro-Oeste, correções locais, PBF único
                                          # (~1 h de deduplicação) e tiles (~15 min); o --swap sobe o Valhalla com eles
cd api && npm ci && npm run build
```

Variáveis de ambiente da API (no `EnvironmentFile` do systemd ou no `ecosystem` do pm2; a API não lê `.env` sozinha; nunca no git):

| Variável | Valor |
|---|---|
| `DATABASE_URL` | connection string do Supabase (Session pooler, 5432) |
| `SUPABASE_URL` | `https://<ref>.supabase.co`. Valida os tokens ES256 dos projetos novos pelo JWKS |
| `SUPABASE_JWT_SECRET` | só se o projeto ainda usar o "Legacy JWT secret" (HS256) |
| `FROTA_USUARIOS_EXTERNOS` | `1` só quando o login é num Supabase e o banco da Frota fica no Postgres da API (ex.: Lovable Cloud, ver abaixo). Cria o usuário do token no `auth.users` local no primeiro acesso. Nunca com o banco dentro do Supabase |
| `VALHALLA_URL`, `VALHALLA_ELEV_URL` | `http://localhost:8002` |
| `CONFIG_DIR` | caminho de `config/` no repositório |
| `TZ` | `America/Sao_Paulo` |
| `PORT` | `3000` |
| `FROTA_JOBS_INTERVAL_MIN` | `15`: compacta viagens e apaga pings velhos |
| `ANTHROPIC_API_KEY` | Mentor de Logística (assistente do painel) |
| `VOYAGE_API_KEY` | busca do Second Brain (sem ela usa o embedder local, mais fraco) |

Rode com `pm2`/systemd: `node dist/server.js`. Na frente, coloque HTTPS:
- **VPS:** Caddy com `api.seudominio.com.br { reverse_proxy localhost:3000 }`, que emite o certificado sozinho.
- **Mac:** `cloudflared tunnel --url http://localhost:3000` (ou um túnel nomeado com domínio fixo).

Teste: `curl https://api.../api/health` deve responder com db e valhalla ok.

### Variante: login no Lovable Cloud, banco com a API

O projeto do Lovable já tem um Supabase gerenciado (Lovable Cloud), sem acesso direto ao Postgres. Nesse caso o Supabase
fica só com o login, e frota, camadas e cidades ficam no Postgres do servidor da API (o `docker compose` de sempre,
com `0300` e os seeds):

| Variável | Valor |
|---|---|
| `DATABASE_URL` | `postgres://truck:truck@localhost:5432/truck_router` (o Postgres do compose) |
| `SUPABASE_URL` | URL do Supabase do Lovable (`VITE_SUPABASE_URL` do `.env` do projeto): a API valida os tokens ES256 pelo JWKS |
| `FROTA_USUARIOS_EXTERNOS` | `1` |

Sem Realtime nem Storage do lado do banco: o painel recarrega `/api/frota/live` e `/messages` por tempo, e a foto do
comprovante fica para depois. A primeira empresa e o owner: o owner faz login uma vez no app (a API cria o usuário),
ou já antes, com o `id` dele no Supabase do Lovable, rode `deploy/onboarding_empresa.sql` (instruções no arquivo).

## 3. Lovable

Siga `deploy/LOVABLE_PROMPT.md`, uma etapa por vez. Antes de liberar para os motoristas, troque o CORS da API
(`api/src/server.ts`, hoje `origin: true`) pelo domínio do Lovable.
