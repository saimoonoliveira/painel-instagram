# Instruções para o Claude Code

Este repositório é um modelo: cada pessoa instala a própria cópia, em contas próprias.

## Quando pedirem para instalar

Siga o `INSTALAR.md`, **um passo por vez**, e só avance quando o passo anterior funcionou.

- Rode você mesmo os comandos de terminal (`npx supabase ...`, `npx vercel ...`, `npm ...`).
- Cliques no painel da Meta, da Vercel e do Supabase são da pessoa: diga exatamente onde clicar e espere ela confirmar.
- **Nunca peça que colem senha, token ou chave no chat.** Segredos entram por `bash instalar/segredos.sh`, rodado pela pessoa no terminal dela (o script lê sem mostrar).
- Deploy de função sempre com `--use-api` (não depende do Docker).
- Em erro, leia a mensagem e a seção "Problemas comuns" antes de tentar outra coisa.

## Regras do projeto

- Não desligue o 2FA nem tire a checagem `aal2` de `is_admin()` / `can_access_account()`: é ela que impede acesso só com a senha.
- O webhook grava só na conta dona do evento (`ig_user_id`); não crie "fallback" para outra conta.
- Mudança no banco = nova migração em `supabase/migrations/` (nunca editar uma já aplicada).
- Textos do painel em português do Brasil.
