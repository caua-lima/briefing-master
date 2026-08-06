// Helper puro pro bloco "Produtos em risco" do Dashboard — cruza estoque
// (data.products) com o desempenho por anúncio do período (mlMetrics.anuncios)
// já calculados em outro lugar. Não inventa cobertura de estoque em dias
// (isso é a Fase 5, com o cálculo de giro médio) — aqui é só um limiar
// simples de unidades, provisório e documentado como tal.

export type RiskAnuncio = {
  item_id: string;
  title: string;
  margem: number;
  vendas: number;
};

export type RiskProduto = {
  id: string;
  name: string;
  ativo: boolean;
  qtdLocal?: number;
  mlb?: string;
  mlbs?: string[];
};

export type RiskMotivo = "estoque-baixo" | "margem-baixa";

export type ProdutoEmRisco = {
  produtoId: string;
  nome: string;
  qtdLocal: number;
  margem: number | null;
  motivos: RiskMotivo[];
};

const ESTOQUE_BAIXO_LIMIAR = 5;

function normalizeMlb(s: string): string {
  return s.trim().toUpperCase().replace(/^MLB/, "");
}

/**
 * Produtos ativos com estoque local baixo (≤5 un., limiar provisório — a
 * cobertura de verdade em dias entra na Fase 5) e/ou margem no período
 * abaixo da meta. Só entra na lista quem tem pelo menos um dos dois riscos.
 */
export function findProdutosEmRisco(
  produtos: RiskProduto[],
  anuncios: RiskAnuncio[],
  metaMargem: number,
): ProdutoEmRisco[] {
  const margemPorMlb = new Map<string, { margem: number; vendas: number }>();
  for (const a of anuncios) {
    margemPorMlb.set(normalizeMlb(a.item_id), { margem: a.margem, vendas: a.vendas });
  }

  const riscos: ProdutoEmRisco[] = [];
  for (const p of produtos) {
    if (!p.ativo) continue;
    const qtd = p.qtdLocal ?? 0;
    const mlbs = (p.mlbs?.length ? p.mlbs : p.mlb ? [p.mlb] : []).map(normalizeMlb);
    const desempenho = mlbs.map((m) => margemPorMlb.get(m)).find((d) => d != null) ?? null;

    const motivos: RiskMotivo[] = [];
    if (qtd > 0 && qtd <= ESTOQUE_BAIXO_LIMIAR) motivos.push("estoque-baixo");
    if (desempenho && desempenho.vendas > 0 && metaMargem > 0 && desempenho.margem < metaMargem) motivos.push("margem-baixa");

    if (motivos.length === 0) continue;
    riscos.push({
      produtoId: p.id,
      nome: p.name,
      qtdLocal: qtd,
      margem: desempenho?.margem ?? null,
      motivos,
    });
  }

  // Pior primeiro: os dois riscos juntos, depois quem tem menos estoque.
  return riscos.sort((a, b) => (b.motivos.length - a.motivos.length) || (a.qtdLocal - b.qtdLocal));
}
