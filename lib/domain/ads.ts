// ── Ads: cálculo de lucro por anúncio (Fase 3) ───────────────────
// Puro de propósito — a busca real (ML + Firestore) fica em
// app/api/ml/ads/route.ts; este arquivo só interpreta o que já foi buscado.
// A metade de baixo (vendasPorItem/buildAdItem/sortAdItems/reconciliarConta)
// foi extraída do route.ts (auditoria Fase 3) pra poder testar a matemática
// (lucro com/sem ads, reconciliação com o dashboard) sem precisar de token ML
// nem Firestore. calculateBreakEvenRoas/getAdRecommendation já existiam antes
// e continuam do mesmo jeito: recebem números já prontos e só rotulam.

/**
 * ROAS mínimo pra não perder dinheiro com o ad, derivado da margem ANTES de
 * ads: se o produto já tem lucroAntesAds > 0 pra um volume de vendas, o
 * break-even é vendas ÷ lucroAntesAds (o ponto em que o custo do ad consome
 * exatamente esse lucro). Só é "matematicamente seguro" quando
 * lucroAntesAds > 0 — se o produto já não cobre o próprio custo antes do
 * ads, não existe ROAS que salve, então retorna null (não um número
 * enganoso como Infinity ou 0).
 */
export function calculateBreakEvenRoas(vendas: number, lucroAntesAds: number): number | null {
  if (vendas <= 0 || lucroAntesAds <= 0) return null;
  return vendas / lucroAntesAds;
}

export type AdRecommendation = {
  acao: "pausar" | "reduzir" | "escalar" | "sem-dados";
  label: string;
  tone: "critical" | "warning" | "opportunity" | "info";
};

/**
 * Volume mínimo pra confiar na recomendação — abaixo disso, 1 ou 2 vendas ao
 * acaso (ou nenhuma) fariam ROAS/margem oscilar demais pra virar conselho.
 */
const CLIQUES_MIN = 20;
const INVESTIMENTO_RELEVANTE = 20; // R$ — abaixo disso, "pausar" seria alarme por centavos

export function getAdRecommendation(input: {
  clicks: number;
  vendas: number;
  cost: number;
  lucro: number | null; // null = sem dado (ex.: "direto" sem diretoDisponivel)
  roas: number;
  roasTarget: number;
  breakEvenRoas: number | null;
  margem: number | null;
  metaMargem: number;
}): AdRecommendation {
  const { clicks, vendas, cost, lucro, roas, roasTarget, breakEvenRoas, margem, metaMargem } = input;

  if (clicks < CLIQUES_MIN && vendas === 0) {
    return { acao: "sem-dados", label: "Sem dados suficientes", tone: "info" };
  }

  if (lucro != null && lucro < 0 && cost >= INVESTIMENTO_RELEVANTE) {
    return { acao: "pausar", label: "Pausar ou revisar", tone: "critical" };
  }

  const abaixoDoAlvo = roasTarget > 0 && roas < roasTarget;
  const abaixoDoBreakEven = breakEvenRoas != null && roas < breakEvenRoas;
  if (cost > 0 && abaixoDoAlvo && abaixoDoBreakEven) {
    return { acao: "reduzir", label: "Reduzir orçamento", tone: "warning" };
  }

  const margemSaudavel = margem != null && margem >= metaMargem;
  const roasSaudavel = (roasTarget > 0 && roas >= roasTarget) || (breakEvenRoas != null && roas >= breakEvenRoas * 1.2);
  if (margemSaudavel && roasSaudavel && cost > 0) {
    return { acao: "escalar", label: "Escalar com cautela", tone: "opportunity" };
  }

  return { acao: "sem-dados", label: "Sem dados suficientes", tone: "info" };
}

export type OrderItem = { sku?: string; item_id?: string; quantity?: number; unit_price?: number; sale_fee?: number };

/** Formato mínimo de pedido que a lógica de vendas precisa — não depende do tipo do firebase-admin, só dos campos que de fato lê. */
export type RawOrder = { order_id?: string; status?: unknown; items?: OrderItem[]; shipping_cost?: number };

export type ProdutoData = { custo: number; imposto: number };
export type VendaItem = { receita: number; unidades: number; cmv: number; imposto: number; taxaML: number; envio: number };

export const normSku = (s: string): string => s.trim().toLowerCase();
export const normId = (s: string): string => s.trim().toUpperCase().replace(/^MLB/, "");

export function isNaoVenda(s: unknown): boolean {
  const v = String(s ?? "").toLowerCase();
  return v === "cancelled" || v === "invalid";
}

/**
 * Vendas + lucro (antes de ads) por item MLB, a partir dos MESMOS pedidos que o
 * dashboard usa. Exclui cancelados e devolvidos, igual ao lucro do dashboard —
 * assim "vendas totais" e "lucro" desta aba batem com a tela principal.
 */
export function vendasPorItem(
  orders: RawOrder[],
  porMlb: Map<string, ProdutoData>, porSku: Map<string, ProdutoData>,
  cancelIds: Set<string>, devolIds: Set<string>,
): Map<string, VendaItem> {
  const map = new Map<string, VendaItem>();
  for (const o of orders) {
    const oid = String(o.order_id ?? "");
    if (isNaoVenda(o.status) || cancelIds.has(oid) || devolIds.has(oid)) continue;
    const items = o.items ?? [];
    const totalUnits = items.reduce((s, it) => s + Number(it.quantity ?? 1), 0);
    const envioPerUnit = totalUnits > 0 ? Number(o.shipping_cost ?? 0) / totalUnits : 0;
    for (const it of items) {
      const id = String(it.item_id ?? "").trim().toUpperCase();
      if (!id) continue;
      const qty = Number(it.quantity ?? 1);
      const receita = Number(it.unit_price ?? 0) * qty;
      const prod = porMlb.get(normId(id)) ?? porSku.get(normSku(String(it.sku ?? "")));
      const cur = map.get(id) ?? { receita: 0, unidades: 0, cmv: 0, imposto: 0, taxaML: 0, envio: 0 };
      cur.receita += receita;
      cur.unidades += qty;
      cur.taxaML += Number(it.sale_fee ?? 0) * qty;
      cur.envio += envioPerUnit * qty;
      cur.cmv += (prod?.custo ?? 0) * qty;
      cur.imposto += receita * ((prod?.imposto ?? 0) / 100);
      map.set(id, cur);
    }
  }
  return map;
}

export type AdStatusLabel = "ativo" | "pausado" | "sem_campanha" | "config_indisponivel";

/**
 * Etiqueta é sobre a CAMPANHA (o que o vendedor pediu), não o anúncio no
 * catálogo — uma campanha pausada não gasta nem gira, mesmo com o anúncio
 * "active" no catálogo. Sem campaignId resolvido = "sem_campanha" (não é erro,
 * é um anúncio que nunca foi posto em nenhuma campanha, ou a campanha não foi
 * encontrada na busca).
 */
export function statusLabel(campaignId: string, campaignStatus: string): AdStatusLabel {
  if (!campaignId) return "sem_campanha";
  const s = campaignStatus.toLowerCase();
  if (s === "active") return "ativo";
  if (s === "paused") return "pausado";
  return "config_indisponivel";
}

export type AdMetric = {
  itemId: string; title: string;
  clicks: number; prints: number; cost: number;
  directSales: number; directUnits: number;
  sales: number; units: number;
};

export type AdCampaignConfig = {
  campaignId?: string; campaignName?: string; status?: string;
  dailyBudget?: number; roasTarget?: number; acosTarget?: number;
};

export type AdItemResult = {
  itemId: string; title: string;
  status: AdStatusLabel;
  campaignId: string; campaignName: string; mlStatus: string;
  clicks: number; prints: number; cost: number;
  directSales: number; directUnits: number;
  adSales: number; adUnits: number;
  totalSales: number; totalUnits: number;
  lucroAntesAds: number; lucroLiquido: number;
  lucroDiretoAntesAds: number; lucroDiretoLiquido: number; diretoDisponivel: boolean;
  dailyBudget: number; roasTarget: number; acosTarget: number;
};

/**
 * Junta métrica de ads + venda vinculada + config de campanha num item de
 * resultado. O ponto delicado é `lucroDiretoLiquido`: quando o item não tem
 * NENHUMA venda vinculada no período (produto não mapeado no Estoque, ou o ML
 * atribuiu a venda direta a outro dia), a margem não dá pra calcular — em vez
 * de assumir margem 0 (o que faria "−100% do custo do ad" aparecer como
 * prejuízo real), `diretoDisponivel: false` avisa que o número é indisponível,
 * não negativo.
 */
export function buildAdItem(a: AdMetric, v: VendaItem, c: AdCampaignConfig | undefined, mlStatus: string): AdItemResult {
  const lucroAntesAds = v.receita - v.cmv - v.imposto - v.taxaML - v.envio;
  const lucroLiquido = lucroAntesAds - a.cost; // GERAL: todas as vendas − ads

  const diretoDisponivel = v.receita > 0;
  const margemItem = diretoDisponivel ? lucroAntesAds / v.receita : 0;
  const lucroDiretoAntesAds = a.directSales * margemItem;
  const lucroDiretoLiquido = diretoDisponivel ? lucroDiretoAntesAds - a.cost : 0;

  return {
    itemId: a.itemId, title: a.title,
    status: statusLabel(c?.campaignId ?? "", c?.status ?? ""),
    campaignId: c?.campaignId ?? "", campaignName: c?.campaignName ?? "", mlStatus,
    clicks: a.clicks, prints: a.prints, cost: a.cost,
    directSales: a.directSales, directUnits: a.directUnits,
    adSales: a.sales, adUnits: a.units,
    totalSales: v.receita, totalUnits: v.unidades,
    lucroAntesAds, lucroLiquido,
    lucroDiretoAntesAds, lucroDiretoLiquido, diretoDisponivel,
    dailyBudget: c?.dailyBudget ?? 0,
    roasTarget: c?.roasTarget ?? 0,
    acosTarget: c?.acosTarget ?? 0,
  };
}

/** Sem campanha vai pro fim da lista (não importa o investimento — é ruído pra quem quer ver o que está rodando primeiro); dentro de cada grupo, maior custo primeiro. */
export function sortAdItems<T extends { status: AdStatusLabel; cost: number }>(items: T[]): T[] {
  return [...items].sort((x, y) => {
    const semA = x.status === "sem_campanha" ? 1 : 0;
    const semB = y.status === "sem_campanha" ? 1 : 0;
    if (semA !== semB) return semA - semB;
    return y.cost - x.cost;
  });
}

export type ContaReconciliation = { receita: number; unidades: number; lucroAntesAds: number; itens: number };

/**
 * Totais da conta INTEIRA no período (todos os itens vendidos, anunciados ou
 * não) — existe pra responder "quanto do faturamento os itens anunciados
 * representam?" em vez de deixar o vendedor achar que a soma da tabela de Ads
 * (só itens anunciados) e o faturamento do dashboard (conta toda) são o mesmo
 * número e um dos dois está "quebrado". Ver docs/ADS_RECONCILIATION.md.
 */
export function reconciliarConta(vendas: Map<string, VendaItem>): ContaReconciliation {
  let receita = 0, unidades = 0, lucroAntesAds = 0;
  for (const v of vendas.values()) {
    receita += v.receita;
    unidades += v.unidades;
    lucroAntesAds += v.receita - v.cmv - v.imposto - v.taxaML - v.envio;
  }
  return { receita, unidades, lucroAntesAds, itens: vendas.size };
}
