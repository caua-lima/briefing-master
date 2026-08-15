import "server-only";
import { getAdsSpendByItem } from "@/lib/ml/ads";

/**
 * "Esta venda veio do anúncio pago?" — o mais perto disso que dá pra afirmar
 * com a API pública do Mercado Livre.
 *
 * IMPORTANTE, e o motivo de este arquivo existir separado: o ML **não expõe
 * atribuição por pedido**. Nada na resposta de `/orders/{id}` diz se o
 * comprador chegou por um anúncio patrocinado. O que a API de Ads devolve é
 * agregado por período (`directSales` por item), nunca "o pedido X veio do
 * clique Y". Foi pesquisado antes de implementar: dizer "esta venda veio do
 * Ads" num pedido específico seria inventar atribuição.
 *
 * O que dá pra afirmar com honestidade, e é o que isto faz: **este produto
 * está com campanha ativa e investimento no período**. Pra quem recebe a
 * notificação isso é o que importa na prática — a venda entrou num produto
 * que está consumindo verba, então o lucro dela ainda vai ser mordido pelo
 * ads. O rótulo na tela reflete exatamente essa distinção ("produto
 * anunciado"), sem prometer causalidade.
 */

const CACHE_TTL = 10 * 60 * 1000;
let cache: { at: number; gastoPorMlb: Record<string, number> } | null = null;

function brDayISO(offsetDays = 0): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000 + offsetDays * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Gasto de Ads por MLB nos últimos dias, com cache de 10 min. O cache não é
 * luxo: um pico de vendas dispara vários webhooks em segundos, e sem ele cada
 * um bateria na API de Ads — que já devolveu HTTP 429 neste projeto.
 */
async function gastoRecentePorMlb(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache.gastoPorMlb;
  try {
    const gastoPorMlb = await getAdsSpendByItem(brDayISO(-6), brDayISO());
    cache = { at: Date.now(), gastoPorMlb };
    return gastoPorMlb;
  } catch {
    // Falha aqui nunca pode derrubar a notificação de venda — sem dado, a
    // notificação simplesmente sai sem o selo, em vez de não sair.
    return cache?.gastoPorMlb ?? {};
  }
}

export type SeloAds = { anunciado: boolean; investido: number };

/**
 * Recebe os MLBs do pedido e diz se algum deles tem investimento em Ads na
 * última semana. `investido` é o gasto do PRODUTO no período (não desta
 * venda) — a tela precisa deixar isso claro no texto.
 */
export async function verificarProdutoAnunciado(mlbs: string[]): Promise<SeloAds> {
  const limpos = mlbs.map((m) => String(m ?? "").trim().toUpperCase()).filter(Boolean);
  if (limpos.length === 0) return { anunciado: false, investido: 0 };

  const gasto = await gastoRecentePorMlb();
  let investido = 0;
  for (const mlb of limpos) {
    const semPrefixo = mlb.replace(/^MLB/, "");
    investido += gasto[mlb] ?? gasto[`MLB${semPrefixo}`] ?? 0;
  }
  return { anunciado: investido > 0, investido };
}
