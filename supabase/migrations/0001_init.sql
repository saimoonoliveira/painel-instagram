-- =============================================================
-- IG ManyChat-style — schema v1
-- Instagram only: comentário→DM, auto-resposta DM, contatos+tags
-- =============================================================

-- Extensões
create extension if not exists pgcrypto;

-- Helper: atualiza updated_at automaticamente
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =============================================================
-- CONTA IG CONECTADA
-- (o access token NÃO fica aqui — vai no Supabase Vault / secret)
-- =============================================================
create table ig_account (
  id            uuid primary key default gen_random_uuid(),
  ig_user_id    text not null unique,          -- Instagram Business account id
  page_id       text not null,                 -- Página do Facebook vinculada
  username      text,
  display_name  text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_ig_account_updated before update on ig_account
  for each row execute function set_updated_at();

-- =============================================================
-- CONTATOS (mini-CRM)
-- =============================================================
create table contacts (
  id                    uuid primary key default gen_random_uuid(),
  ig_account_id         uuid not null references ig_account(id) on delete cascade,
  igsid                 text not null,          -- Instagram-scoped user id (recipient das DMs)
  username              text,
  full_name             text,
  profile_pic           text,
  first_seen_at         timestamptz not null default now(),
  last_interaction_at   timestamptz not null default now(),
  -- janela de 24h para envio livre de DM (última vez que o usuário falou com a conta)
  messaging_window_until timestamptz,
  custom_fields         jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (ig_account_id, igsid)
);
create index idx_contacts_account on contacts(ig_account_id);
create index idx_contacts_username on contacts(username);
create trigger trg_contacts_updated before update on contacts
  for each row execute function set_updated_at();

-- =============================================================
-- TAGS
-- =============================================================
create table tags (
  id            uuid primary key default gen_random_uuid(),
  ig_account_id uuid not null references ig_account(id) on delete cascade,
  name          text not null,
  color         text,
  created_at    timestamptz not null default now(),
  unique (ig_account_id, name)
);

create table contact_tags (
  contact_id uuid not null references contacts(id) on delete cascade,
  tag_id     uuid not null references tags(id) on delete cascade,
  applied_at timestamptz not null default now(),
  primary key (contact_id, tag_id)
);

-- =============================================================
-- FLUXOS
-- steps: JSON com a sequência de mensagens/botões. Ex.:
-- [{"type":"text","text":"Oi! Aqui está seu link 👉 ..."},
--  {"type":"text","text":"Qualquer dúvida é só responder."}]
-- =============================================================
create table flows (
  id            uuid primary key default gen_random_uuid(),
  ig_account_id uuid not null references ig_account(id) on delete cascade,
  name          text not null,
  steps         jsonb not null default '[]'::jsonb,
  apply_tag_id  uuid references tags(id) on delete set null,  -- tag aplicada ao rodar o fluxo
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_flows_updated before update on flows
  for each row execute function set_updated_at();

-- =============================================================
-- TRIGGERS (gatilhos)
-- casa palavra-chave -> aponta pro fluxo
-- source: 'comment' (comentário em post/reel) ou 'dm' (mensagem no direct)
-- match_type: 'exact' | 'contains' | 'any' (any = qualquer mensagem)
-- =============================================================
create table triggers (
  id             uuid primary key default gen_random_uuid(),
  ig_account_id  uuid not null references ig_account(id) on delete cascade,
  flow_id        uuid not null references flows(id) on delete cascade,
  source         text not null check (source in ('comment','dm')),
  match_type     text not null default 'contains' check (match_type in ('exact','contains','any')),
  keyword        text,                          -- null quando match_type = 'any'
  -- para comentário: opcionalmente restringe a um post específico (null = qualquer post)
  media_id       text,
  -- resposta pública opcional ao comentário
  public_reply   text,
  priority       int not null default 0,        -- maior = avaliado primeiro
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_triggers_account_source on triggers(ig_account_id, source) where is_active;
create trigger trg_triggers_updated before update on triggers
  for each row execute function set_updated_at();

-- =============================================================
-- MENSAGENS (log de tudo que entra e sai)
-- direction: 'in' (recebida) | 'out' (enviada)
-- channel: 'dm' | 'comment' | 'private_reply'
-- =============================================================
create table messages (
  id            uuid primary key default gen_random_uuid(),
  ig_account_id uuid not null references ig_account(id) on delete cascade,
  contact_id    uuid references contacts(id) on delete set null,
  direction     text not null check (direction in ('in','out')),
  channel       text not null check (channel in ('dm','comment','private_reply')),
  text          text,
  payload       jsonb,                          -- payload bruto (botões, mídia, etc.)
  trigger_id    uuid references triggers(id) on delete set null,
  external_id   text,                           -- id da mensagem/comentário na Meta
  created_at    timestamptz not null default now()
);
create index idx_messages_contact on messages(contact_id, created_at desc);
create index idx_messages_account on messages(ig_account_id, created_at desc);

-- =============================================================
-- EVENTS (auditoria + dedupe de webhooks)
-- garante que o mesmo comentário/mensagem não seja processado 2x
-- =============================================================
create table events (
  id            uuid primary key default gen_random_uuid(),
  ig_account_id uuid references ig_account(id) on delete cascade,
  event_type    text not null,                  -- 'comment' | 'message' | ...
  dedupe_key    text not null unique,           -- ex.: 'comment:<comment_id>'
  raw           jsonb not null,
  status        text not null default 'received' check (status in ('received','processed','error','ignored')),
  error         text,
  created_at    timestamptz not null default now(),
  processed_at  timestamptz
);
create index idx_events_status on events(status, created_at);

-- =============================================================
-- RLS: painel usa usuário autenticado; edge functions usam service_role
-- (service_role ignora RLS). Por ora, acesso total para authenticated.
-- =============================================================
alter table ig_account   enable row level security;
alter table contacts     enable row level security;
alter table tags         enable row level security;
alter table contact_tags enable row level security;
alter table flows        enable row level security;
alter table triggers     enable row level security;
alter table messages     enable row level security;
alter table events       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['ig_account','contacts','tags','contact_tags','flows','triggers','messages','events']
  loop
    execute format($f$
      create policy "authenticated_all_%1$s" on %1$s
        for all to authenticated using (true) with check (true);
    $f$, t);
  end loop;
end $$;
