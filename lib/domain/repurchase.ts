/**
 * Compradores do período, no mesmo critério do próprio Mercado Livre
 * (Métricas > Negócio > "Detalhe dos compradores"): dentro do período,
 * "frequente" é quem já tinha comprado ANTES do período começar; "novo" é
 * quem comprou de você pela primeira vez dentro do período. Taxa de
 * recompra = frequentes ÷ total de compradores do período.
 *
 * Puramente derivado de pedidos já sincronizados (buyer_id); não bate em
 * API nenhuma.
 */

export type OrderParaComprador = {
  buyer_id?: string | null;
  /** Data no formato "YYYY-MM-DD..." — só os 10 primeiros caracteres importam. */
  date_created?: string;
};

export type ResultadoCompradores = {
  total: number;
  frequentes: number;
  novos: number;
  /** null = nenhum comprador no período, não dá pra calcular. */
  taxaRecompra: number | null;
};

/**
 * `historico` precisa cobrir de bem antes do período até o fim dele — é o
 * único jeito de saber se a primeira compra de um comprador foi antes
 * (frequente) ou dentro do período (novo). Ver app/api/ml/desempenho, que
 * busca essa janela estendida antes de chamar esta função.
 */
export function calcularCompradoresPeriodo(
  historico: OrderParaComprador[],
  periodoInicio: string,
  periodoFim: string,
): ResultadoCompradores {
  const primeiraCompra = new Map<string, string>();
  for (const o of historico) {
    if (!o.buyer_id || !o.date_created) continue;
    const dia = o.date_created.slice(0, 10);
    const atual = primeiraCompra.get(o.buyer_id);
    if (!atual || dia < atual) primeiraCompra.set(o.buyer_id, dia);
  }

  const compradoresNoPeriodo = new Set<string>();
  for (const o of historico) {
    if (!o.buyer_id || !o.date_created) continue;
    const dia = o.date_created.slice(0, 10);
    if (dia >= periodoInicio && dia <= periodoFim) compradoresNoPeriodo.add(o.buyer_id);
  }

  let frequentes = 0;
  for (const b of compradoresNoPeriodo) {
    if ((primeiraCompra.get(b) ?? "") < periodoInicio) frequentes++;
  }
  const total = compradoresNoPeriodo.size;
  const novos = total - frequentes;
  const taxaRecompra = total > 0 ? (frequentes / total) * 100 : null;

  return { total, frequentes, novos, taxaRecompra };
}
