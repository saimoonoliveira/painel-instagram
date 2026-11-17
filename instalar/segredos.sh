#!/usr/bin/env bash
# Grava os segredos do sistema no SEU projeto Supabase, sem que eles passem por chat ou arquivo.
# Rode na raiz do projeto, depois do `npx supabase link`:   bash instalar/segredos.sh
# As chaves internas (webhook, agendadores) são geradas aqui mesmo. Pode rodar de novo para trocar valores.
set -euo pipefail

REF=$(cat supabase/.temp/project-ref 2>/dev/null || true)
[ -n "$REF" ] || { echo "Projeto não vinculado. Rode antes: npx supabase link --project-ref <ref>"; exit 1; }
BASE="https://$REF.supabase.co"
gerar() { openssl rand -hex 24; }

echo "Projeto: $REF"
read -rp  "ID do app do Instagram (painel da Meta): " APP_ID
read -rsp "Chave secreta do app do Instagram (não aparece ao digitar): " APP_SECRET; echo
read -rp  "Endereço do painel na Vercel (ex.: https://meu-painel.vercel.app): " PAINEL
read -rsp "Token do Apify (Enter para pular; só a aba Monitor usa): " APIFY; echo
[ -n "$APP_ID" ] && [ -n "$APP_SECRET" ] && [ -n "$PAINEL" ] || { echo "ID, chave secreta e endereço são obrigatórios."; exit 1; }
PAINEL=${PAINEL%/}

VERIFY=$(gerar); VIGIAR=$(gerar); PUBLICAR=$(gerar); METRICAS=$(gerar)

# Arquivo temporário só legível por você; apagado ao sair (inclusive em erro).
TMP=$(mktemp); chmod 600 "$TMP"; trap 'rm -f "$TMP"' EXIT

{
  echo "INSTAGRAM_APP_ID=$APP_ID"
  echo "META_APP_SECRET=$APP_SECRET"
  echo "META_VERIFY_TOKEN=$VERIFY"
  echo "OAUTH_REDIRECT_URI=$BASE/functions/v1/oauth"
  echo "PAINEL_URL=$PAINEL"
  echo "VIGIAR_KEY=$VIGIAR"
  echo "PUBLICAR_KEY=$PUBLICAR"
  echo "METRICAS_KEY=$METRICAS"
  if [ -n "$APIFY" ]; then echo "APIFY_TOKEN=$APIFY"; fi
} > "$TMP"
npx supabase secrets set --env-file "$TMP" >/dev/null
echo "✓ Segredos das funções gravados."

# O banco (agendadores) precisa do endereço do projeto e das mesmas chaves, guardados no Vault.
cat > "$TMP" <<SQL
delete from vault.secrets where name in ('projeto_url', 'vigiar_key', 'publicar_key');
select vault.create_secret('$BASE', 'projeto_url');
select vault.create_secret('$VIGIAR', 'vigiar_key');
select vault.create_secret('$PUBLICAR', 'publicar_key');
SQL
npx supabase db query --linked -f "$TMP" >/dev/null
echo "✓ Chaves dos agendadores gravadas no Vault."

echo
echo "Guarde para o passo do webhook no painel da Meta:"
echo "  URL de callback:      $BASE/functions/v1/webhook"
echo "  Token de verificação: $VERIFY"
