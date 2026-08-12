import { describe, expect, it } from "vitest";
import { calcularEntregasNoPrazo } from "./shipping-performance";

describe("calcularEntregasNoPrazo", () => {
  it("sem dados, percentual null", () => {
    const r = calcularEntregasNoPrazo([]);
    expect(r.comDados).toBe(0);
    expect(r.percentual).toBeNull();
  });

  it("entrega no dia estimado conta como no prazo", () => {
    const r = calcularEntregasNoPrazo([{ estimatedDelivery: "2026-08-10", dateDelivered: "2026-08-10T18:00:00.000Z" }]);
    expect(r.noPrazo).toBe(1);
    expect(r.percentual).toBe(100);
  });

  it("entrega depois do estimado conta como atrasada", () => {
    const r = calcularEntregasNoPrazo([{ estimatedDelivery: "2026-08-10", dateDelivered: "2026-08-12T10:00:00.000Z" }]);
    expect(r.noPrazo).toBe(0);
    expect(r.percentual).toBe(0);
  });

  it("pedidos sem os dois campos ficam fora da conta (não contam como atraso)", () => {
    const r = calcularEntregasNoPrazo([
      { estimatedDelivery: "2026-08-10", dateDelivered: "2026-08-09T10:00:00.000Z" },
      { estimatedDelivery: undefined, dateDelivered: "2026-08-09T10:00:00.000Z" },
      { estimatedDelivery: "2026-08-10", dateDelivered: undefined },
    ]);
    expect(r.comDados).toBe(1);
    expect(r.percentual).toBe(100);
  });
});
