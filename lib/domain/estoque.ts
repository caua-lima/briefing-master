// Helpers puros de cobertura/reposição de estoque — Fase 5. Não mexem no
// livro de movimentações nem no custo médio ponderado (isso continua
// intacto em lib/firebase/data.ts); só decidem como LER o que já existe:
// estoque disponível (já calculado) e vendas de um período (já buscadas via
// /api/ml/estoque-forecast).

/**
 * Cobertura em dias = estoque disponível ÷ média de vendas por dia.
 * `null` (não 0, não Infinity) quando não há giro suficiente pra confiar
 * numa previsão — sem venda no período, qualquer número aqui seria
 * inventado, não calculado.
 */
export function calculateStockCoverage(
  estoqueDisponivel: number,
  vendasNoPeriodo: number,
  diasNoPeriodo: number,
): number | null {
  if (diasNoPeriodo <= 0 || vendasNoPeriodo <= 0) return null;
  const mediaDiaria = vendasNoPeriodo / diasNoPeriodo;
  if (mediaDiaria <= 0) return null;
  return estoqueDisponivel / mediaDiaria;
}

export type CoverageStatus = "critico" | "repor" | "saudavel" | "encalhado" | "sem-giro";

/**
 * Classifica a cobertura em faixas de decisão. `sem-giro` é diferente de
 * `encalhado`: sem-giro = não temos como calcular (produto novo, sem venda
 * no período); encalhado = temos estoque parado E confirmamos que não há
 * giro (vendasNoPeriodo === 0 mas tem estoque > 0).
 */
export function getCoverageStatus(
  coberturaDias: number | null,
  estoqueDisponivel: number,
  vendasNoPeriodo: number,
): CoverageStatus {
  if (coberturaDias == null) {
    return estoqueDisponivel > 0 && vendasNoPeriodo === 0 ? "encalhado" : "sem-giro";
  }
  if (estoqueDisponivel <= 0) return "critico";
  if (coberturaDias < 7) return "critico";
  if (coberturaDias < 15) return "repor";
  return "saudavel";
}

export const COVERAGE_STATUS_LABEL: Record<CoverageStatus, string> = {
  critico: "Crítico",
  repor: "Repor",
  saudavel: "Saudável",
  encalhado: "Encalhado",
  "sem-giro": "Sem giro suficiente",
};

/**
 * Sugestão de quantidade a comprar pra cobrir `diasAlvo` de venda, dado o
 * que já está disponível. Transparente por design: quem chama pode mostrar
 * a mesma conta (mediaDiaria × diasAlvo − disponível) e o usuário pode
 * editar a sugestão manualmente — isso não é feito aqui, é decisão de UI.
 */
export function calculateReorderSuggestion(
  estoqueDisponivel: number,
  vendasNoPeriodo: number,
  diasNoPeriodo: number,
  diasAlvo: number,
): number {
  if (diasNoPeriodo <= 0 || vendasNoPeriodo <= 0 || diasAlvo <= 0) return 0;
  const mediaDiaria = vendasNoPeriodo / diasNoPeriodo;
  return Math.max(0, Math.ceil(mediaDiaria * diasAlvo) - estoqueDisponivel);
}
