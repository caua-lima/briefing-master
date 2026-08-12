import { describe, expect, it } from "vitest";
import { custoNaData } from "./types";

describe("custoNaData", () => {
  it("sem faixas, usa o custoMedio atual (mesmo comportamento de antes da feature)", () => {
    expect(custoNaData({ custoMedio: 12 }, "2020-01-01")).toBe(12);
  });

  it("sem faixas, cai pro custo manual quando não há custoMedio", () => {
    expect(custoNaData({ custo: "8" }, "2026-01-01")).toBe(8);
  });

  it("pedido depois da faixa mais recente usa o valor mais recente", () => {
    const prod = { custoMedio: 12, custoMedioFaixas: [{ desde: "2000-01-01", custo: 10 }, { desde: "2026-08-01", custo: 12 }] };
    expect(custoNaData(prod, "2026-08-15")).toBe(12);
  });

  it("pedido ANTES de uma entrada nova mantém o custo antigo — o bug relatado", () => {
    // Produto tinha custo 10 desde sempre; hoje (2026-08-15) chegou uma
    // entrada nova que subiu o custo médio pra 15 (só vale dali pra frente).
    const prod = {
      custoMedio: 15,
      custoMedioFaixas: [
        { desde: "2000-01-01", custo: 10 },
        { desde: "2026-08-15", custo: 15 },
      ],
    };
    // venda de ONTEM continua com o custo de 10, não pula pro novo custo de 15
    expect(custoNaData(prod, "2026-08-14")).toBe(10);
    // venda de HOJE (dia da entrada) já usa o novo custo
    expect(custoNaData(prod, "2026-08-15")).toBe(15);
  });

  it("pedido mais antigo que qualquer faixa registrada cai pro valor atual, não pro custo da faixa", () => {
    const prod = { custoMedio: 25, custoMedioFaixas: [{ desde: "2026-01-01", custo: 20 }] };
    expect(custoNaData(prod, "2019-01-01")).toBe(25);
  });

  it("faixa vazia é tratada igual a nenhuma faixa", () => {
    expect(custoNaData({ custoMedio: 7, custoMedioFaixas: [] }, "2026-01-01")).toBe(7);
  });
});
