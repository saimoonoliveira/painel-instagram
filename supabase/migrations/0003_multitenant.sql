-- =============================================================
-- Multi-conta com isolamento por usuário (sócios)
--   - admin vê todas as contas
--   - cada sócio vê apenas as contas vinculadas a ele
-- =============================================================

-- Quem é admin (vê tudo)
create table if not exists app_admins (
  user_id    uuid primary key,
  created_at timestamptz not null default now()
);

-- Vínculo usuário <-> conta (quem enxerga qual Instagram)
create table if not exists account_access (
  ig_account_id uuid not null references ig_account(id) on delete cascade,
  user_id       uuid not null,
  created_at    timestamptz not null default now(),
  primary key (ig_account_id, user_id)
);
create index if not exists idx_account_access_user on account_access(user_id);

-- Pendências de OAuth: liga o login que iniciou à conta que será conectada
create table if not exists oauth_pending (
  nonce      text primary key,
  user_id    uuid not null,
  created_at timestamptz not null default now()
);

-- ---- helpers (SECURITY DEFINER: ignoram RLS por dentro) ----
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_admins where user_id = auth.uid());
$$;

create or replace function public.can_access_account(acct uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_admins where user_id = auth.uid())
      or exists (select 1 from account_access where ig_account_id = acct and user_id = auth.uid());
$$;

-- ---- RLS nas tabelas de controle ----
alter table app_admins    enable row level security;
alter table account_access enable row level security;
alter table oauth_pending  enable row level security;

drop policy if exists sel_app_admins on app_admins;
create policy sel_app_admins on app_admins for select to authenticated using (user_id = auth.uid());

drop policy if exists sel_account_access on account_access;
create policy sel_account_access on account_access for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists ins_oauth_pending on oauth_pending;
create policy ins_oauth_pending on oauth_pending for insert to authenticated
  with check (user_id = auth.uid());

-- ---- Troca as policies permissivas antigas por policies escopadas ----
do $$
declare t text;
begin
  foreach t in array array['ig_account','contacts','tags','contact_tags','flows','triggers','messages','events']
  loop
    execute format('drop policy if exists "authenticated_all_%1$s" on %1$s;', t);
  end loop;
end $$;

-- ig_account: escopo pelo próprio id
create policy acc_sel on ig_account for select to authenticated using (public.can_access_account(id));
create policy acc_upd on ig_account for update to authenticated
  using (public.can_access_account(id)) with check (public.can_access_account(id));

-- tabelas com ig_account_id
do $$
declare t text;
begin
  foreach t in array array['contacts','tags','flows','triggers','messages','events']
  loop
    execute format('create policy %1$s_sel on %1$s for select to authenticated using (public.can_access_account(ig_account_id));', t);
    execute format('create policy %1$s_ins on %1$s for insert to authenticated with check (public.can_access_account(ig_account_id));', t);
    execute format('create policy %1$s_upd on %1$s for update to authenticated using (public.can_access_account(ig_account_id)) with check (public.can_access_account(ig_account_id));', t);
    execute format('create policy %1$s_del on %1$s for delete to authenticated using (public.can_access_account(ig_account_id));', t);
  end loop;
end $$;

-- contact_tags: escopo via o contato
create policy ct_sel on contact_tags for select to authenticated
  using (exists (select 1 from contacts c where c.id = contact_id and public.can_access_account(c.ig_account_id)));
create policy ct_ins on contact_tags for insert to authenticated
  with check (exists (select 1 from contacts c where c.id = contact_id and public.can_access_account(c.ig_account_id)));
create policy ct_del on contact_tags for delete to authenticated
  using (exists (select 1 from contacts c where c.id = contact_id and public.can_access_account(c.ig_account_id)));

-- ig_tokens continua trancado (só service_role) — nada muda aqui.

-- ---- Admin inicial ----
-- Depois de criar o seu usuário no painel, torne-o admin (veja INSTALAR.md):
--   insert into app_admins (user_id) select id from auth.users where email = 'voce@exemplo.com';
