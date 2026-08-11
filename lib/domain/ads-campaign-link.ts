// Vínculo campanha → produto (puro) — usado pelo changelog de Ads e pelo
// drawer de anúncio. Deriva do dado REAL do Mercado Livre (itemId/campaignId
// por anúncio, cruzado com o MLB de cada produto do Estoque), nunca de
// chute ou de registro manual anterior.

export type ItemCampanha = { itemId: string; campaignId: string };
export type ProdutoComMlbs = { id: string; name: string; mlb?: string; mlbs?: string[] };

export function normalizarMlb(s: string): string {
  const up = s.trim().toUpperCase();
  return up.startsWith("MLB") ? up : up ? `MLB${up}` : "";
}

/**
 * Mapa campaignId → produtos vinculados (via MLB). Uma campanha pode cobrir
 * mais de um produto (ex.: kit de anúncios na mesma campanha) — por isso o
 * valor é uma lista, não um único produto; quem consome decide se pré-seleciona
 * o primeiro ou avisa que há mais de um.
 */
export function mapearCampanhasParaProdutos(
  produtos: ProdutoComMlbs[],
  itemCampaigns: ItemCampanha[],
): Map<string, ProdutoComMlbs[]> {
  const mlbParaProduto = new Map<string, ProdutoComMlbs>();
  for (const p of produtos) {
    const mlbs = p.mlbs?.length ? p.mlbs : p.mlb ? [p.mlb] : [];
    for (const m of mlbs) {
      const n = normalizarMlb(m);
      if (n) mlbParaProduto.set(n, p);
    }
  }
  const map = new Map<string, ProdutoComMlbs[]>();
  for (const ic of itemCampaigns) {
    if (!ic.campaignId) continue;
    const prod = mlbParaProduto.get(normalizarMlb(ic.itemId));
    if (!prod) continue;
    const arr = map.get(ic.campaignId) ?? [];
    if (!arr.some((x) => x.id === prod.id)) arr.push(prod);
    map.set(ic.campaignId, arr);
  }
  return map;
}

/** Produto do MLB de um item específico — usado pelo drawer pra achar o produto de um anúncio. */
export function produtoDoMlb(produtos: ProdutoComMlbs[], mlb: string): ProdutoComMlbs | null {
  const alvo = normalizarMlb(mlb);
  if (!alvo) return null;
  for (const p of produtos) {
    const mlbs = p.mlbs?.length ? p.mlbs : p.mlb ? [p.mlb] : [];
    if (mlbs.some((m) => normalizarMlb(m) === alvo)) return p;
  }
  return null;
}
