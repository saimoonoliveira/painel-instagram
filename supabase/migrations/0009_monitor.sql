-- =============================================================
-- Monitor: perfis de concorrentes/inspirações acompanhados e o arquivo dos stories deles.
--   A coleta é do Apify (a Meta não entrega stories de outras contas); a função vigiar copia
--   cada arquivo para o bucket privado "stories" em <ig_account_id>/<username>/... antes do
--   link expirar, e o story fica guardado mesmo depois de sumir do Instagram.
-- =============================================================
create table if not exists perfis_monitorados (
  id                 uuid primary key default gen_random_uuid(),
  ig_account_id      uuid not null references ig_account(id) on delete cascade,
  username           text not null,
  categoria          text not null check (categoria in ('concorrente', 'inspiracao')),
  ativo              boolean not null default true,  -- parar de acompanhar mantém o arquivo
  ultima_verificacao timestamptz,
  run_id             text,         -- coleta em andamento no Apify
  run_iniciado_em    timestamptz,
  erro               text,         -- motivo da última coleta que falhou
  criado_em          timestamptz not null default now(),
  unique (ig_account_id, username)
);

create table if not exists stories_arquivados (
  id             uuid primary key default gen_random_uuid(),
  perfil_id      uuid not null references perfis_monitorados(id) on delete cascade,
  ig_account_id  uuid not null references ig_account(id) on delete cascade,
  story_id       text not null,
  tipo           text not null check (tipo in ('video', 'imagem')),
  arquivo        text not null,    -- caminho no bucket stories
  capa           text,             -- quadro de capa (vídeo)
  postado_em     timestamptz,
  legenda        text,
  extras         jsonb,            -- links, menções, hashtags e duração, como vieram da coleta
  criado_em      timestamptz not null default now(),
  unique (perfil_id, story_id)
);
create index if not exists idx_stories_perfil on stories_arquivados(perfil_id, postado_em desc);

-- RLS: mesmo escopo das outras tabelas da conta. Stories só são gravados pela função (service role).
alter table perfis_monitorados enable row level security;
alter table stories_arquivados enable row level security;
drop policy if exists perfis_sel on perfis_monitorados;
drop policy if exists perfis_ins on perfis_monitorados;
drop policy if exists perfis_upd on perfis_monitorados;
drop policy if exists perfis_del on perfis_monitorados;
drop policy if exists stories_arq_sel on stories_arquivados;
create policy perfis_sel on perfis_monitorados for select to authenticated using (public.can_access_account(ig_account_id));
create policy perfis_ins on perfis_monitorados for insert to authenticated with check (public.can_access_account(ig_account_id));
create policy perfis_upd on perfis_monitorados for update to authenticated
  using (public.can_access_account(ig_account_id)) with check (public.can_access_account(ig_account_id));
create policy perfis_del on perfis_monitorados for delete to authenticated using (public.can_access_account(ig_account_id));
create policy stories_arq_sel on stories_arquivados for select to authenticated using (public.can_access_account(ig_account_id));

-- ---- Arquivos: bucket privado, 1ª pasta = id da conta (mesma função do bucket posts) ----
insert into storage.buckets (id, name, public)
values ('stories', 'stories', false)
on conflict (id) do nothing;

drop policy if exists stories_arquivos_sel on storage.objects;
create policy stories_arquivos_sel on storage.objects for select to authenticated
  using (bucket_id = 'stories' and public.can_access_account_path(name));

-- Agendador: a cada 15 min chama a função vigiar, só se algum perfil venceu (20h) ou tem coleta em andamento.
-- 1 verificação a cada ~20h pega todo story (vivem 24h) sem pagar 2 vezes o mesmo no Apify.
-- A chave fica no Vault (nome vigiar_key), igual à variável VIGIAR_KEY da função.
select cron.schedule(
  'vigiar-perfis',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'projeto_url') || '/functions/v1/vigiar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-chave', (select decrypted_secret from vault.decrypted_secrets where name = 'vigiar_key')
    ),
    body := '{"agendados": true}'::jsonb,
    timeout_milliseconds := 150000
  )
  where exists (
    select 1 from public.perfis_monitorados
    where ativo and (run_id is not null or ultima_verificacao is null or ultima_verificacao < now() - interval '20 hours')
  );
  $$
);
