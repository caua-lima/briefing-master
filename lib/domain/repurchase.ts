/**
 * Taxa de recompra — % de compradores (buyer_id distinto) que fizeram 2 ou
 * mais pedidos válidos (não cancelados/devolvidos) no período analisado.
 * Puramente derivado de pedidos já sincronizados; não bate em API nenhuma.
 */

export type OrderParaRecompra = {
  buyer_id?: string | null;
};

export type ResultadoRecompra = {
  totalPedidosValidos: number;
  pedidosSemBuyerId: number;
  compradoresUnicos: number;
  compradoresRecorrentes: number;
  /** null = sem comprador nenhum no período, não dá pra calcular. */
  taxaRecompra: number | null;
};

export function calcularTaxaRecompra(orders: OrderParaRecompra[]): ResultadoRecompra {
  const porComprador = new Map<string, number>();
  let pedidosSemBuyerId = 0;

  for (const o of orders) {
    const bid = o.buyer_id;
    if (!bid) { pedidosSemBuyerId++; continue; }
    porComprador.set(bid, (porComprador.get(bid) ?? 0) + 1);
  }

  const compradoresUnicos = porComprador.size;
  const compradoresRecorrentes = Array.from(porComprador.values()).filter((n) => n >= 2).length;
  const taxaRecompra = compradoresUnicos > 0 ? (compradoresRecorrentes / compradoresUnicos) * 100 : null;

  return {
    totalPedidosValidos: orders.length,
    pedidosSemBuyerId,
    compradoresUnicos,
    compradoresRecorrentes,
    taxaRecompra,
  };
}

/** Amostra pequena demais deixa a taxa instável — a tela deve avisar, não esconder o número. */
export function recompraTemDadosSuficientes(compradoresUnicos: number, minimo = 10): boolean {
  return compradoresUnicos >= minimo;
}
