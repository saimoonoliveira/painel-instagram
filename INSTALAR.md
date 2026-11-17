# Instalação passo a passo

Leva de 1 a 2 horas na primeira vez. Tudo roda em contas suas, nos planos grátis.

> **Atalho:** abra esta pasta no Claude Code e peça "instala pra mim seguindo o INSTALAR.md".
> Ele executa os comandos e te diz onde clicar nas partes que só você pode fazer (painel da Meta, Vercel, Supabase).
> **Nunca cole senha, token ou chave no chat.** Os segredos entram pelo script do passo 5, direto no terminal.

## O que você precisa

| Conta | Para quê | Custo |
|---|---|---|
| [GitHub](https://github.com) | receber o código | grátis |
| [Supabase](https://supabase.com) | banco de dados e funções | grátis |
| [Vercel](https://vercel.com) | publicar o painel | grátis |
| [Meta for Developers](https://developers.facebook.com) | conversar com o Instagram | grátis |
| Instagram **profissional** (Empresa ou Criador) | a conta que será automatizada | grátis |
| [Apify](https://apify.com) (opcional) | aba Monitor: guardar stories de concorrentes | US$ 5/mês grátis |

No computador: [Node.js 20+](https://nodejs.org) e `git`.

## 1. Pegue a sua cópia

No GitHub, no repositório que você recebeu: **Use this template → Create a new repository** (deixe **privado**). Depois:

```bash
git clone https://github.com/<seu-usuario>/<seu-repositorio>.git
cd <seu-repositorio>
npm install && npm --prefix painel install
```

## 2. Supabase

1. Em supabase.com, **New project** (região **South America (São Paulo)**). Guarde a senha do banco.
2. Copie o **Reference ID** do projeto (Project Settings → General).
3. No terminal, na pasta do projeto:

```bash
npx supabase login
npx supabase link --project-ref <reference-id>
npx supabase db push
```

4. **Feche o cadastro aberto:** Authentication → Sign In / Providers → desligue **Allow new users to sign up**. Só você cria usuários.

## 3. App da Meta

1. Em developers.facebook.com → **Meus apps → Criar app**, tipo **Empresa**.
2. Adicione o produto **Instagram** → **Configuração da API com login do Instagram**.
3. Anote o **ID do app do Instagram** e a **Chave secreta do app do Instagram** (você usa nos passos 4 e 5).
4. Em **Configurar login comercial do Instagram**, em URIs de redirecionamento, coloque:
   `https://<reference-id>.supabase.co/functions/v1/oauth`
5. Em **Funções do app → Funções → Testadores do Instagram**, adicione a conta do Instagram que vai usar. No Instagram dessa conta: **Configurações → Apps e sites → Convites de testador → Aceitar**.

> Em modo de desenvolvimento, o app só funciona com contas que são testadoras dele. Para atender muitas contas de clientes, a Meta exige a **Análise do App** e a **verificação da empresa** (leva semanas).

## 4. Painel na Vercel

```bash
cd painel
npx vercel link            # crie um projeto novo
npx vercel env add VITE_SUPABASE_URL production        # https://<reference-id>.supabase.co
npx vercel env add VITE_SUPABASE_ANON_KEY production   # Supabase → Project Settings → API → anon public
npx vercel env add VITE_INSTAGRAM_APP_ID production    # o ID do app do Instagram (passo 3)
npx vercel env add VITE_NOME_APP production            # nome que aparece no painel (opcional)
npx vercel --prod
cd ..
```

Anote o endereço que aparece no final (`https://....vercel.app`).

Para rodar o painel no seu computador: copie `painel/.env.example` para `painel/.env`, preencha e rode `npm --prefix painel run dev`.

## 5. Segredos (sem passar por chat)

```bash
bash instalar/segredos.sh
```

Ele pede o ID e a chave secreta do app do Instagram, o endereço da Vercel e, se quiser, o token do Apify (Apify → Settings → API & Integrations). As chaves internas ele mesmo gera. No final mostra a **URL de callback** e o **token de verificação** do passo 7.

## 6. Funções

```bash
for f in webhook oauth conteudo publicar vigiar metricas; do npx supabase functions deploy $f --use-api; done
```

## 7. Webhook no painel da Meta

No app da Meta → Instagram → **Configurar webhooks**:

- URL de callback e token de verificação: os que o script do passo 5 mostrou.
- Assine os campos **comments**, **messages** e **messaging_postbacks**.

## 8. Seu usuário

1. Supabase → **Authentication → Users → Add user → Create new user** (e-mail e senha forte, marque Auto Confirm).
2. Torne-o administrador:

```bash
npx supabase db query --linked "insert into app_admins (user_id) select id from auth.users where email = 'voce@exemplo.com'"
```

## 9. Primeiro acesso

1. Abra o endereço da Vercel e entre com o e-mail e a senha.
2. Vá em **Conexão → Conectar Instagram**, entre na conta testadora e autorize.

Pronto: crie um fluxo em **Fluxos** e um gatilho em **Gatilhos** para ele responder sozinho.

## Dar acesso a outra pessoa

Crie o usuário dela (passo 8.1, sem o 8.2), com senha forte. Ela entra e conecta o Instagram dela. Cada usuário só vê as contas que ele mesmo conectou; o administrador vê todas.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| "Token expirado" na Conexão | O token do Instagram dura ~60 dias: **Renovar conexão**. |
| Comentário não dispara nada | Confira se existe um **gatilho** ativo apontando para o fluxo e se o webhook está assinado (passo 7). |
| Aba Monitor parada | Falta o token do Apify: rode `bash instalar/segredos.sh` de novo e informe. |
| Projeto do Supabase pausado | No plano grátis, projetos sem uso por 7 dias são pausados. Reative no painel do Supabase. |
