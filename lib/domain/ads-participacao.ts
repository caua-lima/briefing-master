/**
 * Quanto da receita veio da publicidade — a pergunta "se eu desligar o Ads,
 * quanto da minha venda some?".
 *
 * Três números diferentes que é fácil confundir, e por isso ficam explícitos:
 *
 * - `receitaDireta`  (directSales) — venda que o ML atribuiu ao CLIQUE no
 *   anúncio pago. É a mais conservadora: o comprador clicou e comprou.
 * - `receitaAtribuida` (adSales)   — tudo que o ML credita à campanha,
 *   incluindo venda assistida (viu o anúncio, comprou depois por outro
 *   caminho). Sempre >= a direta.
 * - `receitaTotal`   (totalSales)  — a venda REAL do período, calculada por
 *   nós a partir dos pedidos, anunciada ou não.
 *
 * Cuidado de origem, e o motivo de `acimaDe100` existir: direta/atribuída vêm
 * do Mercado Ads e a total vem dos NOSSOS pedidos. São fontes diferentes, com
 * janelas de atribuição diferentes — o ML credita a venda ao dia do clique,
 * não ao dia do pedido. Num período curto isso pode gerar uma proporção acima
 * de 100%, que não é erro de conta: é o recorte não fechando. Quando acontece
 * a tela precisa avisar, não esconder nem "corrigir" o número pra 100%.
 */

export type ParticipacaoAds = {
  /** % da receita total atribuída ao clique direto. null = sem receita pra dividir. */
  direta: number | null;
  /** % da receita total atribuída à campanha (direta + assistida). */
  comAssistidas: number | null;
  /** true = proporção passou de 100%, sinal de janelas de atribuição diferentes. */
  acimaDe100: boolean;
};

export function calcularParticipacaoAds(
  receitaDireta: number,
  receitaAtribuida: number,
  receitaTotal: number,
): ParticipacaoAds {
  if (!(receitaTotal > 0)) {
    return { direta: null, comAssistidas: null, acimaDe100: false };
  }
  const direta = (Math.max(receitaDireta, 0) / receitaTotal) * 100;
  const comAssistidas = (Math.max(receitaAtribuida, 0) / receitaTotal) * 100;
  return {
    direta,
    comAssistidas,
    acimaDe100: direta > 100 || comAssistidas > 100,
  };
}

/**
 * Leitura curta do número, pra tela não obrigar o vendedor a interpretar
 * sozinho. Os cortes são os mesmos que já regem a cor de ROAS/margem no resto
 * do app: alto = dependência que vira risco se a verba parar.
 */
export function lerParticipacao(pct: number | null): { texto: string; cor: string } {
  if (pct == null) return { texto: "sem venda no período pra calcular", cor: "var(--muted)" };
  if (pct >= 70) return { texto: "dependência alta da publicidade", cor: "var(--red)" };
  if (pct >= 40) return { texto: "boa parte da venda depende de Ads", cor: "var(--warning)" };
  if (pct >= 15) return { texto: "Ads complementa a venda orgânica", cor: "var(--green)" };
  return { texto: "venda majoritariamente orgânica", cor: "var(--green)" };
}
