-- Foto de perfil oficial dos perfis monitorados: a coleta do Apify traz o link (que expira);
-- a função vigiar guarda a imagem em <conta>/<username>/perfil.jpg a cada verificação.
alter table perfis_monitorados add column if not exists foto text;
