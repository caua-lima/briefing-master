# Reconciliação da aba Ads com o Dashboard (Fase 3)

## O problema que este documento resolve

A aba Ads mostra "Vendas totais: R$ 9.465" e o Dashboard mostra "Faturamento
do período: R$ 12.040". Os dois números estão certos — eles medem coisas
diferentes — mas sem explicar isso, parece que um dos dois está quebrado.

## Por que os números divergem

| | Dashboard | Aba Ads (modo "Publicidade") |
|---|---|---|
| Escopo | **Toda a conta** — todo pedido válido do período | **Só os itens anunciados** que tiveram gasto de Ads no período |
| Fonte | `lib/ml/orders.ts` (pedidos ao vivo do ML + fallback Firestore) | Os mesmos pedidos, mas agrupados só pros MLBs que aparecem em `getAdsFullByItem` |

Um produto pode vender bem **sem estar anunciado** (busca orgânica, tráfego
direto) — essas vendas entram no faturamento do Dashboard mas nunca aparecem
na tabela de Ads, porque a tabela de Ads só existe pra quem teve *gasto* de
publicidade no período (`ads.filter((a) => a.cost > 0)` em
`app/api/ml/ads/route.ts`).

## Como a reconciliação funciona hoje

`app/api/ml/ads/route.ts` calcula `vendasPorItem(...)` (função pura em
[`lib/domain/ads.ts`](../lib/domain/ads.ts)) usando os **mesmos pedidos, mesma
janela de datas, mesmas exclusões** (cancelado/devolvido) que o restante do
sistema usa pra faturamento. Esse mapa cobre TODOS os itens vendidos no
período, anunciados ou não.

A partir desse mapa completo:
- a tabela da aba Ads usa só as entradas cujo MLB também está em `ads`
  (teve gasto de publicidade);
- `reconciliarConta(vendas)` soma o mapa **inteiro** e devolve
  `{ receita, unidades, lucroAntesAds, itens }` — o total real da conta no
  mesmo período, calculado com a mesma regra de negócio.

O componente (`components/tabs/AdsTab.tsx`) recebe os dois números
(`t.total` = soma só dos itens anunciados; `conta.receita` = total da conta) e
mostra o callout: *"Esta aba cobre só os N item(ns) anunciados: R$ X dos R$ Y
que a conta faturou no período (Z%)"*. Não é uma correção de bug — é deixar
explícito que são dois recortes diferentes do mesmo dado, calculados da mesma
forma.

## Regra inegociável que a reconciliação respeita

`vendasPorItem` (e portanto `reconciliarConta`) usa **exatamente** a mesma
exclusão de cancelamento/devolução que o resto do dashboard usa: pedido
cancelado nunca conta como venda, pedido com devolução completada é excluído.
Isso é o que garante que "quanto do faturamento os anúncios representam" seja
uma pergunta que faz sentido responder — se a aba Ads usasse uma regra de
inclusão diferente do Dashboard, a % mostrada seria enganosa mesmo estando
"certa" isoladamente.

## Funções puras extraídas (Fase 3)

Toda a matemática de lucro por anúncio e de reconciliação foi extraída de
`app/api/ml/ads/route.ts` (que só faz I/O — token ML, Firestore, chamadas
HTTP) para [`lib/domain/ads.ts`](../lib/domain/ads.ts), que não toca rede nem
banco:

- `vendasPorItem` — agrega pedidos em vendas por MLB (exclui não-venda).
- `statusLabel` — rótulo de campanha (ativo/pausado/sem_campanha/config_indisponivel).
- `buildAdItem` — junta métrica de Ads + venda + config de campanha; calcula
  `lucroAntesAds`, `lucroLiquido`, e o lucro "só de venda direta"
  (`lucroDiretoLiquido`), com a regra de `diretoDisponivel: false` quando não
  há venda vinculada (evita mostrar -100% de "prejuízo" que na verdade é
  falta de dado).
- `sortAdItems` — ordenação (sem campanha no fim, maior custo primeiro).
- `reconciliarConta` — a soma completa descrita acima.
- `calculateBreakEvenRoas` / `getAdRecommendation` (já existiam antes da Fase
  3) — ROAS mínimo pra não perder dinheiro, e recomendação de ação por
  anúncio (pausar/reduzir/escalar/sem-dados).

Todas testadas em [`lib/domain/ads.test.ts`](../lib/domain/ads.test.ts) (26
casos) sem precisar de token ML, Firestore ou rede — rodar com:

```bash
npx vitest run lib/domain/ads.test.ts
```

## Como validar manualmente

1. Abrir a aba Ads num período com vendas orgânicas conhecidas (produto que
   vende sem anúncio).
2. Confirmar que o callout "Esta aba cobre só os N item(ns) anunciados..."
   aparece com o total da conta maior que o total da tabela.
3. Comparar `conta.receita` retornado por `/api/ml/ads` com o faturamento do
   mesmo período no Dashboard — devem bater (mesma regra de exclusão).
