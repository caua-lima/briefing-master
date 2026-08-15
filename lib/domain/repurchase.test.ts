import { describe, expect, it } from "vitest";
import { calcularCompradoresPeriodo, janelaRecomendadaMeses } from "./repurchase";

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

describe("janelaRecomendadaMeses", () => {
  it("sem historico, nao ha janela", () => {
    expect(janelaRecomendadaMeses(null, "2026-08-17")).toBeNull();
  });

  it("~3,5 meses de historico recomenda 1 mes (metade reservada como base)", () => {
    // Caso real reportado: historico comeca 01/05, hoje 17/08 -> ~3,5 meses.
    expect(janelaRecomendadaMeses("2026-05-01", "2026-08-17")).toBe(1);
  });

  it("1 ano de historico recomenda 5 meses (arredonda pra baixo, sobrando base)", () => {
    // 365 dias / 30,44 = 11,99 "meses" -> floor(11,99/2) = 5. Arredondar pra
    // baixo é de proposito: erra sempre pro lado de reservar MAIS historico
    // como linha de base, que e o lado seguro pra nao inflar "novos".
    expect(janelaRecomendadaMeses("2025-08-17", "2026-08-17")).toBe(5);
  });

  it("historico curto demais (< 2 meses) nao tem janela honesta", () => {
    expect(janelaRecomendadaMeses("2026-08-01", "2026-08-17")).toBeNull();
  });

  it("data invalida ou futura nao quebra", () => {
    expect(janelaRecomendadaMeses("abc", "2026-08-17")).toBeNull();
    expect(janelaRecomendadaMeses("2027-01-01", "2026-08-17")).toBeNull();
  });
});
