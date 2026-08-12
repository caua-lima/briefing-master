/**
 * % de pedidos entregues até a data estimada — ESTIMATIVA PRÓPRIA, calculada
 * em cima de estimated_delivery/date_delivered que o sync já grava
 * (lib/ml/sync.ts). NÃO é o índice oficial "Exposição"/"Desempenho em
 * envios" do Mercado Livre — aquele usa uma fórmula proprietária que o ML
 * não expõe via API pública, então não reproduzimos o rótulo dele.
 */

export type OrderParaEntrega = {
  estimatedDelivery?: string;
  dateDelivered?: string;
};

export type ResultadoEntregas = {
  comDados: number;
  noPrazo: number;
  /** null = nenhum pedido do período tem os dois campos pra comparar. */
  percentual: number | null;
};

export function calcularEntregasNoPrazo(orders: OrderParaEntrega[]): ResultadoEntregas {
  let comDados = 0;
  let noPrazo = 0;
  for (const o of orders) {
    if (!o.estimatedDelivery || !o.dateDelivered) continue;
    comDados++;
    if (o.dateDelivered.slice(0, 10) <= o.estimatedDelivery.slice(0, 10)) noPrazo++;
  }
  return { comDados, noPrazo, percentual: comDados > 0 ? (noPrazo / comDados) * 100 : null };
}
