import { describe, expect, it } from "vitest";
import {
  calcularCustoMedioEntrada,
  calcularCustoMedioSaldoInicial,
  calculateReorderSuggestion,
  calculateStockCoverage,
  getCoverageStatus,
} from "./estoque";

describe("calculateStockCoverage", () => {
  it("sem venda no periodo retorna null (nao inventa numero)", () => {
    expect(calculateStockCoverage(100, 0, 30)).toBeNull();
  });
  it("sem dias no periodo retorna null", () => {
    expect(calculateStockCoverage(100, 10, 0)).toBeNull();
  });
  it("caso normal: estoque / media diaria", () => {
    expect(calculateStockCoverage(100, 30, 30)).toBe(100); // media = 1/dia
  });
});

describe("getCoverageStatus", () => {
  it("sem cobertura calculavel, com estoque e sem venda vira encalhado", () => {
    expect(getCoverageStatus(null, 10, 0)).toBe("encalhado");
  });
  it("sem cobertura calculavel e sem estoque vira sem-giro", () => {
    expect(getCoverageStatus(null, 0, 0)).toBe("sem-giro");
  });
  it("estoque zerado sempre critico, mesmo com cobertura calculavel", () => {
    expect(getCoverageStatus(5, 0, 10)).toBe("critico");
  });
  it("faixas de dias: <7 critico, <15 repor, resto saudavel", () => {
    expect(getCoverageStatus(5, 10, 10)).toBe("critico");
    expect(getCoverageStatus(10, 10, 10)).toBe("repor");
    expect(getCoverageStatus(20, 10, 10)).toBe("saudavel");
  });
});

describe("calculateReorderSuggestion", () => {
  it("sem venda no periodo, sugere 0 (nao inventa)", () => {
    expect(calculateReorderSuggestion(5, 0, 30, 30)).toBe(0);
  });
  it("cobre a meta de dias considerando o que ja esta disponivel", () => {
    // media = 30/30 = 1/dia; meta 30 dias = 30 un; ja tem 5 -> repor 25
    expect(calculateReorderSuggestion(5, 30, 30, 30)).toBe(25);
  });
  it("nunca sugere negativo quando ja tem estoque de sobra", () => {
    expect(calculateReorderSuggestion(1000, 30, 30, 30)).toBe(0);
  });
});

describe("calcularCustoMedioEntrada", () => {
  it("media ponderada por quantidade entre estoque atual e compra nova", () => {
    // 10 un a R$5 + 10 un a R$7 = 20 un a R$6 (media)
    expect(calcularCustoMedioEntrada(10, 5, 10, 7)).toBe(6);
  });
  it("sem estoque nenhum antes, o custo medio vira o custo da compra", () => {
    expect(calcularCustoMedioEntrada(0, 0, 10, 8)).toBe(8);
  });
  it("quantidade comprada <= 0 nao altera o custo medio atual", () => {
    expect(calcularCustoMedioEntrada(10, 5, 0, 100)).toBe(5);
    expect(calcularCustoMedioEntrada(10, 5, -3, 100)).toBe(5);
  });
  it("estoque atual negativo (nao deveria acontecer, mas nao quebra) some com a compra antes de dividir", () => {
    // estoqueAtual + qtdComprada > 0 ainda entra na conta ponderada
    expect(calcularCustoMedioEntrada(-2, 10, 10, 10)).toBeCloseTo((-2 * 10 + 10 * 10) / 8, 5);
  });
});

describe("calcularCustoMedioSaldoInicial", () => {
  it("com estoque fora do Full e custo medio existente, blenda os dois", () => {
    // 10 un fora do Full a R$4 + 5 un de saldo do Full a R$10 = 15 un a (40+50)/15
    expect(calcularCustoMedioSaldoInicial(10, 4, 5, 10)).toBeCloseTo(90 / 15, 5);
  });
  it("sem nada fora do Full ainda, o custo do saldo vira o proprio custo informado", () => {
    expect(calcularCustoMedioSaldoInicial(0, 0, 5, 12)).toBe(12);
  });
  it("com estoque fora do Full mas SEM custo medio anterior (produto novo), tambem usa o custo informado", () => {
    expect(calcularCustoMedioSaldoInicial(10, 0, 5, 12)).toBe(12);
  });
  it("quantidade de saldo <= 0 nao altera o custo medio atual", () => {
    expect(calcularCustoMedioSaldoInicial(10, 4, 0, 999)).toBe(4);
  });
});
