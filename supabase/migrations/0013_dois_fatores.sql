-- Verificação em duas etapas obrigatória (código do app autenticador, TOTP).
-- A exigência fica no banco, não só na tela: sem sessão aal2 (senha + código),
-- as duas checagens centrais negam tudo, então quem tem só a senha não lê nada nem pela API.
-- Funções e serviços com service_role (webhook, agendadores) não passam pela RLS e seguem iguais.

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt()->>'aal', '') = 'aal2'
     and exists (select 1 from app_admins where user_id = auth.uid());
$$;

create or replace function public.can_access_account(acct uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt()->>'aal', '') = 'aal2'
     and (exists (select 1 from app_admins where user_id = auth.uid())
          or exists (select 1 from account_access where ig_account_id = acct and user_id = auth.uid()));
$$;

-- Conectar uma conta do Instagram também exige o segundo fator.
drop policy if exists ins_oauth_pending on oauth_pending;
create policy ins_oauth_pending on oauth_pending for insert to authenticated
  with check (user_id = auth.uid() and coalesce(auth.jwt()->>'aal', '') = 'aal2');
