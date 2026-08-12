import { describe, expect, it } from "vitest";
import { calcularTaxaRecompra, recompraTemDadosSuficientes } from "./repurchase";

describe("calcularTaxaRecompra", () => {
  it("sem pedidos, taxa null", () => {
    const r = calcularTaxaRecompra([]);
    expect(r.compradoresUnicos).toBe(0);
    expect(r.taxaRecompra).toBeNull();
  });

  it("comprador único com 1 pedido não conta como recompra", () => {
    const r = calcularTaxaRecompra([{ buyer_id: "A" }]);
    expect(r.compradoresUnicos).toBe(1);
    expect(r.compradoresRecorrentes).toBe(0);
    expect(r.taxaRecompra).toBe(0);
  });

  it("2 de 4 compradores recompraram → 50%", () => {
    const r = calcularTaxaRecompra([
      { buyer_id: "A" }, { buyer_id: "A" },
      { buyer_id: "B" }, { buyer_id: "B" }, { buyer_id: "B" },
      { buyer_id: "C" },
      { buyer_id: "D" },
    ]);
    expect(r.compradoresUnicos).toBe(4);
    expect(r.compradoresRecorrentes).toBe(2);
    expect(r.taxaRecompra).toBe(50);
  });

  it("pedidos sem buyer_id ficam de fora do cálculo mas são contados à parte", () => {
    const r = calcularTaxaRecompra([{ buyer_id: "A" }, { buyer_id: null }, { buyer_id: undefined }]);
    expect(r.pedidosSemBuyerId).toBe(2);
    expect(r.compradoresUnicos).toBe(1);
    expect(r.totalPedidosValidos).toBe(3);
  });
});

describe("recompraTemDadosSuficientes", () => {
  it("abaixo do mínimo (10 por padrão) não tem dado suficiente", () => {
    expect(recompraTemDadosSuficientes(9)).toBe(false);
    expect(recompraTemDadosSuficientes(10)).toBe(true);
  });

  it("aceita mínimo customizado", () => {
    expect(recompraTemDadosSuficientes(3, 3)).toBe(true);
    expect(recompraTemDadosSuficientes(2, 3)).toBe(false);
  });
});
