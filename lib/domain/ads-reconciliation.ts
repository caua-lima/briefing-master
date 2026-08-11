// Qualidade/reconciliação de dados de Ads (puro) — nunca deixar a pessoa
// tomar decisão sem saber que o dado está incompleto. Não recalcula gasto
// nem vendas: recebe os totais já prontos que app/api/ml/ads/route.ts
// devolve (gastoOrfao, gastoSemVinculo, campanhasEncontradas etc.) e decide
// COMO interpretar isso como "confiável ou não".

export type AdsDataQualityStatus = "confirmada" | "parcial" | "atencao" | "sem-dados";

export type AdsReconciliationInput = {
  /** Soma de custo de TODOS os anúncios com investimento no período (t.cost). */
  investimentoTotal: number;
  /** R$ de anúncios que declaram uma campanha que o ML não devolveu na lista. */
  gastoOrfao: number;
  /** R$ de anúncios sem nenhuma campanha resolvida. */
  gastoSemVinculo: number;
  /** true = a contagem de anúncios cadastrados por campanha falhou (nenhuma URL respondeu). */
  anunciosContagemFalhou: boolean;
  /** items.length > 0 — tinha algum anúncio com investimento pra reconciliar. */
  temItens: boolean;
};

export type AdsReconciliation = {
  investimentoTotal: number;
  investimentoVinculado: number;
  investimentoNaoVinculado: number;
  /** null = não dá pra calcular percentual (investimentoTotal <= 0). */
  coveragePercent: number | null;
  status: AdsDataQualityStatus;
};

export function getCoveragePercent(investimentoTotal: number, investimentoVinculado: number): number | null {
  if (investimentoTotal <= 0) return null;
  return (investimentoVinculado / investimentoTotal) * 100;
}

/**
 * Status da qualidade do dado:
 *  - "confirmada": nada investido pra reconciliar (nada a esconder), OU
 *    cobertura >= 98% e a contagem de anúncios não falhou.
 *  - "parcial": cobertura entre 80% e 98% — existe gasto não vinculado, mas
 *    é uma fatia pequena.
 *  - "atencao": a contagem de anúncios cadastrados falhou (sinal explícito de
 *    falha de API), OU cobertura < 80%.
 *  - "sem-dados": tem investimento mas não dá pra calcular cobertura nenhuma
 *    (não deveria acontecer com investimentoTotal > 0, mas nunca assume 0%
 *    nem 100% quando o cálculo não fecha).
 */
export function getAdsDataQualityStatus(input: {
  temItens: boolean;
  investimentoTotal: number;
  anunciosContagemFalhou: boolean;
  coveragePercent: number | null;
}): AdsDataQualityStatus {
  if (!input.temItens && input.investimentoTotal <= 0) return "confirmada";
  if (input.coveragePercent == null) return "sem-dados";
  if (input.anunciosContagemFalhou) return "atencao";
  if (input.coveragePercent >= 98) return "confirmada";
  if (input.coveragePercent >= 80) return "parcial";
  return "atencao";
}

export function getAdsDataQualityLabel(status: AdsDataQualityStatus): string {
  switch (status) {
    case "confirmada": return "Confirmada";
    case "parcial": return "Parcial";
    case "atencao": return "Atenção";
    case "sem-dados": return "Sem dados";
  }
}

export function calculateAdsReconciliation(input: AdsReconciliationInput): AdsReconciliation {
  const investimentoNaoVinculado = Math.max(0, input.gastoOrfao) + Math.max(0, input.gastoSemVinculo);
  const investimentoVinculado = Math.max(0, input.investimentoTotal - investimentoNaoVinculado);
  const coveragePercent = getCoveragePercent(input.investimentoTotal, investimentoVinculado);
  const status = getAdsDataQualityStatus({
    temItens: input.temItens,
    investimentoTotal: input.investimentoTotal,
    anunciosContagemFalhou: input.anunciosContagemFalhou,
    coveragePercent,
  });
  return {
    investimentoTotal: input.investimentoTotal,
    investimentoVinculado,
    investimentoNaoVinculado,
    coveragePercent,
    status,
  };
}
