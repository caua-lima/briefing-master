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

/**
 * Maior janela (em meses) que ainda deixa histórico ANTERIOR suficiente pra
 * identificar quem já era comprador.
 *
 * O problema real, visto em produção: com 12 meses pedidos e só ~3,5 meses de
 * histórico sincronizado, TODO comprador do período aparecia como "novo"
 * (620 novos, 0 frequentes, taxa 0,0%) — não porque ninguém recomprou, mas
 * porque não existia nenhum pedido ANTES do período pra comparar.
 *
 * A regra: reservar pelo menos metade do histórico disponível como linha de
 * base. Com 3,5 meses de dados, mede ~1 mês e usa ~2,5 como base. Devolve
 * null quando nem isso dá (menos de 2 meses de histórico) — aí não existe
 * janela honesta, e a tela deve dizer isso em vez de exibir 0%.
 */
export function janelaRecomendadaMeses(historicoDesde: string | null, hojeISO: string): number | null {
  if (!historicoDesde) return null;
  const inicio = Date.parse(`${historicoDesde}T00:00:00Z`);
  const hoje = Date.parse(`${hojeISO}T00:00:00Z`);
  if (!Number.isFinite(inicio) || !Number.isFinite(hoje) || hoje <= inicio) return null;
  const mesesDisponiveis = (hoje - inicio) / (30.44 * 86400000);
  const recomendado = Math.floor(mesesDisponiveis / 2);
  return recomendado >= 1 ? recomendado : null;
}
