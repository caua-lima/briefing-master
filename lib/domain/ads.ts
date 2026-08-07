// Helpers puros pra aba Ads — break-even ROAS e recomendação de ação por
// anúncio. Nada aqui recalcula lucro/vendas: recebe números já prontos da
// API de Ads (app/api/ml/ads/route.ts) e só decide como ler/rotular eles.

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
  acao: "pausar" | "reduzir" | "escalar" | "aguardar" | "sem-dados";
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
  /** false = alteração na campanha ainda dentro da janela de 3 dias (ver alteracaoInfo) */
  podeAlterar: boolean;
}): AdRecommendation {
  const { clicks, vendas, cost, lucro, roas, roasTarget, breakEvenRoas, margem, metaMargem, podeAlterar } = input;

  if (clicks < CLIQUES_MIN && vendas === 0) {
    return { acao: "sem-dados", label: "Sem dados suficientes", tone: "info" };
  }

  if (lucro != null && lucro < 0 && cost >= INVESTIMENTO_RELEVANTE) {
    return { acao: "pausar", label: "Pausar ou revisar", tone: "critical" };
  }

  if (!podeAlterar) {
    return { acao: "aguardar", label: "Aguardar aprendizado", tone: "info" };
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
