# ZXP Solutions — Dashboard Mercado Livre

Dashboard financeiro e operacional para um vendedor do Mercado Livre (VAZXPRESS). Single-tenant, feito sob medida: puxa pedidos/anúncios/devoluções direto da API do Mercado Livre, calcula lucro e margem já descontando taxa, frete, imposto e ADS, e dá controle de estoque, metas, custos, tarefas e notificações de venda em tempo real — tudo num só lugar, com Owner e Colaborador tendo acessos diferentes.

Não é um projeto genérico/template: as regras de negócio (como o lucro é calculado, o que entra ou não em cada número) são específicas dessa operação. Ver `AGENTS.md` e `CLAUDE.md` para instruções de como trabalhar neste repositório.

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript**
- **Firebase**: Auth (Google + e-mail/senha), Firestore (dados), Cloud Messaging (push), Admin SDK nas rotas de servidor
- **Mercado Livre API**: OAuth do vendedor, pedidos, anúncios (Product Ads), devoluções, estoque Full
- **Tailwind CSS 4** (utilitário) + CSS próprio (`app/globals.css`, tema autoral "Onyx Gold")
- **Chart.js** / **@dnd-kit** (gráficos e drag-and-drop do Kanban de tarefas)
- Deploy: **Vercel** (app + cron) — regras do Firestore são deploy separado via Firebase CLI

## Funcionalidades

| Aba | O que faz |
|---|---|
| **Dashboard** | Faturamento, lucro, margem, ritmo do dia/mês vs. meta, comparação com período anterior, Central de Atenção (alertas de margem/estoque/meta), gráfico de receita, produtos em risco de ruptura |
| **Pedidos** | Lista de pedidos com lucro por venda, filtros avançados (valor, margem, status, logística, ADS), drawer de detalhe, cancelamento/devolução destacados |
| **Ads** | Investimento e retorno por anúncio, ROAS, ACOS/TACOS, break-even, diagnóstico e recomendação de ação por anúncio, exportação CSV |
| **Metas** | Metas de faturamento (até 3 níveis) e de lucro, progresso em tempo real, cenários conservador/esperado/agressivo, meta diária adaptativa, histórico visual meta vs. realizado |
| **Custos** | Custos operacionais (diário/mensal/avulso), categorização, arquivar (sem apagar histórico), impacto no faturamento/lucro do mês |
| **Estoque** | Estoque local + Full, custo médio por movimentação, cobertura em dias e sugestão de reposição, alertas de ruptura |
| **DRE** | Demonstrativo de resultado completo, comparação com período anterior, tooltip explicando cada subtotal, exportação CSV |
| **Tarefas** | Kanban (A Fazer/Fazendo/Concluído) com drag-and-drop, prioridade, prazo, rastro de atividade, notificação para quem recebe uma tarefa |
| **Acesso** | Controle de quem entra (Owner/Colaborador), permissão granular por aba para colaborador, trilha de auditoria imutável (quem criou/editou/arquivou/excluiu o quê) |

Outros pontos transversais:
- **Command palette** (Ctrl/Cmd+K) para pular entre abas.
- **Central de Notificações** (sino no topo): histórico de vendas/alertas/sistema, marcar como lida, filtro por tipo.
- **Notificações de venda em 3 camadas**: push nativo (com o app fechado), toast premium (com o app aberto) e o evento persistido no Firestore como fonte de verdade — nunca duas notificações para a mesma venda, mesmo em retry do webhook do ML.
- **PWA**: instalável (Android/iOS/desktop), ícones e manifest prontos.

## Estrutura do projeto

```
app/
  api/ml/            rotas que falam com a API do Mercado Livre (pedidos, ads, estoque, webhook, cron...)
  api/push/           envio/teste de notificação push
  api/notify/         disparo de notificação por ação interna (ex.: tarefa atribuída)
  api/admin/          rotas administrativas (criar login por e-mail/senha)
  firebase-messaging-sw.js/  Service Worker do FCM, gerado em runtime
  page.tsx            shell autenticado (sidebar, abas, roteamento por estado local)
components/
  dashboard/          Dashboard e seus painéis (KPIs, gráficos, Central de Atenção...)
  tabs/                cada aba do menu (Pedidos, Ads, Metas, Custos, Estoque, DRE, Tarefas, Acesso)
  Sale*.tsx, Notification*.tsx  toast de venda e Central de Notificações
lib/
  domain/              regras de negócio puras (cálculo, alertas, notificações, tipos) — sem I/O, fáceis de testar
  firebase/            client SDK (auth, Firestore, push) e Admin SDK
  ml/                  integração com a API do Mercado Livre (pedidos, ads, sync, token)
  *.ts (raiz)          orquestração server-only (envio de push, eventos de notificação, agrupamento anti-spam)
firestore.rules        regras de segurança do Firestore (autoridade real — componentes de UI são só guarda de UX)
```

## Configuração

### 1. Requisitos

- Node.js 20+
- Acesso ao projeto Firebase (`vazxpress-a2350` — ver `.firebaserc`)
- Credenciais de app do Mercado Livre (Devolopers ML) para a conta do vendedor

### 2. Instalar dependências

```bash
npm install
```

### 3. Variáveis de ambiente

Crie `.env.local` na raiz. **Nunca** prefixe com `NEXT_PUBLIC_` as credenciais de servidor — isso as expõe no navegador.

```env
# Firebase (config pública, cliente)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=vazxpress-a2350
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
# Chave VAPID (Firebase Console > Project Settings > Cloud Messaging) — sem ela, push fica desativado
NEXT_PUBLIC_FIREBASE_VAPID_KEY=

# Firebase Admin (service account — Project Settings > Service Accounts > Generate new private key)
FIREBASE_PROJECT_ID=vazxpress-a2350
FIREBASE_CLIENT_EMAIL=...@....iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Mercado Livre (app OAuth do vendedor)
ML_APP_ID=
ML_SECRET=
ML_REDIRECT_URI=https://SEU_DOMINIO/api/ml/callback
ML_SELLER_ID=            # user_id numérico da conta ML

# Protege as rotas /api/ml/* e /api/push/* chamadas pelo cron (sem login de usuário)
CRON_SECRET=             # gere com: openssl rand -hex 32
```

Depois de configurar o app OAuth no [DevCenter do Mercado Livre](https://developers.mercadolivre.com.br/), cadastre lá:
- **Redirect URI**: igual ao `ML_REDIRECT_URI` acima.
- **Notificações (webhook)**: `https://SEU_DOMINIO/api/ml/webhook`, tópico `orders_v2` — é o que dispara a notificação de venda em tempo real.

### 4. Rodar local

```bash
npm run dev
```

Abra `http://localhost:3000`. O primeiro login autenticado vira automaticamente **Owner** (bootstrap de acesso) — os próximos precisam ser cadastrados por um Owner na aba **Acesso**.

## Firebase — regras e deploy

Regras do Firestore (`firestore.rules`) são **deploy separado**, nunca automático junto com o app. Depois de qualquer mudança nelas:

```bash
npx firebase-tools login
npx firebase-tools use vazxpress-a2350
npx firebase-tools deploy --only firestore:rules --project vazxpress-a2350
```

Sem isso, o Firestore continua rodando a regra antiga — inclusive em produção.

### Modelo de dados (Firestore, coleções principais)

- `controleAcesso` / `controleAcessoMeta` — quem tem acesso, papel (owner/colaborador), permissão granular por aba
- `ml_orders`, `ml_returns` — cache/sincronização de pedidos e devoluções do ML
- `estoque`, `estoque_movimentos` — produtos e livro de movimentações (entrada/saída/ajuste)
- `custos`, `metas`, `metasHistorico` — custos operacionais e metas por mês
- `tarefas` — Kanban, compartilhado entre owner e colaborador
- `notification_events` — trilha de eventos de notificação (venda, cancelamento, tarefa atribuída...), append-only
- `auditLog` — trilha de auditoria de ações administrativas (custo, meta, acesso)
- `pushTokens` — tokens de dispositivo por usuário para envio de push
- `usuarios/{uid}/preferences/notifications` — preferências de notificação por usuário

## Sincronização automática

`vercel.json` define um cron que chama `GET /api/ml/cron` diariamente, mantendo pedidos/devoluções do mês em dia sem depender do botão manual de sincronizar. A rota exige `CRON_SECRET` (header `Authorization: Bearer <CRON_SECRET>`, injetado pela própria Vercel).

Vendas em tempo real não dependem do cron: o webhook do Mercado Livre (`/api/ml/webhook`) dispara a notificação assim que o pedido é pago, com deduplicação garantida mesmo se o ML reenviar o mesmo evento (idempotência via Firestore — ver `lib/notification-events.ts`).

## Deploy

### Vercel (recomendado)

1. Importe o repositório — o framework Next.js é detectado automaticamente.
2. Configure as mesmas variáveis de `.env.local` em Project Settings → Environment Variables.
3. Redeploy.
4. Regras do Firestore continuam sendo deploy manual via Firebase CLI (ver acima) — a Vercel não mexe nisso.

### Firebase Hosting (alternativa)

```bash
npx firebase-tools deploy --only hosting --project vazxpress-a2350
# ou tudo de uma vez (hosting + rules):
npx firebase-tools deploy --project vazxpress-a2350
```

## Troubleshooting

- **`firebase is not recognized`** — use `npx firebase-tools ...` (não precisa instalar global).
- **`Not in a Firebase app directory`** — confirme que está rodando o comando na raiz do repo (onde está `firebase.json`).
- **`Failed to authenticate`** — rode `npx firebase-tools login` de novo.
- **Mudou `firestore.rules` e nada mudou** — faltou o deploy das regras (ver seção acima). É o erro mais comum.
- **Notificação push não chega** — confira: `NEXT_PUBLIC_FIREBASE_VAPID_KEY` configurada, HTTPS (push não funciona em `http://` fora de `localhost`), permissão do navegador concedida, e se o Service Worker (`/firebase-messaging-sw.js`) está registrado (DevTools → Application → Service Workers).
- **Webhook do ML não dispara** — confirme o cadastro da URL no DevCenter (tópico `orders_v2`) e que `ML_SELLER_ID`/`ML_APP_ID`/`ML_SECRET` batem com a conta certa.

## Verificação antes de commitar

```bash
npx tsc --noEmit
npm run build
npm run lint
```

Convenção do projeto: commits pequenos e independentes, mensagem detalhada em português explicando o quê e por quê. Push para `main` fica sempre a critério de quem está revisando — nunca automático.
