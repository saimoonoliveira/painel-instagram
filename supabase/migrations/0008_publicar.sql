-- =============================================================
-- Publicar no Instagram pelo app: botão "Publicar agora" e agendamento que publica sozinho
--   (função publicar; a Meta exige a permissão instagram_business_content_publish no login)
-- =============================================================
alter table posts
  add column if not exists ig_media_id     text,        -- id do post no Instagram, quando saiu pelo app
  add column if not exists ig_container_id text,        -- carrossel montado na Meta: confere se já saiu antes de tentar de novo
  add column if not exists publicando_em   timestamptz, -- trava enquanto uma publicação está em andamento
  add column if not exists erro_publicacao text;        -- motivo da última tentativa que não saiu

-- Agendador: a cada minuto, se houver post agendado vencido, chama a função publicar.
-- A chave fica no Vault (nome publicar_key), igual à variável PUBLICAR_KEY da função.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

select cron.schedule(
  'publicar-agendados',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'projeto_url') || '/functions/v1/publicar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-chave', (select decrypted_secret from vault.decrypted_secrets where name = 'publicar_key')
    ),
    body := '{"agendados": true}'::jsonb,
    timeout_milliseconds := 150000
  )
  where exists (
    select 1 from public.posts
    where status = 'agendado' and agendado_para <= now() and publicando_em is null
  );
  $$
);
