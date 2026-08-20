/**
 * "Esta venda valeu?" — a pergunta que decide se um pedido entra no faturamento.
 *
 * ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────
 *
 * O faturamento líquido fechava ABAIXO do "Vendas brutas" do Seller Center, e
 * a decomposição foi exata:
 *
 *     app bruto 15.654,70 − ML 15.307,00 = 347,70   ← o que o ML de fato cancelou
 *     ML 15.307,00 − app líquido 14.946,72 = 360,28 ← o que o app cancelou A MAIS
 *     347,70 + 360,28 = 707,98 = "vendas canceladas" do app
 *
 * Ou seja: o app descontava ~R$ 360 de pedidos que o Mercado Livre continua
 * contando como venda boa. A causa é ter DUAS fontes para o mesmo sinal:
 *
 *   1. `status` do pedido, lido ao vivo do ML — autoritativo.
 *   2. a coleção `ml_returns`, alimentada por um sync que consulta
 *      `order.status=cancelled` e só ESCREVE. Nada nunca remove um pedido de
 *      lá. Um pedido que apareceu cancelado uma vez (cancelamento revertido,
 *      disputa ganha, estado transitório do ML) fica marcado para sempre — e
 *      seguia sendo descontado meses depois, mesmo com o ML já dizendo "paid".
 *
 * A regra que sai disso: **o status ao vivo manda**. `ml_returns` vira o que
 * sempre deveria ter sido — um cache, útil só quando não temos status.
 *
 * Devolução é outra história e continua vindo de `ml_returns`: ela nasce de um
 * claim pós-venda, que NÃO aparece no status do pedido. Só o cancelamento
 * tinha fonte duplicada.
 */

export type ClassificacaoVenda =
  /** Não é venda: cancelada/inválida. Fica no bruto, sai do líquido e do lucro. */
  | "cancelada"
  /** Venda revertida por devolução concluída: produto volta ao estoque, 0 a 0. */
  | "devolvida"
  /** Venda que valeu. */
  | "valida";

/** Status do ML que significam "esta venda não aconteceu". */
export function ehStatusNaoVenda(status: unknown): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  return s === "cancelled" || s === "invalid";
}

/** O pedido trouxe um status utilizável? String vazia = não sabemos. */
export function temStatusConfiavel(status: unknown): boolean {
  return String(status ?? "").trim() !== "";
}

export type EntradaClassificacao = {
  /** `status` do pedido como o ML devolveu. */
  status: unknown;
  /** O pedido está marcado como cancelado no cache `ml_returns`. */
  noCacheDeCancelados: boolean;
  /** O pedido tem devolução CONCLUÍDA em `ml_returns`. */
  temDevolucaoConcluida: boolean;
};

export type ResultadoClassificacao = {
  classe: ClassificacaoVenda;
  /**
   * true quando o cache dizia "cancelada" mas o status ao vivo diz que a venda
   * vale. É o caso que inflava o total de canceladas — contabilizado e
   * exposto na conferência, nunca corrigido em silêncio.
   */
  resgatadoDoCache: boolean;
};

export function classificarVenda(e: EntradaClassificacao): ResultadoClassificacao {
  const statusConfiavel = temStatusConfiavel(e.status);

  // 1. Status ao vivo dizendo "cancelada" é definitivo.
  if (ehStatusNaoVenda(e.status)) return { classe: "cancelada", resgatadoDoCache: false };

  // 2. Cache diz cancelada, mas o ML diz que a venda está de pé.
  //    O ML é a fonte; sem isto, um cancelamento revertido nunca voltava.
  if (e.noCacheDeCancelados && statusConfiavel) {
    // A devolução ainda vale: ela vem de claim, sinal que o status não carrega.
    if (e.temDevolucaoConcluida) return { classe: "devolvida", resgatadoDoCache: true };
    return { classe: "valida", resgatadoDoCache: true };
  }

  // 3. Sem status utilizável, o cache é tudo que temos.
  if (e.noCacheDeCancelados) return { classe: "cancelada", resgatadoDoCache: false };

  // 4. Devolução concluída reverte a venda (produto volta ao estoque).
  if (e.temDevolucaoConcluida) return { classe: "devolvida", resgatadoDoCache: false };

  return { classe: "valida", resgatadoDoCache: false };
}
