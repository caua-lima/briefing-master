import "server-only";
import { impostoNaData, type ImpostoFaixa } from "@/lib/domain/types";
import type { SaleFinanceInput } from "@/lib/domain/notifications";

export type OrderFinanceItem = {
  sku?: string;
  item_id?: string;
  quantity?: number;
  unit_price?: number;
  sale_fee?: number;
  title?: string;
};

export type ProdutoCusto = { custo: number; imposto?: string | number; impostoFaixas?: ImpostoFaixa[] };

export type OrderFinanceEstimate = SaleFinanceInput & {
  productName: string;
  itemCount: number;
  quantityTotal: number;
};

const normSku = (s: string) => s.trim().toLowerCase();
const normId = (s: string) => s.trim().toUpperCase().replace(/^MLB/, "");

/**
 * Estimativa de lucro/margem de UM pedido, no momento em que ele chega —
 * mesma lógica de custo/imposto/taxa que o resto do app usa (ver
 * vendasPorItem em app/api/ml/ads/route.ts), só que pra um pedido isolado em
 * vez de agregar um período inteiro.
 *
 * `financialState` é sempre "estimated" quando dá pra calcular: mesmo com
 * TODOS os produtos vinculados, o valor pode mudar depois — frete definitivo,
 * taxas ajustadas, repasse do Mercado Pago confirmado. Nunca "confirmed"
 * aqui, de propósito (só a sincronização completa fecha esse número).
 *
 * Se QUALQUER item do pedido não tiver produto vinculado (sem custo pra
 * calcular), o pedido inteiro vira "unavailable" — misturar item com custo
 * conhecido e item sem custo daria uma margem inventada, pior que não
 * mostrar nada. Frete ausente (ainda não sincronizado) NÃO derruba pra
 * "unavailable": o resto do app já tolera frete=0 até a sincronização
 * completar, então aqui segue a mesma regra.
 */
export function estimateOrderFinance(
  items: OrderFinanceItem[],
  porMlb: Map<string, ProdutoCusto>,
  porSku: Map<string, ProdutoCusto>,
  shippingCost: number | null,
  dataVendaISO: string,
  metaMargem: number | null,
): OrderFinanceEstimate {
  let grossAmount = 0;
  let cmv = 0;
  let taxaML = 0;
  let imposto = 0;
  let quantityTotal = 0;
  let algumSemProduto = false;

  for (const it of items) {
    const qty = Number(it.quantity ?? 1);
    const receita = Number(it.unit_price ?? 0) * qty;
    grossAmount += receita;
    taxaML += Number(it.sale_fee ?? 0) * qty;
    quantityTotal += qty;

    const id = String(it.item_id ?? "").trim().toUpperCase();
    const prod = (id && porMlb.get(normId(id))) || porSku.get(normSku(String(it.sku ?? "")));
    if (!prod) { algumSemProduto = true; continue; }
    cmv += prod.custo * qty;
    imposto += receita * (impostoNaData(prod, dataVendaISO.slice(0, 10)) / 100);
  }

  const productName = items[0]?.title || "Produto";
  const itemCount = items.length;

  if (algumSemProduto || items.length === 0) {
    return {
      grossAmount, estimatedProfit: null, estimatedMargin: null, metaMargem,
      productName, itemCount, quantityTotal,
    };
  }

  const frete = shippingCost ?? 0;
  const estimatedProfit = grossAmount - cmv - taxaML - imposto - frete;
  const estimatedMargin = grossAmount > 0 ? (estimatedProfit / grossAmount) * 100 : 0;

  return {
    grossAmount, estimatedProfit, estimatedMargin, metaMargem,
    productName, itemCount, quantityTotal,
  };
}
