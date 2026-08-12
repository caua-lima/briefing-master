import { describe, expect, it } from "vitest";
import { calcularConcentracaoVendas } from "./sales-heatmap";

describe("calcularConcentracaoVendas", () => {
  it("sem pedidos, tudo zerado e sem dia/hora mais forte", () => {
    const r = calcularConcentracaoVendas([]);
    expect(r.totalVendas).toBe(0);
    expect(r.diaMaisForte).toBeNull();
    expect(r.horaMaisForte).toBeNull();
    expect(r.grid.flat().every((n) => n === 0)).toBe(true);
  });

  it("agrupa por dia da semana e hora corretamente", () => {
    // 2026-08-11 é uma terça-feira
    const r = calcularConcentracaoVendas([
      { date_created: "2026-08-11T14:32:10.000-03:00" },
      { date_created: "2026-08-11T14:05:00.000-03:00" },
      { date_created: "2026-08-11T09:00:00.000-03:00" },
    ]);
    const terca = new Date(2026, 7, 11).getDay();
    expect(r.totalVendas).toBe(3);
    expect(r.grid[terca][14]).toBe(2);
    expect(r.grid[terca][9]).toBe(1);
    expect(r.diaMaisForte).toBe(terca);
    expect(r.horaMaisForte).toBe(14);
  });

  it("ignora entradas sem date_created ou malformadas", () => {
    const r = calcularConcentracaoVendas([{ date_created: "" }, { date_created: undefined }, { date_created: "abc" }]);
    expect(r.totalVendas).toBe(0);
  });
});
