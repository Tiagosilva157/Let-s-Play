# 🏐 Vôlei Manager

Sistema de gestão de turmas de vôlei: confirmação de presença por link público, pagamentos Pix (Asaas), mensalistas com assinatura recorrente e listas automáticas nos grupos do WhatsApp (GP Connect).

## Arquitetura

- **Next.js 16 (App Router) + TypeScript + Tailwind** — painel admin (`/admin`) e link público (`/j/[slug]`)
- **Supabase Postgres** — dados, RLS, funções SQL transacionais (corrida da última vaga resolvida com `SELECT ... FOR UPDATE`)
- **Asaas** — Pix avulso, assinaturas mensais, webhook idempotente
- **GP Connect** — OTP por WhatsApp e mensagens nos grupos
- **Vercel Cron** — `/api/cron/tick` (1/min: expira reservas, abre/fecha listas, envia fila de mensagens) e `/api/cron/daily` (gera jogos, conciliação com Asaas)

## Setup

### 1. Supabase
1. Crie um projeto em [supabase.com](https://supabase.com).
2. Rode as migrations em ordem no SQL Editor: `supabase/migrations/0001_schema.sql`, `0002_functions.sql`, `0003_rls.sql`.
3. Crie o usuário admin em **Authentication → Users** (email+senha) e insira na tabela:
   ```sql
   insert into admins (id, name) values ('<uuid do usuário>', 'Seu Nome');
   ```

### 2. Variáveis de ambiente
Copie `.env.example` para `.env.local` e preencha. **Nunca** exponha `SUPABASE_SERVICE_ROLE_KEY`, `ASAAS_API_KEY` ou `GPCONNECT_TOKEN` no frontend.

### 3. Asaas
1. Crie a conta sandbox em [sandbox.asaas.com](https://sandbox.asaas.com) e pegue a API key.
2. Gere um `ASAAS_WEBHOOK_TOKEN` forte (32+ caracteres).
3. Após o deploy, registre o webhook:
   ```bash
   node scripts/setup-asaas-webhook.mjs
   ```

### 4. GP Connect
A doc oficial fica atrás de login (base.connetchannelslite.com.br). Ajuste em `.env.local` e, se o payload diferir, em `src/lib/gpconnect.ts`:
- `GPCONNECT_BASE_URL`, `GPCONNECT_TOKEN`
- `GPCONNECT_GROUP_PATH` (mensagem para grupos) e `GPCONNECT_TEXT_PATH` (mensagem individual/OTP)

### 5. Deploy (Vercel)
1. Importe o repositório na Vercel e configure as env vars.
2. Os crons de `vercel.json` são registrados automaticamente. Configure `CRON_SECRET`.

## Fluxos principais

- **Mensalista**: recebe status `invited` quando a lista abre → confirma ("Vou jogar") ou recusa no link público. Recusa libera a vaga para avulsos.
- **Avulso**: telefone → OTP WhatsApp → reserva a vaga por 15 min → paga o Pix → webhook confirma automaticamente. Sem pagamento, a reserva expira e a vaga volta.
- **Pagou com lista cheia / jogo cancelado**: participação vira `pending_review`; o admin decide entre crédito ou estorno na tela do jogo.
- **Desistência fora do prazo**: bloqueada para o jogador; cobrança mantida (política configurada).

## Testes recomendados antes de produção

- Fluxo completo no sandbox Asaas (reserva → Pix → webhook → confirmado).
- Corrida da última vaga: disparar 2+ reservas simultâneas — apenas 1 deve confirmar.
- Webhook duplicado (reenviar o mesmo payload): deve responder `duplicate: true`.
- Link público em celular real: confirmar presença em menos de 30 segundos.
