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

/**
 * ROAS IDEAL — o mínimo pra sobrar a margem que você quer, não só pra empatar.
 *
 * Break-even responde "a partir de quanto eu paro de perder"; este responde
 * "a partir de quanto eu de fato LUCRO o que quero". A diferença entre os dois
 * é a faixa em que o anúncio se paga mas não entrega margem — que é onde a
 * maioria das campanhas vive sem ninguém notar.
 *
 * Dedução (R = receita, C = custo do ad, L0 = lucro ANTES do ad, m = margem
 * alvo em fração):
 *     margem após ads = (L0 − C) / R ≥ m
 *     ⇒ C ≤ L0 − m·R
 *     ⇒ ROAS = R / C ≥ R / (L0 − m·R)
 *
 * Retorna null quando L0 ≤ m·R: nesse caso o produto não gera margem
 * suficiente NEM gastando zero em ads — nenhum ROAS resolve, e devolver um
 * número aqui (0, Infinity) faria a tela sugerir uma meta impossível. Com
 * m = 0 o resultado é exatamente o break-even, por construção.
 */
export function calculateTargetRoas(
  vendas: number,
  lucroAntesAds: number,
  metaMargemPct: number,
): number | null {
  if (vendas <= 0 || lucroAntesAds <= 0) return null;
  const m = Math.max(metaMargemPct, 0) / 100;
  const folga = lucroAntesAds - m * vendas;
  if (folga <= 0) return null;
  return vendas / folga;
}

/**
 * Lucro que sobraria se o anúncio atingisse um ROAS alvo, mantendo a MESMA
 * receita de hoje.
 *
 * A pergunta que isto responde é "vale perseguir esse ROAS?". O ROAS ideal
 * sozinho é uma meta abstrata — R$ 62,75x não diz nada até virar dinheiro.
 *
 * Como o ROAS alvo é atingido cortando investimento (R fixo, C menor):
 *     C_alvo = R / ROAS_alvo
 *     lucro  = L0 − C_alvo
 *
 * Vale dizer o que isto NÃO é: uma previsão. Cortar investimento pela metade
 * costuma derrubar a receita junto, e aí o resultado real fica abaixo daqui.
 * É o teto do que aquele ROAS entregaria — bom pra comparar anúncios entre si,
 * não pra prometer resultado.
 *
 * Devolve null sem receita ou sem ROAS alvo: seria divisão por zero.
 */
export function lucroNoRoas(
  vendas: number,
  lucroAntesAds: number,
  roasAlvo: number | null,
): number | null {
  if (roasAlvo == null || roasAlvo <= 0 || vendas <= 0) return null;
  return lucroAntesAds - vendas / roasAlvo;
}

/**
 * Por que não há ROAS ideal pra este anúncio — o texto que substitui o "—" mudo.
 *
 * Um traço na coluna faz parecer defeito da tela. Na verdade são três
 * situações bem diferentes, e cada uma pede uma ação diferente de quem lê:
 * faltar venda é esperar/investir, o produto não fechar conta é mexer em
 * preço ou custo, e a meta ser inalcançável é rever a meta.
 */
export function motivoSemRoasIdeal(
  vendas: number,
  lucroAntesAds: number,
  metaMargemPct: number,
): string | null {
  if (vendas > 0 && lucroAntesAds > 0) {
    const m = Math.max(metaMargemPct, 0) / 100;
    if (lucroAntesAds - m * vendas > 0) return null; // tem ROAS ideal
    return `Este produto rende ${((lucroAntesAds / vendas) * 100).toFixed(1)}% antes do ads — abaixo da meta de ${metaMargemPct}%. Nenhum ROAS alcança essa margem: o ajuste é no preço ou no custo, não na campanha.`;
  }
  if (vendas <= 0) {
    return "Sem venda atribuída no período — sem receita não dá pra calcular o ROAS que cobre a meta.";
  }
  return "O produto não cobre o próprio custo antes do ads (lucro antes do ads é zero ou negativo). Não existe ROAS que torne este anúncio lucrativo.";
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

  // "acao" interna continua "pausar" (usada por quem filtra/agrupa por tipo
  // de ação), mas o TEXTO nunca afirma pausa definitiva — o ML não garante
  // que pausar é reversível sem perder histórico de aprendizado da campanha,
  // e a decisão final é sempre de quem lê a tela, não do sistema.
  if (lucro != null && lucro < 0 && cost >= INVESTIMENTO_RELEVANTE) {
    return { acao: "pausar", label: "Revisar ou reduzir — prejuízo confirmado", tone: "critical" };
  }

  const abaixoDoAlvo = roasTarget > 0 && roas < roasTarget;
  const abaixoDoBreakEven = breakEvenRoas != null && roas < breakEvenRoas;
  if (cost > 0 && abaixoDoAlvo && abaixoDoBreakEven) {
    return { acao: "reduzir", label: "Revisar ou reduzir orçamento", tone: "warning" };
  }

  const margemSaudavel = margem != null && margem >= metaMargem;
  const roasSaudavel = (roasTarget > 0 && roas >= roasTarget) || (breakEvenRoas != null && roas >= breakEvenRoas * 1.2);
  if (margemSaudavel && roasSaudavel && cost > 0) {
    return { acao: "escalar", label: "Escalar com cautela", tone: "opportunity" };
  }

  return { acao: "sem-dados", label: "Sem dados suficientes", tone: "info" };
}
