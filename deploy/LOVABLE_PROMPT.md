# Prompt para o Lovable (frontend BrasaWay já existente)

Cole **uma etapa por vez** no Lovable, na ordem. Ele funciona melhor com pedidos menores, e a cada etapa dá para
conferir a tela antes de seguir. A etapa 0 vai sozinha primeiro, porque é ela que dá o contexto.

Antes de colar:
1. No Lovable, conecte o projeto ao **Supabase do BrasaWay** (Integrations → Supabase → projeto existente). O banco já
   foi criado pelo `deploy/supabase/aplicar.sh`. O Lovable **não pode criar tabelas nem rodar migrations**.
2. Em Project Settings → Environment, crie `VITE_BRASAWAY_API_URL` com a URL pública da API
   (ex.: `https://api.brasaway.com.br`). A URL e a anon key do Supabase o próprio Lovable preenche ao conectar.

---

## Etapa 0: contexto (colar primeiro)

```
Este projeto é o frontend do BrasaWay, o "Waze para caminhões" do Brasil: rota que respeita as restrições de
caminhão (zonas e vias proibidas por município, horários, altura, peso, balanças, rodízio), avisos de risco (roubo de
carga, acidentes, radares, blitz) e um painel para a transportadora acompanhar a frota.

MANTENHA o design, as cores (verde #00843D, fundo #F5F6F3, texto #0E1A12), a fonte Figtree e as telas que já existem
(Início com o assistente, Viagens, Frota com as abas Frota/Motoristas/Restrições, Relatórios). Agora vamos trocar os
dados de demonstração por dados reais.

ARQUITETURA (não mude):
- Supabase serve SÓ para: Auth (login), Realtime (posição ao vivo e mensagens) e Storage (fotos de comprovante).
- TODO o resto vem da API do BrasaWay em import.meta.env.VITE_BRASAWAY_API_URL, sempre com o cabeçalho
  Authorization: Bearer <session.access_token do Supabase>.
- NÃO crie tabelas, migrations, edge functions nem políticas no Supabase. O banco já existe, com RLS. Não use
  supabase.from(...) para gravar nada. Leitura direta do Supabase só em live_positions e messages (Realtime).
- Crie um cliente único src/lib/api.ts: função api<T>(path, {method, body, query}) que pega o token da sessão atual,
  manda JSON e trata os erros abaixo. Use TanStack Query para cache e recarregamento.

ERROS DA API (mostrar em português, nunca o JSON cru):
- 401 → sessão expirou: chamar supabase.auth.refreshSession(); se falhar, mandar para o login.
- 403 → "Você não tem permissão para isso."
- 404 → "Não encontrado."
- 409 com error "NO_ROUTE" → mostrar o campo message (ele já vem explicado). Se vier blocked_by[] com itens, listar o
  nome de cada restrição. Se vier limited_by (peso, altura, comprimento, largura, peso_por_eixo, carga_perigosa),
  destacar a medida e sugerir revisar o cadastro do veículo.
- 409 sem NO_ROUTE → mostrar message (ex.: placa repetida).
- 422 → erro de formulário: marcar os campos de issues[].path.
- Rede caiu → aviso discreto "sem conexão" e tentar de novo; nunca perder o que o usuário digitou.

Responda só com um resumo do plano. Não altere nada ainda.
```

## Etapa 1: login, convite e papéis

```
Implemente a autenticação com o Supabase Auth:
- Tela de login com e-mail e link mágico (supabase.auth.signInWithOtp) e, como alternativa, e-mail + senha.
- Depois do login, chame GET /api/frota/me. Resposta: user_id, role (owner | admin | gestor | motorista | null),
  status, display_name, phone, default_vehicle_id, company_id, company_name, ping_interval_moving_s e
  ping_interval_stopped_s (intervalos de envio de posição, em segundos).
- role null = usuário sem empresa → tela "Entrar com convite": campos código do convite, nome e telefone →
  POST /api/frota/invites/accept {code, display_name, phone?}. Depois de aceitar, recarregue /me.
- owner, admin e gestor → painel da transportadora (as telas que já existem).
- motorista → app do motorista (Etapa 4), em layout de celular.
- Guarde o perfil num contexto React (useMe) e esconda os menus que o papel não pode usar.
- Botão de sair (supabase.auth.signOut).
```

## Etapa 2: painel (Frota, Motoristas, Viagens)

```
Ligue as telas do painel na API (todas sob /api/frota):

FROTA (aba Frota):
- Lista: GET /vehicles (campos plate, label, preset, status, height_m, width_m, length_m, weight_t, axle_count).
  Mostre altura e peso em destaque, como já está no design.
- Novo veículo: POST /vehicles {plate, label?, preset}. O preset vem de GET /api/vehicles/presets (rota pública, sem
  /frota): utilitario, vuc, toco, truck, carreta_5e, carreta_6e, romeu_julieta, bitrem, rodotrem. Ao escolher o preset,
  preencha as medidas sugeridas e deixe editar.
- Editar e ativar/desativar: PATCH /vehicles/:id {status: active|inactive, ...}. Explique no formulário que veículo ativo conta na mensalidade.

MOTORISTAS (aba Motoristas):
- Lista: GET /members?role=motorista. Desativar ou reativar: POST /members/:userId/status {status: active|disabled}.
- Convidar: POST /invites {role: "motorista", invitee_name, invitee_phone?, vehicle_id?, valid_hours?}. O "code" só
  vem nesta resposta: mostre o código grande, com botão de copiar e botão "Enviar no WhatsApp" (link wa.me com o
  texto "Seu convite BrasaWay: <code>. Baixe o app e entre com este código.").
- Convites pendentes: GET /invites (mostrar code_hint e effective_status). Revogar: POST /invites/:id/revoke.

VIAGENS:
- Lista: GET /trips?status=planejada,atribuida,em_andamento,concluida&limit=50 (filtros de status, motorista e data).
- Detalhe: GET /trips/:id. Desenhe planned_route (linha verde) e actual_route (linha cinza) no mapa, com as paradas
  (stops) e entregas (deliveries). route_response.avoided[] = restrições evitadas; route_response.warnings[] = avisos.
  Use as cores de severity: danger vermelho, warn amarelo, info cinza.
- Nova viagem: formulário com origem e destino (autocomplete por GET /api/geocode?q=...; cada resultado tem lat, lon e
  label), veículo, motorista, horário de saída e entregas →
  POST /trips {title, vehicle_id, driver_id, origin:{lat,lon,label}, destination:{lat,lon,label},
  departure_planned_at (ISO), plan_route: true,
  deliveries:[{customer_name, address, lat?, lon?, window_start?, window_end?}]}.
  Se voltar 409 NO_ROUTE, mostrar a explicação como descrito na etapa 0 e NÃO criar a viagem.
- Atribuir: POST /trips/:id/assign {driver_id, vehicle_id?}. Cancelar: POST /trips/:id/cancel.
```

## Etapa 3: mapa ao vivo, mensagens, relatórios e assistente

```
MAPA AO VIVO (Início):
- Carga: GET /api/frota/live → GeoJSON de pontos; properties: driver_id, display_name, vehicle_id, plate, trip_id,
  speed_kmh, heading_deg, moving, recorded_at, age_s.
- Tempo real: supabase.channel('live').on('postgres_changes', {event:'*', schema:'public', table:'live_positions'}, ...)
  serve só de GATILHO: a cada evento, recarregue GET /api/frota/live (no máximo 1 vez a cada 3 s). A coluna de
  posição vem em formato binário do PostGIS no evento; não tente ler. A RLS já filtra pela empresa.
- Mapa com MapLibre GL e tiles OpenStreetMap (atribuição "© OpenStreetMap"). Ícone de caminhão girando por
  heading_deg; cinza se age_s > 600 ("sem sinal há X min").

MENSAGENS:
- GET /api/frota/messages?box=inbox | sent, enviar POST /messages {recipient_id, body, trip_id?}, marcar lidas
  POST /messages/read {ids:[...]}. Tempo real: postgres_changes na tabela messages (INSERT). Badge de não lidas.

RELATÓRIOS:
- Cobrança: GET /api/frota/billing?from=YYYY-MM&to=YYYY-MM → veículos ativos por mês × preço.
- Economia: some, nas viagens concluídas do período, route_response.avoided[] por tipo de restrição (multas e
  retornos evitados) e a diferença de km entre a rota livre e a rota legal (o custo da segurança). Rotule tudo como
  "estimativa".

ASSISTENTE (caixa "Como posso ajudar?" do Início = Mentor de Logística):
- POST /api/frota/mentor/chat {conversation_id?, message} → {conversation_id, reply, actions_proposed[],
  pending_confirmation}. Guarde o conversation_id para continuar a conversa. reply vem em markdown.
- Se actions_proposed tiver itens, mostre cada um como cartão com o "resumo" e os botões Confirmar
  (POST /api/frota/mentor/actions/:id/confirm) e Recusar (POST .../reject). Nada é executado sem o clique.
- Histórico: GET /api/frota/mentor/conversations e /conversations/:id.
- A resposta pode levar até ~30 s: mostre "pensando..." e não bloqueie a tela.
```

## Etapa 4: app do motorista (celular, PWA)

```
Crie a área do motorista, pensada para celular e uso com o caminhão parado (botões grandes, alto contraste, poucas
palavras). Torne o app instalável (PWA: manifest e ícone verde BrasaWay).

- Início do motorista: viagem atribuída (GET /api/frota/trips?status=atribuida,em_andamento) com origem, destino,
  entregas e o botão INICIAR VIAGEM → POST /api/frota/trips/:id/start. Sem viagem atribuída: botão "Viagem avulsa" →
  POST /api/frota/trips/start {title?, vehicle_id?}.
- Durante a viagem:
  - Mapa com a planned_route e a posição atual (navigator.geolocation.watchPosition, alta precisão).
  - ENVIO DE POSIÇÃO: junte os pontos numa fila guardada no localStorage e envie em lote a cada interval_moving_s
    (em movimento) ou interval_stopped_s (parado). Os valores iniciais vêm do /me (ping_interval_moving_s,
    ping_interval_stopped_s) e cada resposta do POST /pings traz os atuais →
    POST /api/frota/pings {pings:[{lat, lon, speed_kmh, heading_deg, accuracy_m, recorded_at (ISO)}], trip_id}.
    Sem internet, continue acumulando e envie tudo quando voltar (o servidor ignora repetidos). Nunca descarte a fila.
  - Avisos da rota (route_response.warnings) em lista, os "danger" no topo.
  - Botão grande REPORTAR com: Radar móvel (radar_movel), Blitz (blitz), Via interditada (road_closed), Viaduto baixo
    (low_clearance, pede a altura em metros), Proibido caminhão (truck_ban) →
    POST /api/reports {type, geometry:{type:"Point", coordinates:[lon, lat]}, value_num?, note?, device_id}.
    device_id = um uuid gerado uma vez e guardado no localStorage. Confirmação em 1 toque.
  - Reportes de outros por perto: GET /api/reports?bbox=minLon,minLat,maxLon,maxLat, com 👍/👎 →
    POST /api/reports/:id/votes {device_id, vote: 1|-1}.
  - Parada: botões Abastecer (abastecimento), Descanso (descanso), Pernoite (pernoite), Entrega (entrega) e
    Imprevisto (imprevisto) → POST /api/frota/stops {type, lat, lon, trip_id, note?}.
  - Entregas: marcar entregue ou falhou (motivo obrigatório) → PATCH /api/frota/deliveries/:id {status,
    failure_reason?, proof_photo_path?}. Foto do comprovante: suba para o Storage, bucket "comprovantes", caminho
    <company_id>/<trip_id>/<delivery_id>.jpg, e mande esse caminho em proof_photo_path.
  - ENCERRAR VIAGEM → POST /api/frota/trips/:id/end (antes, envie o que estiver na fila de pings).
- Mensagens com a central: as mesmas rotas de /messages, em formato de chat.
- Avise o motorista para não mexer no celular dirigindo: toda ação de toque mostra "Use só com o veículo parado".
```

## Etapa 5: acabamento

```
- Estados vazios e de carregamento em todas as listas (nada de dado falso: tire todos os mocks).
- Datas e horas em America/Sao_Paulo, formato brasileiro; números com vírgula; distâncias em km.
- Teste o fluxo completo: gestor convida motorista → motorista entra com o código → gestor cria viagem com rota →
  motorista inicia, anda, reporta uma blitz, registra parada e entrega, encerra → gestor vê a rota feita e a economia.
```
