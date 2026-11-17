-- =============================================================
-- Referências: sequências de stories guardados, classificadas (ex.: "Pitch de evento"),
-- para buscar depois quando precisar de inspiração. Aba Referências do Monitor.
-- =============================================================
create table if not exists referencias (
  id             uuid primary key default gen_random_uuid(),
  ig_account_id  uuid not null references ig_account(id) on delete cascade,
  etiqueta       text not null,              -- a classificação: "Pitch de evento", "Oferta", ...
  nome           text,
  stories        uuid[] not null,            -- ids de stories_arquivados, na ordem da sequência
  criado_em      timestamptz not null default now()
);
create index if not exists idx_referencias_conta on referencias(ig_account_id, etiqueta);

-- RLS: mesmo escopo das outras tabelas da conta
alter table referencias enable row level security;
drop policy if exists referencias_sel on referencias;
drop policy if exists referencias_ins on referencias;
drop policy if exists referencias_upd on referencias;
drop policy if exists referencias_del on referencias;
create policy referencias_sel on referencias for select to authenticated using (public.can_access_account(ig_account_id));
create policy referencias_ins on referencias for insert to authenticated with check (public.can_access_account(ig_account_id));
create policy referencias_upd on referencias for update to authenticated
  using (public.can_access_account(ig_account_id)) with check (public.can_access_account(ig_account_id));
create policy referencias_del on referencias for delete to authenticated using (public.can_access_account(ig_account_id));
