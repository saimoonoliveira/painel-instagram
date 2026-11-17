-- =============================================================
-- "Siga para desbloquear": trava de follow antes de liberar o fluxo
-- =============================================================
alter table flows
  add column if not exists require_follow      boolean not null default false,
  add column if not exists gate_text           text,   -- msg pedindo pra seguir
  add column if not exists gate_button_label   text,   -- rótulo do botão (ex.: "Já estou seguindo")
  add column if not exists not_following_text  text;   -- msg quando ainda não segue
