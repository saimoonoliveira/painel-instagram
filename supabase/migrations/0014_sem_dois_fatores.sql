-- Volta ao login só com e-mail e senha (o 2FA obrigatório da 0013 foi retirado a pedido).
-- O acesso continua escopado: admin vê tudo, cada usuário só as contas vinculadas a ele.

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_admins where user_id = auth.uid());
$$;

create or replace function public.can_access_account(acct uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_admins where user_id = auth.uid())
      or exists (select 1 from account_access where ig_account_id = acct and user_id = auth.uid());
$$;

drop policy if exists ins_oauth_pending on oauth_pending;
create policy ins_oauth_pending on oauth_pending for insert to authenticated
  with check (user_id = auth.uid());
