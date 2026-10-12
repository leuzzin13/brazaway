-- Frota: dados de demonstração (NÃO rode em produção; fica fora de db/seed/ de propósito: aquela pasta roda em todo ambiente).
--
--   psql postgres://truck:truck@localhost:5432/truck_router -v ON_ERROR_STOP=1 -f db/seed/demo/frota_demo.sql
--
-- Requer as migrations 0300-0303. Idempotente: ids fixos (prefixo de30...) e `on conflict do nothing`; rodar de novo não
-- duplica nada (só renova a validade do convite pendente). Para recomeçar: delete from companies where id = 'de300000-0000-4000-8000-000000000001'
-- (cascata) e delete from auth.users where email like '%@transportadora-demo.example'.
--
-- Arquivo GERADO por db/seed/demo/gerar_frota_demo.mjs a partir de frota_demo.sql.tpl (rotas e pings reais do Valhalla).
-- Edite o .tpl e gere de novo; não edite este .sql à mão.
--
-- Conteúdo: "Transportadora Demo" (R$ 149,00 por veículo ativo); owner, gestor e 3 motoristas; 3 veículos (toco, truck e
-- carreta, dimensões dos presets de config/vehicle-presets.json); convites (pendente, aceito, expirado);
-- 3 viagens na Grande SP: concluída (pings reais, paradas e entregas, já compactada), em andamento (posição ao vivo) e
-- planejada atribuída; mensagens.
--
-- Convite pendente (válido 7 dias a partir da aplicação): KX7NP-4QWZ2  (para testar POST /api/frota/invites/accept)
-- Gerar token de um usuário da demo: ver docs/frota/README.md (ex.: owner de30...0010).

begin;

create temporary table _demo (k text primary key, v timestamptz) on commit drop;
insert into _demo values
  -- ontem às 08:00 (São Paulo): saída da viagem concluída
  ('b1', (date_trunc('day', now() at time zone 'America/Sao_Paulo') - interval '1 day' + interval '8 hours') at time zone 'America/Sao_Paulo'),
  -- saída da viagem em andamento: o último ping é de 1 min atrás
  ('b2', now() - (@@ULTIMO_ANDAMENTO_S@@ + 60) * interval '1 second'),
  -- amanhã às 05:30 (São Paulo)
  ('amanha', (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '1 day 5 hours 30 minutes') at time zone 'America/Sao_Paulo');

-- ------------------------------------------------------------------ usuários e empresa
insert into auth.users (id, email, phone) values
  ('de300000-0000-4000-8000-000000000010', 'owner@transportadora-demo.example', null),
  ('de300000-0000-4000-8000-000000000011', 'gestor@transportadora-demo.example', null),
  ('de300000-0000-4000-8000-000000000021', 'joao@transportadora-demo.example', '+5511900000021'),
  ('de300000-0000-4000-8000-000000000022', 'marcos@transportadora-demo.example', '+5511900000022'),
  ('de300000-0000-4000-8000-000000000023', 'paulo@transportadora-demo.example', '+5511900000023')
on conflict do nothing;

insert into companies (id, name, cnpj, billing_email, price_per_vehicle_cents)
values ('de300000-0000-4000-8000-000000000001', 'Transportadora Demo', '11.222.333/0001-81', 'financeiro@transportadora-demo.example', 14900)
on conflict do nothing;

-- ------------------------------------------------------------------ veículos (dimensões dos presets)
insert into vehicles (id, company_id, plate, label, preset, height_m, width_m, length_m, weight_t, payload_t, axle_load_t, axle_count, hazmat, is_vuc) values
  ('de300000-0000-4000-8000-000000000101', 'de300000-0000-4000-8000-000000000001', 'DEM1A01', 'Toco 01',    'toco',       4.0, 2.6,  9.0, 16.0, 10.0, 10.0, 2, false, false),
  ('de300000-0000-4000-8000-000000000102', 'de300000-0000-4000-8000-000000000001', 'DEM2B02', 'Truck 02',   'truck',      4.2, 2.6, 12.0, 23.0, 14.0,  8.5, 3, false, false),
  ('de300000-0000-4000-8000-000000000103', 'de300000-0000-4000-8000-000000000001', 'DEM3C03', 'Carreta 03', 'carreta_5e', 4.4, 2.6, 19.3, 41.5, 27.0, 10.0, 5, false, false)
on conflict do nothing;

-- ------------------------------------------------------------------ convites (código em claro só aqui; no banco fica o hash)
insert into invites (id, company_id, created_by, code_hash, code_hint, role, invitee_name, invitee_phone, vehicle_id, expires_at, status, created_at)
values ('de300000-0000-4000-8000-000000000201', 'de300000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000011',
        app.hash_code('KX7NP-4QWZ2'), 'QWZ2', 'motorista', 'Carlos (novo motorista)', '+5511900000099', 'de300000-0000-4000-8000-000000000101',
        now() + interval '7 days', 'pendente', now())
on conflict (id) do update set expires_at = excluded.expires_at where invites.status = 'pendente';

insert into invites (id, company_id, created_by, code_hash, code_hint, role, invitee_name, invitee_phone, vehicle_id, expires_at, status, accepted_at, accepted_by, created_at) values
  ('de300000-0000-4000-8000-000000000202', 'de300000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000011',
   app.hash_code('MT3HQ-8VZ5R'), 'VZ5R', 'motorista', 'João Silva', '+5511900000021', 'de300000-0000-4000-8000-000000000101',
   now() - interval '17 days', 'aceito', now() - interval '19 days', 'de300000-0000-4000-8000-000000000021', now() - interval '20 days'),
  ('de300000-0000-4000-8000-000000000203', 'de300000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000011',
   app.hash_code('WN6DG-2YLB4'), 'YLB4', 'motorista', 'Ricardo (não chegou a aceitar)', null, null,
   now() - interval '7 days', 'expirado', null, null, now() - interval '10 days')
on conflict do nothing;

-- ------------------------------------------------------------------ membros
insert into company_members (company_id, user_id, role, display_name, phone, default_vehicle_id, invite_id) values
  ('de300000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000010', 'owner',     'Ana Souza (dona)',   null,             null, null),
  ('de300000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000011', 'gestor',    'Roberto Lima (gestor)', null,          null, null),
  ('de300000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000021', 'motorista', 'João Silva',        '+5511900000021', 'de300000-0000-4000-8000-000000000101', 'de300000-0000-4000-8000-000000000202'),
  ('de300000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000022', 'motorista', 'Marcos Pereira',    '+5511900000022', 'de300000-0000-4000-8000-000000000102', null),
  ('de300000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000023', 'motorista', 'Paulo Andrade',     '+5511900000023', 'de300000-0000-4000-8000-000000000103', null)
on conflict do nothing;

-- ------------------------------------------------------------------ viagem 1: CONCLUÍDA (toco, João): CEAGESP → Guarulhos
insert into trips (id, company_id, driver_id, vehicle_id, status, title, origin, origin_label, destination, destination_label, departure_planned_at,
                   planned_route, planned_distance_m, planned_duration_s, route_response, started_at, ended_at, summary, created_by, created_at)
select 'de300000-0000-4000-8000-000000000301', 'de300000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000021', 'de300000-0000-4000-8000-000000000101',
       'concluida', 'Entregas Guarulhos (demo)',
       ST_SetSRID(ST_MakePoint(@@ORIGEM_CONCLUIDA_LON@@, @@ORIGEM_CONCLUIDA_LAT@@), 4326), 'CEAGESP, Vila Leopoldina',
       ST_SetSRID(ST_MakePoint(@@DESTINO_CONCLUIDA_LON@@, @@DESTINO_CONCLUIDA_LAT@@), 4326), 'Guarulhos',
       b1.v, ST_SetSRID(ST_GeomFromGeoJSON(@@ROTA_CONCLUIDA@@), 4326), @@DIST_CONCLUIDA@@, @@DUR_CONCLUIDA@@, @@RESP_CONCLUIDA@@::jsonb,
       b1.v, b1.v + @@FIM_CONCLUIDA_S@@ * interval '1 second',
       'Viagem de demonstração: 2 entregas realizadas, 1 falha (cliente ausente) e parada de almoço detectada automaticamente.',
       'de300000-0000-4000-8000-000000000011', b1.v - interval '2 days'
  from _demo b1 where b1.k = 'b1'
on conflict do nothing;

-- paradas manuais (entregas) registradas pelo motorista
insert into stops (id, company_id, trip_id, driver_id, type, source, geom, address, arrived_at, departed_at, note, created_by)
select 'de300000-0000-4000-8000-000000000401'::uuid, 'de300000-0000-4000-8000-000000000001'::uuid, 'de300000-0000-4000-8000-000000000301'::uuid, 'de300000-0000-4000-8000-000000000021'::uuid,
       'entrega'::app.stop_type, 'manual'::app.stop_source, ST_SetSRID(ST_MakePoint(@@ENTREGA1_LON@@, @@ENTREGA1_LAT@@), 4326), 'Entrega 1 (endereço fictício)',
       b.v + @@ENTREGA1_CHEGADA_S@@ * interval '1 second', b.v + @@ENTREGA1_SAIDA_S@@ * interval '1 second', 'Descarga na doca 2', 'de300000-0000-4000-8000-000000000021'::uuid
  from _demo b where b.k = 'b1'
union all
select 'de300000-0000-4000-8000-000000000402', 'de300000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000301', 'de300000-0000-4000-8000-000000000021',
       'entrega', 'manual', ST_SetSRID(ST_MakePoint(@@ENTREGA2_LON@@, @@ENTREGA2_LAT@@), 4326), 'Entrega 2 (endereço fictício)',
       b.v + @@ENTREGA2_CHEGADA_S@@ * interval '1 second', b.v + @@ENTREGA2_SAIDA_S@@ * interval '1 second', null, 'de300000-0000-4000-8000-000000000021'
  from _demo b where b.k = 'b1'
on conflict do nothing;

insert into deliveries (id, company_id, trip_id, stop_id, sequence, customer_name, address, geom, window_start, window_end, status, status_at,
                        failure_reason, proof_photo_path, signature_path, notes)
select 'de300000-0000-4000-8000-000000000501'::uuid, 'de300000-0000-4000-8000-000000000001'::uuid, 'de300000-0000-4000-8000-000000000301'::uuid, 'de300000-0000-4000-8000-000000000401'::uuid, 1,
       'Mercado Bom Preço (fictício)', 'Av. Exemplo, 100 - Guarulhos', ST_SetSRID(ST_MakePoint(@@ENTREGA1_LON@@, @@ENTREGA1_LAT@@), 4326),
       b.v + interval '30 minutes', b.v + interval '3 hours', 'entregue'::app.delivery_status, b.v + @@ENTREGA1_SAIDA_S@@ * interval '1 second', null,
       'de300000-0000-4000-8000-000000000001/comprovantes/demo-1.jpg', 'de300000-0000-4000-8000-000000000001/assinaturas/demo-1.png', null
  from _demo b where b.k = 'b1'
union all
select 'de300000-0000-4000-8000-000000000502', 'de300000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000301', 'de300000-0000-4000-8000-000000000402', 2,
       'Farmácia Saúde Mais (fictícia)', 'Rua Exemplo, 200 - Guarulhos', ST_SetSRID(ST_MakePoint(@@ENTREGA2_LON@@, @@ENTREGA2_LAT@@), 4326),
       b.v + interval '2 hours', b.v + interval '5 hours', 'entregue', b.v + @@ENTREGA2_SAIDA_S@@ * interval '1 second', null,
       'de300000-0000-4000-8000-000000000001/comprovantes/demo-2.jpg', null, null
  from _demo b where b.k = 'b1'
union all
select 'de300000-0000-4000-8000-000000000503', 'de300000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000301', null, 3,
       'Distribuidora Central (fictícia)', 'Rod. Exemplo, km 5 - Guarulhos', ST_SetSRID(ST_MakePoint(@@FALHA_LON@@, @@FALHA_LAT@@), 4326),
       b.v + interval '3 hours', b.v + interval '4 hours', 'falhou', b.v + @@FIM_CONCLUIDA_S@@ * interval '1 second' - interval '10 minutes',
       'Cliente ausente; reagendar', null, null, 'Portaria fechada'
  from _demo b where b.k = 'b1'
on conflict do nothing;

-- pings reais ao longo das ruas da rota (gerados do Valhalla); só se a viagem ainda não tem pings
insert into location_pings (company_id, driver_id, vehicle_id, trip_id, geom, speed_kmh, heading_deg, accuracy_m, recorded_at)
select 'de300000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000021', 'de300000-0000-4000-8000-000000000101', 'de300000-0000-4000-8000-000000000301',
       ST_SetSRID(ST_MakePoint((p->>2)::float8, (p->>1)::float8), 4326), (p->>3)::real, (p->>4)::real, (p->>5)::real, b.v + (p->>0)::int * interval '1 second'
  from jsonb_array_elements(@@PINGS_CONCLUIDA@@::jsonb) p, _demo b
 where b.k = 'b1' and not exists (select 1 from location_pings where trip_id = 'de300000-0000-4000-8000-000000000301')
 order by (p->>0)::int;

-- compacta: rota feita (LineStringM), distância, desvio máximo e parada automática (almoço)
select (app.compact_trip(id)).id as trip_compactada from trips where id = 'de300000-0000-4000-8000-000000000301' and actual_route is null;

-- ------------------------------------------------------------------ viagem 2: EM ANDAMENTO (truck, Marcos): Barueri → Mooca
insert into trips (id, company_id, driver_id, vehicle_id, status, title, origin, origin_label, destination, destination_label, departure_planned_at,
                   planned_route, planned_distance_m, planned_duration_s, route_response, started_at, created_by, created_at)
select 'de300000-0000-4000-8000-000000000302', 'de300000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000022', 'de300000-0000-4000-8000-000000000102',
       'em_andamento', 'Abastecimento Mooca (demo)',
       ST_SetSRID(ST_MakePoint(@@ORIGEM_ANDAMENTO_LON@@, @@ORIGEM_ANDAMENTO_LAT@@), 4326), 'Barueri',
       ST_SetSRID(ST_MakePoint(@@DESTINO_ANDAMENTO_LON@@, @@DESTINO_ANDAMENTO_LAT@@), 4326), 'Mooca',
       b.v, ST_SetSRID(ST_GeomFromGeoJSON(@@ROTA_ANDAMENTO@@), 4326), @@DIST_ANDAMENTO@@, @@DUR_ANDAMENTO@@, @@RESP_ANDAMENTO@@::jsonb,
       b.v, 'de300000-0000-4000-8000-000000000011', b.v - interval '1 day'
  from _demo b where b.k = 'b2'
on conflict do nothing;

insert into deliveries (id, company_id, trip_id, sequence, customer_name, address, geom, window_start, window_end, status, status_at) 
select 'de300000-0000-4000-8000-000000000511'::uuid, 'de300000-0000-4000-8000-000000000001'::uuid, 'de300000-0000-4000-8000-000000000302'::uuid, 1,
       'Atacadão do Pão (fictício)', 'Av. Exemplo, 10 - Osasco', ST_SetSRID(ST_MakePoint(@@AND_E1_LON@@, @@AND_E1_LAT@@), 4326),
       b.v, b.v + interval '2 hours', 'entregue'::app.delivery_status, b.v + interval '70 minutes'
  from _demo b where b.k = 'b2'
union all
select 'de300000-0000-4000-8000-000000000512', 'de300000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000302', 2,
       'Supermercado Vila Nova (fictício)', 'Rua Exemplo, 20 - São Paulo', ST_SetSRID(ST_MakePoint(@@AND_E2_LON@@, @@AND_E2_LAT@@), 4326),
       b.v + interval '1 hour', b.v + interval '4 hours', 'pendente', null
  from _demo b where b.k = 'b2'
union all
select 'de300000-0000-4000-8000-000000000513', 'de300000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000302', 3,
       'Empório da Mooca (fictício)', 'Rua Exemplo, 30 - Mooca', ST_SetSRID(ST_MakePoint(@@AND_E3_LON@@, @@AND_E3_LAT@@), 4326),
       b.v + interval '2 hours', b.v + interval '5 hours', 'pendente', null
  from _demo b where b.k = 'b2'
on conflict do nothing;

-- pings até a posição atual (o último é de 1 min atrás: aparece no mapa ao vivo)
insert into location_pings (company_id, driver_id, vehicle_id, trip_id, geom, speed_kmh, heading_deg, accuracy_m, recorded_at)
select 'de300000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000022', 'de300000-0000-4000-8000-000000000102', 'de300000-0000-4000-8000-000000000302',
       ST_SetSRID(ST_MakePoint((p->>2)::float8, (p->>1)::float8), 4326), (p->>3)::real, (p->>4)::real, (p->>5)::real, b.v + (p->>0)::int * interval '1 second'
  from jsonb_array_elements(@@PINGS_ANDAMENTO@@::jsonb) p, _demo b
 where b.k = 'b2' and not exists (select 1 from location_pings where trip_id = 'de300000-0000-4000-8000-000000000302')
 order by (p->>0)::int;

-- ------------------------------------------------------------------ viagem 3: PLANEJADA E ATRIBUÍDA (carreta, Paulo): São Bernardo → Cajamar, amanhã 05:30
insert into trips (id, company_id, driver_id, vehicle_id, status, title, origin, origin_label, destination, destination_label, departure_planned_at,
                   planned_route, planned_distance_m, planned_duration_s, route_response, created_by, created_at)
select 'de300000-0000-4000-8000-000000000303', 'de300000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000023', 'de300000-0000-4000-8000-000000000103',
       'atribuida', 'Transferência Cajamar (demo)',
       ST_SetSRID(ST_MakePoint(@@ORIGEM_PLANEJADA_LON@@, @@ORIGEM_PLANEJADA_LAT@@), 4326), 'São Bernardo do Campo',
       ST_SetSRID(ST_MakePoint(@@DESTINO_PLANEJADA_LON@@, @@DESTINO_PLANEJADA_LAT@@), 4326), 'Cajamar',
       a.v, ST_SetSRID(ST_GeomFromGeoJSON(@@ROTA_PLANEJADA@@), 4326), @@DIST_PLANEJADA@@, @@DUR_PLANEJADA@@, @@RESP_PLANEJADA@@::jsonb,
       'de300000-0000-4000-8000-000000000011', now() - interval '3 hours'
  from _demo a where a.k = 'amanha'
on conflict do nothing;

insert into deliveries (id, company_id, trip_id, sequence, customer_name, address, geom, window_start, window_end)
select 'de300000-0000-4000-8000-000000000521'::uuid, 'de300000-0000-4000-8000-000000000001'::uuid, 'de300000-0000-4000-8000-000000000303'::uuid, 1,
       'CD Logística Norte (fictício)', 'Rod. Exemplo, km 10', ST_SetSRID(ST_MakePoint(@@PL_E1_LON@@, @@PL_E1_LAT@@), 4326), a.v + interval '1 hour', a.v + interval '3 hours'
  from _demo a where a.k = 'amanha'
union all
select 'de300000-0000-4000-8000-000000000522', 'de300000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000303', 2,
       'Indústria Alfa (fictícia)', 'Av. Exemplo, 300', ST_SetSRID(ST_MakePoint(@@PL_E2_LON@@, @@PL_E2_LAT@@), 4326), a.v + interval '2 hours', a.v + interval '4 hours'
  from _demo a where a.k = 'amanha'
union all
select 'de300000-0000-4000-8000-000000000523', 'de300000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000303', 3,
       'Centro de Distribuição Cajamar (fictício)', 'Rod. Anhanguera, Cajamar', ST_SetSRID(ST_MakePoint(@@PL_E3_LON@@, @@PL_E3_LAT@@), 4326), a.v + interval '3 hours', a.v + interval '5 hours'
  from _demo a where a.k = 'amanha'
on conflict do nothing;

-- ------------------------------------------------------------------ mensagens
insert into messages (id, company_id, trip_id, sender_id, recipient_id, body, read_at, created_at)
select m.id, 'de300000-0000-4000-8000-000000000001', m.trip_id, m.sender_id, m.recipient_id, m.body, m.read_at, m.created_at
  from (
    select 'de300000-0000-4000-8000-000000000601'::uuid as id, 'de300000-0000-4000-8000-000000000301'::uuid as trip_id,
           'de300000-0000-4000-8000-000000000011'::uuid as sender_id, 'de300000-0000-4000-8000-000000000021'::uuid as recipient_id,
           'Bom dia, João. A entrega 3 (Distribuidora Central) tem janela até as 12h; se der, comece por ela.'::text as body,
           (select v from _demo where k = 'b1') - interval '25 minutes' as read_at, (select v from _demo where k = 'b1') - interval '30 minutes' as created_at
    union all
    select 'de300000-0000-4000-8000-000000000602', 'de300000-0000-4000-8000-000000000301', 'de300000-0000-4000-8000-000000000021', 'de300000-0000-4000-8000-000000000011',
           'Cliente da entrega 3 estava ausente, portaria fechada. Posso voltar amanhã cedo.',
           (select v from _demo where k = 'b1') + interval '3 hours 5 minutes', (select v from _demo where k = 'b1') + interval '3 hours'
    union all
    select 'de300000-0000-4000-8000-000000000603', 'de300000-0000-4000-8000-000000000302', 'de300000-0000-4000-8000-000000000011', 'de300000-0000-4000-8000-000000000022',
           'Marcos, trânsito pesado na Marginal Tietê no sentido Mooca; avise se precisar reprogramar a última entrega.',
           null, now() - interval '10 minutes'
    union all
    select 'de300000-0000-4000-8000-000000000604', 'de300000-0000-4000-8000-000000000303', 'de300000-0000-4000-8000-000000000010', 'de300000-0000-4000-8000-000000000023',
           'Paulo, a viagem de amanhã sai às 05:30 de São Bernardo. A rota já está no app.',
           null, now() - interval '2 hours'
  ) m
on conflict do nothing;

commit;

select 'frota demo: OK' as resultado,
       (select count(*) from company_members where company_id = 'de300000-0000-4000-8000-000000000001') as membros,
       (select count(*) from trips where company_id = 'de300000-0000-4000-8000-000000000001') as viagens,
       (select count(*) from location_pings where company_id = 'de300000-0000-4000-8000-000000000001') as pings;
