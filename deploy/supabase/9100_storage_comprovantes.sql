-- Supabase Storage: bucket privado dos comprovantes de entrega (foto/assinatura).
-- Caminho: <company_id>/<trip_id>/<delivery_id>.jpg. Cada membro só lê/grava na pasta da própria empresa
-- (a RPC app.register_delivery também recusa caminho de outra empresa). No Postgres local (sem schema storage) não faz nada.
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'sem schema storage (Postgres local): nada a fazer';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('comprovantes', 'comprovantes', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;

  drop policy if exists brasaway_comprovantes_select on storage.objects;
  drop policy if exists brasaway_comprovantes_insert on storage.objects;
  create policy brasaway_comprovantes_select on storage.objects for select to authenticated
    using (bucket_id = 'comprovantes' and (storage.foldername(name))[1] = app.company_id()::text);
  create policy brasaway_comprovantes_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'comprovantes' and (storage.foldername(name))[1] = app.company_id()::text);
end $$;
