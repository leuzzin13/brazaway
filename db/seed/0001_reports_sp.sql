-- 5 reportes de exemplo na Grande São Paulo (ficam só nesta base; nunca vão para o OSM)
insert into reports (id, type, geom, value_num, time_window, note, device_id, status, score) values
  ('11111111-1111-4111-8111-000000000001', 'low_clearance',
    ST_SetSRID(ST_MakePoint(-46.6440, -23.5530), 4326), 3.80, null,
    'Viaduto baixo na Rua da Consolação (exemplo)', 'seed', 'active', 2),
  ('11111111-1111-4111-8111-000000000002', 'weight_limit',
    ST_SetSRID(ST_MakePoint(-46.6980, -23.5260), 4326), 20.00, null,
    'Ponte com limite de 20 t sobre o Tietê (exemplo)', 'seed', 'active', 1),
  ('11111111-1111-4111-8111-000000000003', 'truck_ban',
    ST_SetSRID(ST_MakeLine(ST_MakePoint(-46.6560, -23.5610), ST_MakePoint(-46.6520, -23.5650)), 4326), null,
    '{"days":[1,2,3,4,5],"from":"07:00","to":"20:00"}',
    'Rua proibida para caminhões em horário comercial (exemplo)', 'seed', 'active', 0),
  ('11111111-1111-4111-8111-000000000004', 'road_closed',
    ST_SetSRID(ST_MakePoint(-46.6330, -23.5480), 4326), null, null,
    'Obra interditando a via (exemplo; expira em 24h sem confirmação)', 'seed', 'active', 0),
  ('11111111-1111-4111-8111-000000000005', 'hazmat_ban',
    ST_SetSRID(ST_MakeLine(ST_MakePoint(-46.6900, -23.6150), ST_MakePoint(-46.6850, -23.6200)), 4326), null, null,
    'Túnel proibido para carga perigosa (exemplo)', 'seed', 'active', 1)
on conflict (id) do nothing;

-- Votos coerentes com os scores acima (o trigger recalcula o score)
insert into report_votes (report_id, device_id, vote) values
  ('11111111-1111-4111-8111-000000000001', 'seed-voter-1', 1),
  ('11111111-1111-4111-8111-000000000001', 'seed-voter-2', 1),
  ('11111111-1111-4111-8111-000000000002', 'seed-voter-1', 1),
  ('11111111-1111-4111-8111-000000000005', 'seed-voter-1', 1)
on conflict (report_id, device_id) do nothing;

-- Mantém o road_closed do seed sempre "fresco" para demonstração
update reports set created_at = now() where id = '11111111-1111-4111-8111-000000000004' and device_id = 'seed';
