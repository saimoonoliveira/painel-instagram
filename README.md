# Painel de Automações do Instagram

Sistema próprio, no estilo das ferramentas de automação de DM, só para o **Instagram**. Roda inteiro em contas suas (Supabase + Vercel + app da Meta), nos planos grátis.

**Para instalar, siga o [INSTALAR.md](INSTALAR.md).**

## O que ele faz

- **Fluxos e gatilhos:** comentário com palavra-chave → resposta pública + DM; auto-resposta de DM; trava de "só responde se seguir".
- **Inbox e contatos:** conversas, mini-CRM com tags.
- **Posts:** aprovar, publicar e agendar carrosséis no Instagram.
- **Conteúdo:** ver e baixar seus posts, reels e stories pelo painel, com ranking por visualizações.
- **Monitor (opcional, Apify):** guarda os stories de concorrentes e inspirações, compara seguidores e engajamento e salva sequências como referência.
- **Multi-usuário:** cada pessoa vê só as contas que conectou; o administrador vê todas.

## Como funciona

```
Instagram (comentário/DM)
      │  webhook assinado
      ▼
 Função `webhook`  ──►  Postgres (contas, contatos, fluxos, gatilhos, eventos)
      │  motor de regras
      ▼
 API do Instagram  ──►  DM / resposta ao comentário

 Painel (Vite + React, na Vercel) ──► Supabase (login, RLS por conta)
```

| Pasta | O quê |
|---|---|
| `supabase/migrations/` | o banco, em ordem (`npx supabase db push`) |
| `supabase/functions/` | `webhook`, `oauth` (conectar conta), `conteudo`, `publicar`, `vigiar` (Monitor), `metricas` |
| `painel/` | o painel web |
| `instalar/segredos.sh` | grava os segredos no seu Supabase sem passar por chat |

## Regras de segurança

- Token, chave e senha **nunca** vão para o código nem para chat. Ficam nos secrets do Supabase e no Vault.
- Toda tabela tem RLS; o acesso passa por `can_access_account()` e `is_admin()`.
- Cadastro público desligado: só o administrador cria usuários, com senha forte.
- O webhook só aceita evento com assinatura válida da Meta e só grava na conta dona do evento.

## Limites da Meta

- Em modo de desenvolvimento, só contas **testadoras** do app funcionam. Para clientes em escala: Análise do App + verificação da empresa.
- Publicar: 2 a 20 slides em JPEG, legenda até 2.200 caracteres, sem música.
- O token do Instagram vence em ~60 dias: **Conexão → Renovar conexão**.

## Uso

Veja [LICENCA.md](LICENCA.md).
