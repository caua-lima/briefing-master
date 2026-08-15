/**
 * Agregação de métricas por CAMPANHA. A aba Ads sempre mostrou o funil do
 * período inteiro (todas as campanhas somadas), o que esconde o caso mais
 * comum na prática: uma campanha saudável carregando outra que sangra. Aqui
 * cada campanha vira uma linha própria, com o mesmo funil aplicado só a ela.
 *
 * Puro de propósito (sem React/fetch): a soma que decide onde o dinheiro está
 * indo precisa ser testável sem subir tela nenhuma.
 */

export type ItemParaCampanha = {
  campaignId: string;
  campaignName: string;
  clicks: number;
  prints: number;
  cost: number;
  directSales: number;
  directUnits: number;
  totalSales: number;
  totalUnits: number;
  lucroLiquido: number;
  lucroDiretoLiquido: number;
  /** false = sem venda vinculada no período; o lucro "direto" não dá pra afirmar. */
  diretoDisponivel: boolean;
};

export type CampanhaAgregada = {
  campaignId: string;
  campaignName: string;
  anuncios: number;
  prints: number;
  clicks: number;
  cost: number;
  /** Receita e lucro no modo escolhido (direta = só venda atribuída ao clique). */
  receita: number;
  unidades: number;
  /** null quando NENHUM anúncio da campanha tem venda vinculada — não é zero, é falta de dado. */
  lucroAposAds: number | null;
  roas: number | null;
  acos: number | null;
};

/** Anúncio sem campanha identificada — agrupado à parte pra não sumir da soma. */
export const CAMPANHA_SEM_ID = "__sem_campanha__";

export function agregarPorCampanha(
  itens: ItemParaCampanha[],
  modo: "pub" | "geral",
): CampanhaAgregada[] {
  const mapa = new Map<string, CampanhaAgregada & { temDireto: boolean }>();

  for (const i of itens) {
    const id = i.campaignId || CAMPANHA_SEM_ID;
    const atual = mapa.get(id) ?? {
      campaignId: id,
      campaignName: i.campaignName || (id === CAMPANHA_SEM_ID ? "Sem campanha identificada" : id),
      anuncios: 0, prints: 0, clicks: 0, cost: 0, receita: 0, unidades: 0,
      lucroAposAds: 0, roas: null, acos: null, temDireto: false,
    };

    atual.anuncios += 1;
    atual.prints += i.prints;
    atual.clicks += i.clicks;
    atual.cost += i.cost;
    atual.receita += modo === "pub" ? i.directSales : i.totalSales;
    atual.unidades += modo === "pub" ? i.directUnits : i.totalUnits;

    /**
     * No modo "publicidade direta" o lucro só existe pra anúncio com venda
     * vinculada. Somar 0 pelos outros faria a campanha parecer menos lucrativa
     * do que é — então só soma quem tem dado, e a campanha inteira fica sem
     * lucro (null) se NINGUÉM tiver.
     */
    if (modo === "pub") {
      if (i.diretoDisponivel) {
        atual.temDireto = true;
        atual.lucroAposAds = (atual.lucroAposAds ?? 0) + i.lucroDiretoLiquido;
      }
    } else {
      atual.temDireto = true;
      atual.lucroAposAds = (atual.lucroAposAds ?? 0) + i.lucroLiquido;
    }

    mapa.set(id, atual);
  }

  return Array.from(mapa.values())
    .map((c) => {
      const lucroAposAds = c.temDireto ? c.lucroAposAds : null;
      return {
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        anuncios: c.anuncios,
        prints: c.prints,
        clicks: c.clicks,
        cost: c.cost,
        receita: c.receita,
        unidades: c.unidades,
        lucroAposAds,
        roas: c.cost > 0 ? c.receita / c.cost : null,
        // ACOS = investido ÷ receita. Sem receita não é "infinito", é indefinido.
        acos: c.receita > 0 ? (c.cost / c.receita) * 100 : null,
      };
    })
    // Maior investimento primeiro: é onde uma decisão errada custa mais caro.
    .sort((a, b) => b.cost - a.cost);
}
