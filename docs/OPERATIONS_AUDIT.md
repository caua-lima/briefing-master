# Auditoria Operacional — ZXP Solutions / VAZXPRESS

**Escopo:** Fase 0 do plano de auditoria técnica (branch `main`, produção real, single-tenant).
**Método:** leitura de código e histórico de commits, execução de `npm run lint`/`npx tsc --noEmit`, contagem de linhas. **Nada aqui foi validado contra a conta real do Mercado Livre/Firebase** — este ambiente não tem credenciais de produção. Achados marcados "não verificado" precisam de confirmação manual pós-deploy.
**Data:** 2026-08-10. **Janela analisada:** commits dos últimos 14 dias (`3b10c6b`..`d49eac8`, 125 commits).

Nenhum segredo, token ou dado de cliente real aparece neste documento.

---

## Resumo executivo

O projeto passou por um ciclo de desenvolvimento muito intenso nos últimos 14 dias (125 commits: identidade visual nova, Dashboard reformulado, Ads/Estoque/Pedidos/Metas/Custos/DRE recriados, trilha de auditoria, permissão granular, sistema de notificações completo do zero, correções de bugs financeiros reais). O código está consistentemente bem comentado e as correções de bugs anteriores mostram boa disciplina (tsc/build/lint a cada commit). O maior risco hoje **não é bug ativo conhecido** — é a **falta total de rede de segurança**: zero testes automatizados, `firestore.rules` alterado nos últimos commits sem confirmação de deploy, e nenhum mecanismo de observabilidade (não dá pra saber, olhando o sistema, se o cron rodou hoje ou se o Ads está retornando dado incompleto).

| Prioridade | Achado |
|---|---|
| 🔴 Bloqueador | `firestore.rules` alterado nos commits mais recentes, sem evidência de deploy |
| 🔴 Alto | Zero testes automatizados no projeto inteiro |
| 🟡 Médio | Zero observabilidade de sincronização (cron, Ads, webhook) — nada é persistido |
| 🟡 Médio | `no-explicit-any` concentrado em rotas de auth/token do ML |
| 🟢 Baixo | 2 arquivos grandes (EstoqueTab 1623 linhas, Dashboard 1476 linhas) |
| 🟢 Baixo | Lint: 40 problemas, maioria falso-positivo já documentado no código |

---

## Achados

### Atualização (Fase 2 concluída)

A Fase 2 (rules e autorização) auditou os 9 pontos exigidos contra o código real. 7 já estavam corretos; 2 tinham lacuna real, corrigidas nesta mesma fase:

- **Lacuna real:** `notification_events` permitia que qualquer autorizado marcasse `readBy`/`dismissedBy` em nome de **qualquer e-mail**, não só o próprio — um colaborador podia, por exemplo, forjar que o owner já leu um aviso. Corrigido com `isSelfReadOrDismissUpdate()`, que valida a chave específica dentro do mapa, não só o campo inteiro.
- **Endurecimento (defesa em profundidade):** `ml_tokens`, `ml_orders`, `ml_returns` nunca tiveram `match` no `firestore.rules` — já eram bloqueadas pelo default-deny do Firestore (confirmado: nenhum código client-side as referencia, só Admin SDK server-side, que ignora regras). Adicionado `allow read, write: if false` explícito pra essas três, deixando a intenção clara em vez de depender de omissão.

Isso **piora temporariamente** o achado A1 abaixo: agora há ainda mais mudança em `firestore.rules` esperando deploy. Ver `docs/FIRESTORE_RULES_DEPLOY.md` pro passo a passo e os cenários de teste owner/colaborador.

---

### A1 — `firestore.rules` modificado sem confirmação de deploy

- **Severidade:** 🔴 Bloqueador de produção
- **Impacto:** Segurança/autorização. Se as regras publicadas no Firebase ainda forem uma versão anterior, features recém-commitadas ficam **inoperantes ou inseguras** em produção:
  - Permissão granular por aba (`podeEditar()`) — se a regra antiga (`isOwner()` puro) ainda estiver no ar, colaborador continua sem poder editar Custos/Metas/Estoque mesmo depois de liberado na tela de Acesso (UI mostra o botão, o Firestore rejeita — pior experiência que não ter a feature).
  - Trilha de auditoria (`notification_events`, `auditLog`) e Meu Perfil (`isSelfNameUpdate`) podem falhar silenciosamente (as chamadas já têm `.catch(() => {})` de propósito, então o app não quebra, mas o dado simplesmente não é gravado).
- **Arquivo:** `firestore.rules`
- **Evidência:**
  ```
  $ git log -1 --format=%ad --date=iso -- firestore.rules
  2026-08-10 14:55:27 -0300

  $ git log --oneline -5 -- firestore.rules
  7fd3651 feat(perfil): aba de Meu Perfil pra editar nome e foto
  d4ce77f feat(notificacoes): persistencia idempotente, anti-spam e envio preference-aware
  3140aa6 feat(acesso): infraestrutura de permissao granular por aba
  ed5c683 feat(auditoria): infraestrutura da trilha de auditoria (append-only)
  222df7c feat(dashboard): adiciona Central de Atencao (ActionCenter) com alertas priorizados
  ```
  Não existe pipeline de CI/CD (`.github/` vazio) nem qualquer registro no repositório de quando as regras foram publicadas pela última vez — o deploy é 100% manual (`npx firebase-tools deploy --only firestore:rules`), como já documentado no README.
- **Correção proposta:** nenhuma mudança de código — é uma ação operacional. Ver `docs/FIRESTORE_RULES_DEPLOY.md` (Fase 2) para o passo a passo.
- **Como validar:** depois do deploy, testar como colaborador: liberar uma aba em Acesso → permissão, editar algo nela, confirmar que salva. Testar como cliente que **não** deveria: tentar (via console do navegador) escrever em `notification_events` diretamente — deve ser rejeitado.
- **Rollback:** `firebase deploy --only firestore:rules` com uma versão anterior do arquivo (`git show <commit-anterior>:firestore.rules > firestore.rules` e reaplicar), ou reverter pelo histórico de versões do Firestore Rules no Console (Firebase mantém as últimas publicações).

### A2 — Zero testes automatizados

- **Severidade:** 🔴 Alto
- **Impacto:** Confiabilidade geral. Toda a lógica financeira crítica (CMV, margem, classificação de venda, dedupe de Ads, cálculo de estoque) hoje só é validada por `tsc`/`build`/`lint` (que provam que o código *compila*, não que o *resultado está certo*) e por revisão manual antes de cada commit. Uma regressão silenciosa em fórmula (ex.: trocar `+` por `-` no cálculo de margem) passaria por tsc/build/lint sem ser pega.
- **Arquivo:** projeto inteiro — `package.json` não tem `jest`, `vitest`, `@testing-library/*` nem `playwright` em nenhuma dependência; não existe nenhum arquivo `*.test.*`/`*.spec.*` nem pasta `__tests__`.
- **Evidência:**
  ```
  $ grep -iE "jest|vitest|testing-library|playwright" package.json
  (nenhum resultado)
  $ find . -iname "*.test.*" -o -iname "*.spec.*"
  (nenhum resultado)
  ```
- **Correção proposta:** Fase 9 do plano — instalar Vitest (mais leve que Jest pra projeto Next/Turbopack), criar `test`/`test:unit`/`test:critical`/`verify` em `package.json`, começar pelos módulos financeiros puros (`lib/domain/calc.ts`, `lib/ml/order-finance.ts`, `lib/domain/notifications.ts` — já são funções puras, fáceis de testar sem mock de Firebase).
- **Como validar:** `npm run test:critical` deve rodar e passar antes de qualquer deploy.
- **Rollback:** N/A (é adição, não muda comportamento existente).

### A3 — Zero observabilidade de sincronização (cron, Ads, webhook)

- **Severidade:** 🟡 Médio
- **Impacto:** Não é possível responder hoje, olhando o sistema (só o código-fonte), "o cron rodou nas últimas 24h?", "quando foi a última coleta de Ads?", "o webhook do ML está recebendo eventos?". Isso é exatamente o que a Fase 1 (Saúde da operação) pede — hoje não dá pra construir aquela tela porque **o dado não é persistido em lugar nenhum**.
- **Arquivo:** `app/api/ml/cron/route.ts`, `app/api/ml/ads/route.ts`, `app/api/ml/webhook/route.ts`
- **Evidência:** `cron/route.ts` calcula `savedOrders`/`savedReturns` e devolve no `NextResponse.json(...)` — nunca escreve isso em nenhuma coleção do Firestore. Não existe coleção `syncRuns`/`cronHistory`/equivalente no projeto (confirmado por busca em todo `lib/firebase/data.ts` e nas rotas).
- **Correção proposta:** Fase 4 — criar o tipo `DataFreshness` pedido na missão, persistir um documento por execução (cron, cada sync manual, cada coleta de Ads) numa coleção nova (ex.: `sync_runs`), e consumir isso na tela de Saúde da operação (Fase 1).
- **Como validar:** depois de implementado, rodar o cron manualmente (ou esperar o agendado) e conferir que um novo documento aparece com status/timestamp corretos.
- **Rollback:** reverter o commit que adiciona a escrita — não afeta o sync em si (é só um `set()` a mais).

### A4 — Sincronização sem lock contra execução concorrente (risco mitigado, não eliminado)

- **Severidade:** 🟡 Médio (rebaixado de Alto porque o dado em si é protegido)
- **Impacto:** A missão pede lock idempotente com expiração. Hoje não existe. Na prática, o risco de duplicação de DADO é baixo porque `syncOrdersRange`/`syncReturnsRange` gravam por `doc(order_id)` com `merge: true` (upsert, não `add()`) — duas execuções simultâneas convergem pro mesmo estado final, não duplicam pedido. O risco real que sobra é **desperdício de cota de API do ML** (duas chamadas simultâneas ao mesmo endpoint) e, em teoria, uma leve janela de corrida em `terminalShipmentIds`/custo médio se dois recomputes rodarem ao mesmo tempo pro mesmo produto.
- **Arquivo:** `lib/ml/sync.ts` (`syncOrdersRange`, `syncReturnsRange`), `app/api/ml/cron/route.ts`
- **Evidência:** `syncReturnsRange` (lib/ml/sync.ts:328-353) usa `batch.set(db.collection("ml_returns").doc(id), {...}, { merge: true })` — idempotente por construção. Não há nenhum `lock`/`mutex`/documento de "sync em andamento" em lugar nenhum do código.
- **Correção proposta:** Fase 4 — lock idempotente com expiração (documento `sync_locks/{source}` com timestamp + TTL curto), verificado no início de cada rota de sync manual e no cron.
- **Como validar:** disparar duas sincronizações manuais quase simultâneas (dois cliques rápidos) e confirmar que a segunda é rejeitada/enfileirada, não executa em paralelo.
- **Rollback:** reverter o commit do lock — sync volta a rodar sem trava (comportamento atual).

### A5 — `no-explicit-any` concentrado em rotas de autenticação/token do ML

- **Severidade:** 🟡 Médio
- **Impacto:** `any` desliga a checagem de tipo exatamente nos arquivos que decidem token OAuth, callback de login e desconexão de conta — a categoria de código onde um erro de tipo tem mais chance de virar bug de segurança silencioso (ex.: acessar `.access_token` de um objeto que na real é `undefined` sem o TypeScript avisar).
- **Arquivo:** `app/api/ml/callback/route.ts` (2×), `app/api/ml/disconnect/route.ts`, `app/api/ml/force-logout/route.ts`, `app/api/ml/orders/route.ts`, `app/api/ml/returns/route.ts` (3×), `app/api/ml/token.ts` — 9 ocorrências no total.
- **Evidência:** `npm run lint` → `@typescript-eslint/no-explicit-any`, 9 ocorrências, todas em `app/api/ml/*`. Exemplo concreto (`force-logout/route.ts:35`): `catch (error: any) { ... error?.message ... }` — o padrão do resto do projeto (`api-auth.ts`, `push-send.ts`, todas as rotas mais novas) já usa `catch (err: unknown) { const msg = err instanceof Error ? err.message : String(err); }`, então existe um padrão correto estabelecido, só não foi aplicado retroativamente nesses arquivos mais antigos.
- **Correção proposta:** Fase 9 — trocar cada `any` pelo padrão `unknown` + narrowing já usado no resto do projeto. Baixo risco, mudança mecânica.
- **Como validar:** `npx tsc --noEmit` continua limpo, `npm run lint` cai de 40 pra 31 problemas.
- **Rollback:** trivial, é troca de tipo sem mudar lógica.

### A6 — `catch (error: any)` sem `unknown` em `force-logout` (nota de segurança, achado positivo)

- **Severidade:** ℹ️ Informativo (não é bug)
- **Nota:** verificado que `force-logout/route.ts` **já é** protegido por `requireAccess(req, { adminOnly: true })` — só owner pode disparar. O `any` ali (ver A5) é problema de tipo, não de autorização. Registrado aqui pra deixar claro que a rota foi auditada e está correta no que importa (quem pode chamar).

### A7 — Lint: inventário completo (40 problemas)

- **Severidade:** 🟢 Baixo (nenhum é bug funcional confirmado)
- **Arquivo:** projeto inteiro
- **Evidência (contagem por regra):**

  | Regra | Qtd | Categoria |
  |---|---|---|
  | `react-hooks/set-state-in-effect` | 16 | Falso positivo **documentado no próprio código**, ver abaixo |
  | `@typescript-eslint/no-explicit-any` | 9 | Bug real corrigível — ver A5 |
  | `@typescript-eslint/no-unused-vars` | 7 | Maioria `catch (e)` com variável não usada (inofensivo); 1 real (`unTot` em AdsTab.tsx:244) |
  | `@typescript-eslint/no-require-imports` | 6 | Regra desatualizada pro contexto — ver abaixo |
  | `react-hooks/purity` | 1 | Falso positivo documentado (`Date.now()` em handler de evento, não em render) |
  | `prefer-const` | 1 | Trivial — `EstoqueTab.tsx:971`, variável `vivo` nunca reatribuída |

  **`set-state-in-effect` (16 ocorrências)** — todas seguem o mesmo padrão: sincronizar estado local com `localStorage` no mount (evita mismatch de hidratação SSR) ou sincronizar um prop de deep-link (`openOrderId`/`openTaskId`) assim que a lista carrega. Cada ocorrência tem um comentário no código explicando por que é intencional. **Não foram verificadas uma a uma nesta auditoria** — a alegação de "falso positivo" vem do commit original de cada uma, não de um teste automatizado que prove ausência de loop de render. Fica como item de baixo risco pra Fase 9 confirmar com teste, não só reafirmar o comentário.

  **`no-require-imports` (6 ocorrências)** — todas em `scripts/seed-firestore.js` e `scripts/seed-ml-base.js`, scripts Node standalone (não fazem parte do build do Next). A regra do ESLint pensada pra código TypeScript/ESM está sendo aplicada a scripts CommonJS utilitários — configuração do lint não diferencia escopo. Correção correta é excluir `scripts/**/*.js` da regra (ou converter os 2 scripts pra ESM), não desabilitar a regra globalmente.

- **Correção proposta:** ver por categoria acima. Fase 9 detalha.
- **Como validar:** `npm run lint` depois de cada correção — número deve só diminuir, nunca só "ficar diferente".
- **Rollback:** cada correção é isolada por arquivo, reversível individualmente.

### A8 — Arquivos grandes (candidatos à Fase 10)

- **Severidade:** 🟢 Baixo (risco de manutenção, não de comportamento)
- **Arquivo(s) e evidência (linhas):**

  | Arquivo | Linhas |
  |---|---|
  | `components/tabs/EstoqueTab.tsx` | 1623 |
  | `components/dashboard/Dashboard.tsx` | 1476 |
  | `app/globals.css` | 1021 |
  | `lib/ml/ads.ts` | 849 |
  | `components/tabs/PedidosTab.tsx` | 824 |
  | `components/tabs/AdsTab.tsx` | 715 |

- **Correção proposta:** Fase 10 — modularização sem mudar comportamento, só depois de haver teste cobrindo o comportamento atual (não fazer ao mesmo tempo que corrige bug, conforme a própria missão pede).
- **Como validar:** depois de extrair, `git diff` do comportamento renderizado deve ser zero (mesmos elementos, mesmas props) — idealmente comparado por teste, não só inspeção visual.
- **Rollback:** reverter o commit de extração — arquivo volta a ser monolítico, comportamento idêntico.

### A9 — Endpoints sem teste automatizado (decorre de A2)

- **Severidade:** 🟡 Médio
- **Impacto:** Todas as ~30 rotas em `app/api/ml/*` e `app/api/push/*`/`app/api/notify/*` dependem só de teste manual. As de maior risco financeiro/segurança pra priorizar quando os testes existirem (Fase 9): `metrics`, `webhook`, `cron`, `estoque-ml`, `gestao-full`, `force-logout`.
- **Arquivo:** `app/api/ml/**`, `app/api/push/**`, `app/api/notify/**`
- **Evidência:** decorre diretamente de A2 (nenhuma infraestrutura de teste existe).
- **Correção proposta:** Fase 9.
- **Como validar:** cobertura crescente, priorizada pelos arquivos "de alto risco" listados na missão.
- **Rollback:** N/A.

---

## Dependências mapeadas (métricas ↔ estoque ↔ Ads ↔ notificações)

Pra evitar que uma correção numa área quebre outra sem perceber:

- **`lib/ml/order-finance.ts`** (estimativa de margem por pedido, usada pelo webhook pra classificar notificação de venda) **depende de** `estoque` (custo médio por SKU/MLB) e `impostoNaData()` (`lib/domain/types.ts`). Se o custo médio mudar de forma (ex.: passar a incluir frete de compra), a classificação de venda (alto valor / margem baixa / prejuízo) muda junto, sem estar explícito em nenhum teste hoje.
- **`app/api/ml/metrics/route.ts`** é a fonte de faturamento/lucro pro Dashboard, DRE, Metas e Custos (todos fazem `fetch` pra essa mesma rota). Uma mudança nela tem raio de impacto amplo — é o arquivo de maior risco financeiro do projeto.
- **`app/api/ml/ads/route.ts`** também lê `estoque` (custo/imposto) pra calcular lucro por anúncio — mesma dependência de `order-finance.ts`, calculada de forma separada (duplicação de conceito entre os dois arquivos, não de bug, mas candidato a unificação futura fora do escopo desta auditoria).
- **Notificações** dependem de `order-finance.ts` (classificação) → `lib/domain/notifications.ts` (texto/severidade) → `lib/notification-events.ts` (persistência idempotente) → `lib/notification-preferences.ts` (filtro por destinatário) → `lib/push-send.ts` (envio). Cadeia comprida, mas cada elo já tem responsabilidade única — boa notícia pra testabilidade futura (cada função é isolada e pura ou quase-pura).
- **`components/tabs/EstoqueTab.tsx`** centraliza a lógica de `casa + Full` (corrigida no commit `d49eac8` desta mesma janela) — é consumida pelo Dashboard (`ProdutosEmRisco`) via `lib/domain/risk.ts`, que usa só `qtdLocal` isolado (não a soma corrigida). Vale confirmar na Fase 6 se essa divergência é intencional (risco de ruptura olha só o galpão) ou se devia usar o total combinado também.

---

## Funcionalidades novas ainda não validadas em produção (14 dias)

Tudo commitado nos últimos 14 dias que envolve fórmula financeira ou segurança e **ainda não tem confirmação de teste em produção** registrada nesta conversa:

- Sistema de notificações inteiro (Fase 7 do trabalho anterior): webhook reescrito, idempotência por `dedupeKey`, agrupamento anti-spam, toast, central, preferências.
- Permissão granular por aba (colaborador editando Custos/Metas/Estoque conforme liberado).
- Trilha de auditoria (`auditLog`).
- Correções de Ads: dedupe de paginação, dedupe entre campanhas, remoção da coluna "Alterado".
- Correção de soma de estoque "casa + anúncio próprio" (`d49eac8`, o commit mais recente).
- Margem por produto no detalhe de pedido.
- "Melhores dias" com janela fixa de 30 dias.

Todas dependem do deploy do `firestore.rules` atual (ver A1) pra funcionar por completo.

---

## Próximos passos sugeridos

1. **Confirmar deploy do `firestore.rules`** (A1) — é bloqueador, deveria ser o primeiro passo antes de qualquer outra fase.
2. Fase 2 (regras/autorização) — já auditadas nesta Fase 0 nos pontos que dependem de código; falta o documento de deploy/teste (`docs/FIRESTORE_RULES_DEPLOY.md`).
3. Fase 9, parte de testes — maior alavancagem de confiabilidade por esforço, porque nada disso existe hoje.
4. Fase 1 (Saúde da operação) — depende de A3/A4 estarem resolvidos primeiro (não dá pra mostrar dado que não é persistido).
