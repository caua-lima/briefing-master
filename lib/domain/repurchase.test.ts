import { describe, expect, it } from "vitest";
import { calcularCompradoresPeriodo } from "./repurchase";

describe("calcularCompradoresPeriodo", () => {
  it("sem compradores no período, taxa null", () => {
    const r = calcularCompradoresPeriodo([], "2026-01-01", "2026-01-31");
    expect(r.total).toBe(0);
    expect(r.taxaRecompra).toBeNull();
  });

  it("comprador cuja 1ª compra é dentro do período conta como novo", () => {
    const r = calcularCompradoresPeriodo(
      [{ buyer_id: "A", date_created: "2026-01-10T10:00:00.000-03:00" }],
      "2026-01-01", "2026-01-31",
    );
    expect(r.total).toBe(1);
    expect(r.novos).toBe(1);
    expect(r.frequentes).toBe(0);
    expect(r.taxaRecompra).toBe(0);
  });

  it("comprador com pedido antes do período conta como frequente quando compra de novo dentro dele", () => {
    const r = calcularCompradoresPeriodo(
      [
        { buyer_id: "A", date_created: "2025-06-01T10:00:00.000-03:00" }, // antes do período
        { buyer_id: "A", date_created: "2026-01-10T10:00:00.000-03:00" }, // dentro do período
      ],
      "2026-01-01", "2026-01-31",
    );
    expect(r.total).toBe(1);
    expect(r.frequentes).toBe(1);
    expect(r.novos).toBe(0);
    expect(r.taxaRecompra).toBe(100);
  });

  it("mistura de novos e frequentes calcula a taxa corretamente (bate com o exemplo do ML: 13/114 ≈ 11%)", () => {
    const historico: { buyer_id: string; date_created: string }[] = [];
    // 13 frequentes: compraram antes E dentro do período
    for (let i = 0; i < 13; i++) {
      historico.push({ buyer_id: `freq_${i}`, date_created: "2025-01-01T10:00:00.000-03:00" });
      historico.push({ buyer_id: `freq_${i}`, date_created: "2026-01-15T10:00:00.000-03:00" });
    }
    // 101 novos: só compraram dentro do período
    for (let i = 0; i < 101; i++) {
      historico.push({ buyer_id: `novo_${i}`, date_created: "2026-01-15T10:00:00.000-03:00" });
    }
    const r = calcularCompradoresPeriodo(historico, "2026-01-01", "2026-01-31");
    expect(r.total).toBe(114);
    expect(r.frequentes).toBe(13);
    expect(r.novos).toBe(101);
    expect(r.taxaRecompra).toBeCloseTo((13 / 114) * 100, 5);
  });

  it("pedido fora do período (antes ou depois) não conta pro total, só ajuda a marcar 'primeira compra'", () => {
    const r = calcularCompradoresPeriodo(
      [
        { buyer_id: "A", date_created: "2025-06-01T10:00:00.000-03:00" },
        { buyer_id: "B", date_created: "2026-03-01T10:00:00.000-03:00" }, // depois do período
      ],
      "2026-01-01", "2026-01-31",
    );
    expect(r.total).toBe(0);
  });

  it("pedidos sem buyer_id são ignorados", () => {
    const r = calcularCompradoresPeriodo(
      [{ buyer_id: null, date_created: "2026-01-10T10:00:00.000-03:00" }],
      "2026-01-01", "2026-01-31",
    );
    expect(r.total).toBe(0);
  });
});
