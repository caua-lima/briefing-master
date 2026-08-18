# Auditoria — transformação em SaaS multi-tenant

**Repositório:** `zxp-market` (`github.com/caua-lima/zxp-market`)
**Branch auditado:** `main` @ `087722d`
**Data:** 2026-08-17
**Escopo:** somente leitura. Nenhuma lógica de negócio, schema ou feature foi
alterada nesta etapa.

---

## ⚠️ Leia isto antes de qualquer coisa

**A multi-tenancy que este documento foi pedido para planejar já existe,
implementada, no branch `saas` deste mesmo repositório.**

O `controleml-saas` não é legado, backend separado nem duplicata: é o espelho
publicado do branch `saas`. Ele já tem OAuth do Mercado Livre por usuário,
dados escopados em `users/{uid}`, `firestore.rules` multi-tenant e painel de
licença com prazo — as "fases 1 a 4" de um roadmap que também já está escrito
(`docs/SAAS.md`, só naquele branch).

O problema real **não é construir multi-tenancy**. É que os dois lados
divergiram em 16/07/2026 e desde então:

| Lado | Commits à frente | Último commit | O que tem de único |
|---|---|---|---|
| `main` (aqui) | **252** | 17/08/2026 | Todo o produto: Ads, Full, notificações, estoque, DRE, marca |
| `saas` / `controleml-saas` | **8** | 04/08/2026 | Toda a multi-tenancy |

Detalhes e a decisão que isso força estão na **Seção 8**, que virou a seção
mais importante deste relatório. Recomendo lê-la antes das outras.

---

## 1. AGENTS.md e CLAUDE.md

Ambos existem na raiz e foram lidos primeiro.

- **`CLAUDE.md`** — uma linha: `@AGENTS.md`. Só delega.
- **`AGENTS.md`** — conteúdo integral:

  > **This is NOT the Next.js you know**
  > This version has breaking changes — APIs, conventions, and file structure
  > may all differ from your training data. Read the relevant guide in
  > `node_modules/next/dist/docs/` before writing any code. Heed deprecation
  > notices.

**Consequência prática para a migração:** o projeto roda **Next.js 16.2.4**
com **React 19.2.4**. Qualquer receita de multi-tenancy encontrada em blog,
tutorial ou memória de modelo pode estar desatualizada em relação a esta
versão (middleware, rotas dinâmicas, `params` assíncronos, cache). A instrução
do repo é explícita: consultar `node_modules/next/dist/docs/` antes de
escrever código. Isso vale especialmente para roteamento por tenant
(subdomínio/path), que é justamente a área com mais mudanças recentes no Next.

---

## 2. Estrutura real do projeto

### Stack confirmada (via `package.json`)

| Item | Versão | Bate com a descrição original? |
|---|---|---|
| `next` | 16.2.4 | ✅ |
| `react` / `react-dom` | 19.2.4 | ✅ |
| `firebase` (client) | ^12.12.1 | ✅ |
| `firebase-admin` | ^13.10.0 | ✅ |
| `chart.js` + `react-chartjs-2` | ^4.5.1 / ^5.3.1 | ✅ |
| `@dnd-kit/core` | ^6.3.1 | ✅ |
| `tailwindcss` + `@tailwindcss/postcss` | ^4 | ⚠️ ver nota |
| `vitest` | ^4.1.10 | ➕ não estava na descrição |
| `typescript` | ^5 | ✅ |

**Divergências encontradas:**

- **Tailwind está declarado mas praticamente não é usado.** O estilo real do
  app vive em `app/globals.css` (~1.060 linhas de CSS escrito à mão, com
  design tokens em CSS custom properties) e em estilos inline nos componentes.
  Isso importa para o SaaS: **theming por tenant** (cor/logo do cliente) se
  encaixa muito bem no modelo de custom properties que já existe, e mal no
  modelo Tailwind. É uma vantagem acidental.
- **Vitest com 189 testes** não constava na descrição. É um ativo relevante:
  a lógica de cálculo está coberta e serve de rede de segurança para o
  refactor multi-tenant.
- **Nenhuma dependência de pagamento/billing.** Coerente com o modelo de
  negócio descrito no `docs/SAAS.md` do branch `saas` (venda por call,
  pagamento fora do sistema, liberação manual).

### Estrutura de pastas

```
app/
  api/            37 rotas (ver abaixo)
  page.tsx        SPA por abas — todo o dashboard num componente com activeTab
  layout.tsx      metadata (contém "VAZXPRESS" hardcoded)
  globals.css     design system inteiro
  manifest.ts     PWA (contém "VAZXPRESS" hardcoded)
components/
  tabs/           11 abas + subpastas ads/, desempenho/, full/
  dashboard/      Dashboard.tsx, ActionCenter, KPIs, gráficos
lib/
  domain/         46 arquivos (fonte + teste) — LÓGICA PURA, sem I/O, 189 testes
  firebase/       admin.ts (server), data.ts (client), cache.ts, push.ts
  ml/             client, sync, orders, getToken, order-finance, account
```

**Ponto arquitetural forte:** a separação `lib/domain` (puro, testável) vs
`lib/*` e `app/api` (I/O) já está consolidada e respeitada. Para a migração
multi-tenant isso é ouro — **quase nada em `lib/domain` precisa mudar**,
porque ele já recebe dados por parâmetro em vez de buscar sozinho. O trabalho
concentra-se em `lib/firebase`, `lib/ml` e `app/api`.

### Rotas de API (37)

<details>
<summary>Lista completa</summary>

`admin/create-user` · `backup` · `ml/account` · `ml/ads` · `ml/ads-spend` ·
`ml/auth` · `ml/backfill` · `ml/callback` · `ml/cron` · `ml/debug` ·
`ml/debug-ads` · `ml/debug-claims` · `ml/debug-inbound` · `ml/debug-shipping` ·
`ml/debug_order` · `ml/desempenho` · `ml/disconnect` · `ml/envios` ·
`ml/estoque-forecast` · `ml/estoque-ml` · `ml/force-logout` · `ml/gestao-full` ·
`ml/metrics` · `ml/orders` · `ml/pedidos` · `ml/resumo-diario` · `ml/returns` ·
`ml/snapshot` · `ml/status` · `ml/sync-all` · `ml/sync-orders` · `ml/today` ·
`ml/vincular-sku` · `ml/webhook` · `notify/task-assigned` · `notify/task-due` ·
`push/test`

</details>

⚠️ **6 rotas de debug em produção** (`ml/debug`, `ml/debug-ads`,
`ml/debug-claims`, `ml/debug-inbound`, `ml/debug-shipping`, `ml/debug_order`).
Elas passam por `requireAccess`, então não são anônimas — mas num SaaS elas
expõem payload cru do ML de **um** seller. Precisam ser removidas ou travadas
atrás de um papel de admin-master antes de haver mais de um cliente.

---

## 3. Schema do Firestore

### Coleções em uso (17)

| Coleção | Conteúdo | Escrita por | Lida por | Tem dono? |
|---|---|---|---|---|
| `estoque` | Produtos, custo médio, SKU, MLBs, faixas de imposto/custo | cliente (`data.ts`) | cliente + 8 rotas de API | ❌ |
| `estoque_movimentos` | Livro de entradas/baixas/ajustes | cliente (`data.ts`) | cliente | ❌ |
| `ml_orders` | Pedidos sincronizados do ML | `lib/ml/sync.ts`, webhook | 6 rotas | ❌ |
| `ml_returns` | Devoluções/reclamações | `lib/ml/sync.ts` | `metrics`, `ads`, `desempenho`, `pedidos` | ❌ |
| `ml_tokens` | **Token OAuth do ML — doc fixo `main`** | `token.ts`, `callback` | `token.ts`, `account`, `disconnect`, `force-logout` | ❌ |
| `controleAcesso` | `{email}` → role, permissoesEdicao, displayName, photoURL | cliente + `admin/create-user` | `api-auth.ts`, rules | ❌ |
| `controleAcessoMeta` | doc `config` — bootstrap do primeiro owner | cliente | rules | ❌ |
| `metasHistorico` | Metas por mês | cliente | cliente, webhook | ❌ |
| `custos` | Custos fixos | cliente | cliente, `metrics` | ❌ |
| `tarefas` | Kanban | cliente | cliente, `task-reminders-run.ts` | ❌ |
| `full_remessas` | Remessas ignoradas + custo manual de coleta | cliente | `gestao-full` | ❌ |
| `ads_alteracoes` | Changelog manual de campanhas | cliente | cliente | ❌ |
| `alertasDispensados` | Alertas dispensados (tem `email`, mas não tenant) | cliente | cliente | ❌ |
| `pushTokens` | Tokens FCM por dispositivo (tem `email`) | cliente | `push-send.ts` | ❌ |
| `notification_events` | Eventos de notificação (id = dedupeKey) | Admin SDK | cliente | ❌ |
| `snapshots_diarios` | Retrato diário de anúncios/reputação | `ml/snapshot` | `ml/snapshot` | ❌ |
| `backups_semanais` | Backup semanal (7 coleções) | `lib/backup-run.ts` | — | ❌ |
| `auditLog` | Trilha de auditoria (tem `por` = email) | cliente | rules (só owner) | ❌ |
| `usuarios/{uid}/preferences` | Preferências de notificação | cliente | cliente | ⚠️ parcial |

### Confirmação: **nenhuma coleção tem campo de tenant**

Confirmado. **Zero** coleções de negócio têm `tenantId`, `ownerUid` ou
equivalente. Todas são globais — um único espaço de dados.

O que existe hoje e pode **parecer** escopo mas não é:

- `email` em `pushTokens`, `alertasDispensados`, `auditLog` — separa **usuários
  dentro da mesma empresa**, não empresas entre si. Dois clientes do SaaS
  cairiam nas mesmas coleções.
- `usuarios/{uid}/preferences` — é o **único** caminho já escopado por `uid`,
  e guarda apenas preferência de notificação. É o embrião do padrão certo.

### O chokepoint: `ml_tokens/main`

```ts
// app/api/ml/token.ts:16
const doc = await db.collection("ml_tokens").doc("main").get();
```

Documento de ID **literal e fixo**. Toda a integração com o Mercado Livre —
sync, webhook, cron, Ads, estoque, envios — resolve credencial por aqui.
É o ponto único onde "de quem é esta conta?" precisa deixar de ser constante e
virar parâmetro.

---

## 4. Configuração via env que deveria ser por tenant

Não existe `.env.example` no repositório (só `.env` e `.env.local`, ambos
gitignored e **não lidos nesta auditoria** — são arquivos de segredo). A lista
abaixo veio de varredura de `process.env.*` no código-fonte.

### Deve virar configuração POR TENANT

| Variável | Onde aparece | Vira o quê |
|---|---|---|
| `ML_SELLER_ID` | `lib/ml/orders.ts:4`, `lib/ml/sync.ts:6`, `estoque-forecast:7`, `today:5`, `debug-inbound:6`, `debug-shipping:6`, `gestao-full` | `seller_id` derivado de `/users/me` do token do cliente |
| `ML_REDIRECT_URI` | `ml/auth`, `ml/callback` | URI única do app SaaS + `state` identificando o tenant |

### Deve continuar GLOBAL (é a aplicação, não o cliente)

| Variável | Papel |
|---|---|
| `ML_APP_ID`, `ML_SECRET` | Credencial do **app** no ML. Um app OAuth atende todos os clientes — não é por tenant. |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Admin SDK. Um projeto Firebase, N tenants dentro. |
| `NEXT_PUBLIC_FIREBASE_*` (6 vars) | Config do cliente Firebase. |
| `CRON_SECRET` | Autenticação do cron da Vercel. |

### 🔴 Achado crítico: fallback hardcoded do seller

```ts
// lib/ml/orders.ts:4  (e mais 5 arquivos, idêntico)
export const SELLER_ID = process.env.ML_SELLER_ID || "2420261535";
```

O seller da VAZXPRESS está **embutido no código** em **6 arquivos** como
fallback. Num SaaS isso é uma bomba: se a resolução de tenant falhar por
qualquer motivo, o sistema não quebra — ele **silenciosamente consulta e grava
dados da conta do dono**. Falha silenciosa que serve dado errado é pior que
erro em tela.

**Recomendação:** eliminar o fallback antes de qualquer outra coisa. Sem
tenant resolvido, a operação deve **falhar explicitamente**.

Arquivos: `lib/ml/orders.ts:4` · `lib/ml/sync.ts:6` ·
`app/api/ml/estoque-forecast/route.ts:7` · `app/api/ml/today/route.ts:5` ·
`app/api/ml/debug-inbound/route.ts:6` · `app/api/ml/debug-shipping/route.ts:6`

---

## 5. Auditoria do `lib/domain`

### 5.1 Genérico — mantém igual para qualquer tenant

Estes implementam regras do Mercado Livre ou contabilidade padrão. **Não
precisam mudar.**

| Módulo | Regra |
|---|---|
| `calc.ts` | Lucro, margem, DRE. Aritmética. |
| `types.ts` | `impostoNaData` / `custoNaData` — vigência de custo e imposto por data. Regra contábil correta e genérica. |
| `tempo.ts` | Conversão de fuso (`America/Sao_Paulo`). Genérico para o Brasil. |
| `ads.ts` | ROAS, break-even, ROAS alvo. Fórmulas. |
| `ads-*.ts` (6 módulos) | Reconciliação, comparação, changelog, participação. Genérico. |
| `mercadolider-requisitos.ts` | Limiares **do próprio ML** (1% reclamações, 0,5% cancelamentos, 6% atraso). Publicados pelo ML, iguais para todo seller. |
| `reputation.ts` | Níveis/selos do ML. |
| `repurchase.ts`, `sales-heatmap.ts`, `shipping-performance.ts` | Análises genéricas. |
| `estoque.ts` (`consolidarEstoqueAnuncios`) | Dedup de pool Full por `inventory_id`. Comportamento **da API do ML**, genérico. |
| `remessas.ts`, `full-auto-baixa.ts` | Fluxo Full do ML. |
| `notifications.ts` (estrutura) | Modelo de evento. |

### 5.2 Específico da operação — candidato a config por tenant

Todos são **números de política de negócio** escolhidos para a VAZXPRESS,
hoje constantes no código. Nenhum é errado; todos são *opinião* de uma
operação.

| # | Valor | Arquivo:linha | Por que é específico |
|---|---|---|---|
| 1 | `HIGH_VALUE_SALE_THRESHOLD = 250` | `notifications.ts:26` | "Venda de alto valor" a partir de R$250. Quem vende celular tem outro patamar. |
| 2 | `DEFAULT_LOW_MARGIN_THRESHOLD = 8` | `notifications.ts:29` | Margem <8% = "atenção". Varia muito por categoria. |
| 3 | `< 7` crítico / `< 15` repor | `estoque.ts:41-42` | Cobertura em dias. Depende do lead time do fornecedor de cada seller. |
| 4 | `ESTOQUE_BAIXO_LIMIAR = 5` | `risk.ts:37` | Modo degradado sem previsão. Depende do ticket/giro. |
| 5 | `CLIQUES_MIN = 20` | `ads.ts:60` | Mínimo estatístico para julgar anúncio. Depende do volume. |
| 6 | `INVESTIMENTO_RELEVANTE = 20` | `ads.ts:61` | R$20 de verba para "vale opinar". Escala com o orçamento. |
| 7 | `a.vendas >= 3` | `alerts.ts:107` e `:231` | 3 vendas para declarar tendência. |
| 8 | `margem >= metaMargem * 1.3` | `alerts.ts:231` | "Oportunidade" = 30% acima da meta. Número escolhido. |
| 9 | `PRECO_MIN_PCT = 1` | `snapshot-diff.ts:57` | 1% de variação de preço para alertar. |
| 10 | `< 0.005` | `snapshot-diff.ts:141` | Ruído de taxa de reputação. |
| 11 | `DIAS_ALVO = 30` | `EstoqueTab.tsx:20` | Alvo de cobertura para sugestão de reposição. |
| 12 | `FULL_BAIXO = 5` | `EstoqueTab.tsx` | Full "baixo" = reabastecer. |
| 13 | `CUSTO_FAIXA_SENTINELA = "2000-01-01"` | `types.ts:143` | Sentinela retroativa. Genérico, mas merece revisão para tenant que importa histórico antigo. |

**Recomendação:** virar um doc `tenants/{id}/config` com defaults iguais aos
atuais. Ninguém precisa configurar nada para começar — mas quem precisar,
consegue. **Não** transformar em campos obrigatórios de onboarding: 13
perguntas antes de ver o primeiro número mataria a ativação.

### 5.3 Marca hardcoded (fora do `lib/domain`)

`app/layout.tsx:19-20` · `app/manifest.ts:10,12` · `app/page.tsx:290` ·
`components/LoginCard.tsx:97-100` — todos contêm "VAZXPRESS" literal.

---

## 6. Estado do `firestore.rules`

**Não existe nenhuma noção de tenant.** O modelo é: *"quem está na lista de
acesso vê tudo"*.

```js
// firestore.rules:19-22
function isAuthorized() {
  return signedIn()
    && exists(/databases/$(database)/documents/controleAcesso/$(request.auth.token.email));
}
```

E o padrão que se repete em quase toda coleção:

```js
// firestore.rules:112-115
match /estoque/{docId} {
  allow read: if isAuthorized();      // ← qualquer autorizado lê TODO o estoque
  allow write: if podeEditar('estoque');
}
```

**Implicação direta:** se dois clientes do SaaS fossem cadastrados hoje em
`controleAcesso`, **cada um leria e escreveria os dados do outro**. Não é uma
brecha sutil — é o comportamento projetado, correto para single-tenant.

O que já existe de bom e deve ser preservado:

- **Granularidade de permissão por aba** (`podeEditar('estoque')`, linhas 29-32)
  espelhando `AccessGuard.tsx`. Vira permissão *dentro* do tenant.
- **Escopo por usuário já correto** em `pushTokens` (146-150),
  `alertasDispensados` (154-158), `usuarios/{uid}/preferences` (180-182) —
  comparam `request.auth`. É o padrão a replicar.
- **`auditLog` imutável** (188-192): ninguém altera nem apaga, nem o owner.
- **Bootstrap do primeiro owner** via `controleAcessoMeta/config` (59-66) —
  precisa virar por-tenant.

---

## 7. Cron e Webhook — onde mora a suposição de conta única

### `/api/ml/cron` (`vercel.json`: `0 9 * * *`)

```ts
// app/api/ml/cron/route.ts:33
const accessToken = await getMlAccessToken();   // ← sem parâmetro: só existe UMA conta
```

Roda `syncOrdersRange` / `syncReturnsRange` / `syncClaimsRange` para mês
atual + anterior, e desde 08/2026 também `enviarLembretesDeTarefa()` e
`fazerBackupSemanal()` (domingos).

**Para multi-tenant vira um laço sobre tenants.** Duas restrições reais:

1. ⚠️ **Plano Hobby da Vercel só aceita cron diário.** Documentado em
   `cron/route.ts:9-18` — já derrubou o deploy inteiro uma vez. Com N tenants
   isso não escala por cron.
2. ⚠️ **`maxDuration = 60`** (linha 6). Um tenant já consome boa parte disso.
   Com dezenas, estoura antes de terminar — precisa virar fila/batch, não laço
   síncrono.

### `/api/ml/webhook` (`orders_v2`)

```ts
// app/api/ml/webhook/route.ts:150
const token = await getValidMlAccessToken();    // ← idem, conta única
```

🔴 **O problema mais sério dos dois.** O webhook recebe do ML apenas um
ponteiro (`resource: "/orders/123"`). Hoje ele:

1. **Não valida de qual seller é o pedido** — não há checagem de `seller.id`.
2. Busca o pedido com o token da conta única.
3. Grava em `ml_orders` global.
4. Dispara push para **todos** os dispositivos (`sendSalePushToAll`).

Num SaaS, sem resolver o tenant a partir do payload, o pedido de um cliente
seria gravado no espaço de outro e **notificado ao dono errado** — vazamento
de dado comercial entre clientes.

O ML envia `user_id` no corpo da notificação. Esse campo precisa virar a chave
de resolução do tenant, e o handler deve **rejeitar** o que não resolver.

### Outras rotas com a mesma suposição

Todas as 37 rotas de `ml/*` resolvem credencial via `getMlAccessToken()` /
`getValidMlAccessToken()`, sem parâmetro de tenant.

---

## 8. Relação com `controleml-saas` — **resolvido, e muda o plano**

Não ficou pendente: **este repositório já tem o remote configurado**, e os
objetos estão disponíveis localmente.

```
origin       https://github.com/caua-lima/zxp-market.git
saas-origin  https://github.com/caua-lima/controleml-saas.git
```

### O que é

`controleml-saas` **não** é versão antiga, nem backend separado, nem
duplicata. É o **mesmo projeto**, com ancestral comum confirmado:

- **Ancestral:** `6a672ab` — *"fix(ui): renomeia 'Envio Full' para 'Frete'…"*, **16/07/2026**
- **`main` (aqui):** 252 commits à frente · último em **17/08/2026**
- **`saas-origin/main`:** 8 commits à frente · último em **19/07/2026**

### Os 8 commits que só existem lá

```
762bfc9  feat(saas): aba de Sugestoes + primeiros passos + meta diaria dinamica
0e9cfc8  feat(metas): meta diaria dinamica - redistribui o que falta pelos dias restantes
aaa2e4a  feat(saas): fase 4 - licenca com prazo + painel do admin master
aa905d3  feat(saas): fase 3b - rotas de dados por tenant (multi-tenancy completa)
95bf6cb  feat(saas): fase 3a - conexao do Mercado Livre por usuario (multi-tenant)
5237c23  feat(saas): fase 2 - dados do cliente escopados em users/{uid} + regras multi-tenant
6ca4bdb  feat(saas): remove a aba Financeiro e o Mercado Pago do produto SaaS
bea550e  docs(saas): arquitetura e roadmap do SaaS (branch isolado, sem tocar na main)
```

**49 arquivos, +1.530/−1.278 linhas.** Inclui `lib/ml/tenant.ts` (198 linhas),
`firestore.rules` reescrito (124 linhas alteradas), `docs/SAAS.md` (122
linhas de arquitetura e modelo de negócio já definidos).

O `lib/ml/tenant.ts` de lá resolve exatamente os problemas das seções 3, 4 e 7
deste relatório:

```ts
const CONEXOES = "ml_conexoes";          // ml_conexoes/{uid} — substitui ml_tokens/main
const OAUTH_STATES = "ml_oauth_states";
export function tenantCol(uid: string, nome: string) {
  return getAdminDb().collection("users").doc(uid).collection(nome);
}
```

Com um cuidado de segurança que vale registrar: as coleções de conexão são
**server-only por ausência de regra** — sem `match` no `firestore.rules`, o
Firestore nega tudo que vem do cliente, e só o Admin SDK enxerga. É onde mora
o `refresh_token`.

### Branches relacionados

| Branch | HEAD | Data | Relação |
|---|---|---|---|
| `origin/saas` | `8a3eadb` | 04/08/2026 | **1 commit à frente** de `saas-origin/main`. É a versão SaaS **mais avançada**. |
| `saas-origin/main` | `762bfc9` | 19/07/2026 | Espelho publicado do branch `saas`. |
| `origin/v2` | `d4478aa` | 15/05/2026 | 383 atrás / 1 à frente. **Abandonado.** |

**Conclusão:** `controleml-saas` é o *repositório de publicação* do branch
`saas`. O trabalho de verdade está em `origin/saas`, aqui mesmo.

### 🔴 A decisão que isso força

O plano implícito no pedido desta auditoria — *"transformar este repo em
multi-tenant"* — **refaria trabalho que já existe**. Os caminhos reais são:

**A. Trazer os 8 commits de SaaS para a `main`** — *recomendado*
Portar `lib/ml/tenant.ts`, as rules multi-tenant e o painel de licença para
cá. Conflito concentrado em `firestore.rules`, `lib/firebase/data.ts`,
`lib/ml/*` e `app/api/ml/*` — que é exatamente onde os 252 commits também
mexeram. Trabalhoso, mas é a direção com menos volume.

**B. Trazer os 252 commits de produto para o `saas`**
Rebase/merge de um mês inteiro de Ads, Full, notificações, estoque e correções
sobre uma base de 16/07. Muito mais volume, muito mais conflito.

**C. Recomeçar a multi-tenancy aqui, ignorando o `saas`**
Descarta `lib/ml/tenant.ts`, as rules e o `docs/SAAS.md` já escritos. Só faz
sentido se aquela implementação for considerada errada — o que esta auditoria
**não** encontrou motivo para supor.

**Recomendação: A.** 8 commits contra 252. Mas a decisão é de negócio, não
técnica, e depende de duas coisas que só você sabe:

> **Perguntas que preciso que você responda antes de qualquer código:**
>
> 1. O branch `saas` / `controleml-saas` chegou a rodar em produção com
>    cliente real, ou parou em 04/08 antes disso?
> 2. O Firebase e o projeto Vercel separados que o `docs/SAAS.md` prevê
>    (§2, "Status do isolamento" — todos os itens ainda `[ ]`) chegaram a ser
>    criados?
> 3. O `docs/SAAS.md` de lá ainda reflete o modelo de negócio que você quer
>    (venda por call, R$30-45/mês, liberação manual com prazo), ou mudou?

---

## 9. Checagens de sanidade

Executadas em `main @ 087722d`, working tree limpa (exceto
`.claude/launch.json`, arquivo local não versionado nesta mudança).

| Checagem | Comando | Resultado |
|---|---|---|
| Tipos | `npx tsc --noEmit` | ✅ **Limpo**, zero erros |
| Testes | `npx vitest run` | ✅ **189/189** em 20 arquivos |
| Build | `npx next build` | ✅ **Sucesso**, 37 rotas compiladas |
| Lint | `npx eslint` | ⚠️ **32 erros, 6 avisos** |

### Detalhe do lint (linha de base pré-existente, não regressão)

| Regra | Ocorrências | Observação |
|---|---|---|
| `react-hooks/set-state-in-effect` | 15 | Padrão de hidratação (ler `localStorage` no efeito). Intencional e documentado no código. |
| `@typescript-eslint/no-explicit-any` | 9 | Concentrado em payloads do ML sem tipo. |
| `@typescript-eslint/no-unused-vars` | 6 | Limpeza. |
| `@typescript-eslint/no-require-imports` | 6 | Só em `scripts/seed-*.js` (scripts locais, fora do build). |
| `prefer-const` / `react-hooks/purity` | 2 | Menores. |

**Conclusão:** o projeto **compila, tipa e passa nos testes**. A auditoria
parte de um estado saudável. O lint tem uma linha de base histórica de 38
problemas que não impede build nem deploy.

---

## 10. Achado extra — divergência de estoque no Full

Não estava no escopo pedido, mas foi encontrado durante a leitura do código e
é **um bug real, hoje, em produção** — registrado aqui em vez de corrigido,
porque esta fase é só de auditoria.

**Sintoma:** a aba Full mostra *"Disponível no Full: 1248 un"* enquanto o card
do Estoque mostra *"667 no Full"*. Mesmo rótulo, números diferentes.

**Duas causas somadas:**

1. **`gestao-full` não deduplica pool compartilhado.** O commit `adacd6d`
   corrigiu isso em `EstoqueTab` (via `consolidarEstoqueAnuncios`, que conta
   cada `inventory_id` uma vez), mas `gestao-full` ficou de fora:

   ```ts
   // app/api/ml/gestao-full/route.ts:466
   const totalDisponivel = itens.reduce((s, it) => s + it.available, 0);
   ```

   `itens` tem uma entrada por par (MLB, inventory_id) — dois anúncios no
   mesmo pool entram duas vezes, cada um com o pool inteiro. **É exatamente o
   bug já corrigido do outro lado.**

2. **Escopos diferentes, mesmo rótulo.** `gestao-full` busca **todos** os
   anúncios da conta (`/users/{SELLER_ID}/items/search`, linha 89, com
   comentário explicando que usar só os cadastrados "escondia unidades"),
   enquanto `estoque-ml` busca **apenas** os MLBs cadastrados na coleção
   `estoque`. Produto anunciado e não cadastrado conta num e não no outro.

**Por que importa para o SaaS:** a causa 1 é bug e se corrige. A causa 2 é
mais interessante — significa que hoje existem **duas definições concorrentes
de "estoque no Full"** no mesmo produto. Antes de multiplicar isso por N
tenants, vale escolher uma definição única e nomear as duas visões de forma
distinta na tela.

---

## Resumo executivo

**O estado técnico é bom.** Compila, tipa, 189 testes passando, `lib/domain`
puro e bem separado — a base para multi-tenancy é sólida e o refactor não
precisa tocar a lógica de cálculo.

**Os três bloqueios reais para multi-tenant**, em ordem de gravidade:

1. 🔴 **Webhook não identifica o seller** (`webhook/route.ts:150`) — vazaria
   pedido e notificação entre clientes.
2. 🔴 **Fallback hardcoded `|| "2420261535"`** em 6 arquivos — falha silenciosa
   servindo dados do dono.
3. 🔴 **`firestore.rules` sem noção de tenant** — dois clientes leriam os dados
   um do outro.

**Mas o achado que muda o plano é a Seção 8:** tudo isso já foi resolvido no
branch `saas` deste repositório, em 8 commits, com `lib/ml/tenant.ts` pronto e
arquitetura documentada. A pergunta deixou de ser *"como construir"* e passou
a ser *"como reunir os 252 commits de produto com os 8 de multi-tenancy"*.

Recomendo decidir isso — respondendo as três perguntas da Seção 8 — antes de
escrever qualquer linha de código.
