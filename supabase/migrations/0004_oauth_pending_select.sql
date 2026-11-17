-- Permite ao próprio usuário ler suas linhas de oauth_pending.
-- (o painel insere com Prefer: return=representation, que exige SELECT)
drop policy if exists sel_oauth_pending on oauth_pending;
create policy sel_oauth_pending on oauth_pending for select to authenticated
  using (user_id = auth.uid());

-- Limpeza de nonces antigos (nada crítico guardado aqui)
delete from oauth_pending where created_at < now() - interval '1 day';
