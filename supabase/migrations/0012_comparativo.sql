-- =============================================================
-- Comparativo (aba do Monitor): seguidores, variação, posts por tipo, curtidas, comentários e
-- engajamento de cada perfil acompanhado — e da própria conta ("Você", categoria 'propria').
--   Fonte: coletor de perfis do Apify (apify~instagram-profile-scraper), 1 retrato por dia por perfil.
--   A variação e os posts do período só existem a partir do 1º retrato ("medindo desde").
-- =============================================================
alter table perfis_monitorados drop constraint if exists perfis_monitorados_categoria_check;
alter table perfis_monitorados add constraint perfis_monitorados_categoria_check
  check (categoria in ('concorrente', 'inspiracao', 'propria'));
alter table perfis_monitorados add column if not exists metricas_em timestamptz;  -- último retrato

-- 1 linha por perfil por dia (fuso de Brasília)
create table if not exists perfil_metricas (
  perfil_id      uuid not null references perfis_monitorados(id) on delete cascade,
  ig_account_id  uuid not null references ig_account(id) on delete cascade,
  dia            date not null,
  seguidores     integer,
  seguindo       integer,
  posts_total    integer,
  primary key (perfil_id, dia)
);

-- posts vistos nos retratos; curtidas/comentários ficam com o último valor visto
create table if not exists perfil_posts (
  perfil_id      uuid not null references perfis_monitorados(id) on delete cascade,
  ig_account_id  uuid not null references ig_account(id) on delete cascade,
  post_id        text not null,
  shortcode      text,
  tipo           text not null check (tipo in ('estatico', 'carrossel', 'reels')),
  postado_em     timestamptz,
  curtidas       integer,          -- null quando o perfil esconde as curtidas
  comentarios    integer,
  visualizacoes  integer,
  atualizado_em  timestamptz not null default now(),
  primary key (perfil_id, post_id)
);
create index if not exists idx_perfil_posts_conta on perfil_posts(ig_account_id, postado_em desc);

alter table perfil_metricas enable row level security;
alter table perfil_posts enable row level security;
drop policy if exists perfil_metricas_sel on perfil_metricas;
drop policy if exists perfil_posts_sel on perfil_posts;
create policy perfil_metricas_sel on perfil_metricas for select to authenticated using (public.can_access_account(ig_account_id));
create policy perfil_posts_sel on perfil_posts for select to authenticated using (public.can_access_account(ig_account_id));

-- Agendador (mesmo nome = substitui o da 0009): também dispara quando um retrato venceu (20h).
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
    where ativo and (run_id is not null
      or ultima_verificacao is null or ultima_verificacao < now() - interval '20 hours'
      or metricas_em is null or metricas_em < now() - interval '20 hours')
  );
  $$
);
