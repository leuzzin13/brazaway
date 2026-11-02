-- Frota: prazos das multas no automático.
-- Achado da simulação de 90 dias: a equipe passou as 13 semanas correndo atrás do prazo de indicação do condutor. Perder
-- o prazo gera para a pessoa jurídica a multa por não identificação (NIC, CTB art. 257 §8: a multa original multiplicada
-- pelo número de infrações iguais cometidas em 12 meses).
--
-- multas:
--   notificada_em          quando a notificação da autuação chegou (multa presencial: a data da autuação). O prazo para
--                          indicar o condutor é de 30 dias a partir dela (CTB art. 257 §7, redação da Lei 14.071/2020) e
--                          é preenchido sozinho (trigger abaixo) quando prazo_indicacao estiver vazio;
--   vencimento             vencimento da penalidade (boleto). Até ele a multa sai por 80% (art. 284) ou por 60% com o SNE
--                          (art. 284 §1º: empresa aderida ao Sistema de Notificação Eletrônica, multa notificada por ele
--                          e sem recurso). prazo_pagamento (0402) continua valendo como vencimento quando este faltar;
--   sne                    a multa foi notificada pelo SNE;
--   condutor_indicado_em   quando e quem indicou o condutor (preenchidos sozinhos ao virar 'condutor_indicado';
--   condutor_indicado_por  voltar para registrada/notificada desfaz).
-- companies:
--   sne_aderida_em         data da adesão da empresa ao SNE (null = não aderiu). Gravada por app.set_sne
--                          (PATCH /api/frota/empresa/sne), que a equipe toda pode chamar (a política de companies só deixa
--                          owner/admin alterarem a empresa).

alter table multas add column if not exists notificada_em date;
alter table multas add column if not exists vencimento date;
alter table multas add column if not exists sne boolean not null default false;
alter table multas add column if not exists condutor_indicado_em timestamptz;
alter table multas add column if not exists condutor_indicado_por uuid references auth.users(id) on delete set null;
alter table companies add column if not exists sne_aderida_em date;

-- infrações iguais da empresa em 12 meses (estimativa da NIC)
create index if not exists multas_enquadramento_idx on multas (company_id, enquadramento, ocorrida_em);

-- Trigger próprio (não mexe em app.multas_before_write, de 0402). Triggers BEFORE da mesma tabela disparam em ordem
-- alfabética do nome: 'multas_before_write' roda antes de 'multas_prazos'.
create or replace function app.multas_prazos() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  -- o motorista registra pelo app sem esses campos (a API já ignora; aqui vale também para o cliente direto do Supabase)
  if tg_op = 'INSERT' and current_user in ('authenticated', 'anon') and not app.staff_of(new.company_id) then
    new.notificada_em := null; new.vencimento := null; new.sne := false;
    new.condutor_indicado_em := null; new.condutor_indicado_por := null;
  end if;
  -- notificação mudou e o prazo era o calculado (notificação + 30): calcula de novo
  if tg_op = 'UPDATE' and new.notificada_em is distinct from old.notificada_em
     and new.prazo_indicacao is not distinct from old.prazo_indicacao and old.prazo_indicacao = old.notificada_em + 30 then
    new.prazo_indicacao := null;
  end if;
  if new.notificada_em is not null and new.prazo_indicacao is null then
    new.prazo_indicacao := new.notificada_em + 30;
  end if;
  -- indicação do condutor: quando e quem (só se ainda não informados)
  if new.status = 'condutor_indicado' and (tg_op = 'INSERT' or old.status <> 'condutor_indicado') then
    new.condutor_indicado_em := coalesce(new.condutor_indicado_em, now());
    new.condutor_indicado_por := coalesce(new.condutor_indicado_por, auth.uid());
  elsif tg_op = 'UPDATE' and old.status = 'condutor_indicado' and new.status in ('registrada', 'notificada')
        and new.condutor_indicado_em is not distinct from old.condutor_indicado_em then
    new.condutor_indicado_em := null; new.condutor_indicado_por := null;
  end if;
  return new;
end $$;
drop trigger if exists multas_prazos on multas;
create trigger multas_prazos before insert or update on multas for each row execute function app.multas_prazos();

-- adesão ao SNE: equipe da empresa (owner, admin ou gestor). Aderir de novo mantém a data da primeira adesão.
create or replace function app.set_sne(p_aderida boolean) returns date
language plpgsql security definer set search_path = public, pg_temp as $$
declare v date;
begin
  perform app.require(app.is_staff(), 'só a equipe da empresa (owner, admin ou gestor) altera a adesão ao SNE');
  update companies
     set sne_aderida_em = case when p_aderida then coalesce(sne_aderida_em, (now() at time zone 'America/Sao_Paulo')::date) end
   where id = app.company_id()
  returning sne_aderida_em into v;
  return v;
end $$;

revoke execute on function app.multas_prazos() from public, anon;
revoke execute on function app.set_sne(boolean) from public, anon;
grant execute on function app.multas_prazos() to authenticated, service_role;
grant execute on function app.set_sne(boolean) to authenticated, service_role;
