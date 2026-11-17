-- =============================================================
-- Posts: carrosséis produzidos para a conta, com fila de aprovação
--   aguardando -> (ajustes) -> aprovado -> agendado -> postado
--   As imagens ficam no bucket privado "posts", em <ig_account_id>/<post_id>/...
-- =============================================================
create table if not exists posts (
  id             uuid primary key default gen_random_uuid(),
  ig_account_id  uuid not null references ig_account(id) on delete cascade,
  titulo         text not null,
  legenda        text,
  legenda_curta  text,
  fontes         text,
  -- [{ "jpg": "<caminho da prévia>", "png": "<caminho do original>" }, ...] na ordem do carrossel
  slides         jsonb not null default '[]'::jsonb,
  status         text not null default 'aguardando'
                 check (status in ('aguardando', 'ajustes', 'aprovado', 'agendado', 'postado')),
  agendado_para  timestamptz,
  postado_em     timestamptz,
  link           text,
  notas          text,      -- pedido de ajuste ou observação de quem aprova
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists idx_posts_conta on posts(ig_account_id, criado_em desc);

create or replace function public.posts_touch()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists trg_posts_touch on posts;
create trigger trg_posts_touch before update on posts for each row execute function public.posts_touch();

-- RLS: mesmo escopo das outras tabelas da conta (admin vê tudo; sócio só a conta dele)
alter table posts enable row level security;
drop policy if exists posts_sel on posts;
drop policy if exists posts_ins on posts;
drop policy if exists posts_upd on posts;
drop policy if exists posts_del on posts;
create policy posts_sel on posts for select to authenticated using (public.can_access_account(ig_account_id));
create policy posts_ins on posts for insert to authenticated with check (public.can_access_account(ig_account_id));
create policy posts_upd on posts for update to authenticated
  using (public.can_access_account(ig_account_id)) with check (public.can_access_account(ig_account_id));
create policy posts_del on posts for delete to authenticated using (public.can_access_account(ig_account_id));

-- ---- Arquivos: bucket privado, a 1ª pasta do caminho é o id da conta ----
insert into storage.buckets (id, name, public)
values ('posts', 'posts', false)
on conflict (id) do nothing;

-- texto -> uuid com segurança: caminho fora do padrão nunca dá erro, só nega
create or replace function public.can_access_account_path(path text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when (storage.foldername(path))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.can_access_account(((storage.foldername(path))[1])::uuid)
    else false
  end;
$$;

drop policy if exists posts_arquivos_sel on storage.objects;
drop policy if exists posts_arquivos_ins on storage.objects;
drop policy if exists posts_arquivos_del on storage.objects;
create policy posts_arquivos_sel on storage.objects for select to authenticated
  using (bucket_id = 'posts' and public.can_access_account_path(name));
create policy posts_arquivos_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'posts' and public.can_access_account_path(name));
create policy posts_arquivos_del on storage.objects for delete to authenticated
  using (bucket_id = 'posts' and public.can_access_account_path(name));
