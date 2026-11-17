-- =============================================================
-- OAuth / tokens gerenciados pela ferramenta
-- =============================================================

-- Campos de exibição (seguros p/ o painel) sobre a conexão
alter table ig_account
  add column if not exists token_expires_at timestamptz,
  add column if not exists connected_at timestamptz;

-- Token real fica isolado: só service_role (edge functions) acessa.
-- RLS habilitado SEM policies => authenticated/anon não leem nem escrevem.
create table if not exists ig_tokens (
  ig_account_id uuid primary key references ig_account(id) on delete cascade,
  access_token  text not null,
  expires_at    timestamptz,
  updated_at    timestamptz not null default now()
);
alter table ig_tokens enable row level security;
