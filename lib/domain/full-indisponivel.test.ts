import { describe, expect, it } from "vitest";
import { traduzirStatusIndisponivel, unidadesComPerda, unidadesEmTransito, valorRetido } from "./full-indisponivel";

describe("traduzirStatusIndisponivel — cada motivo pede uma acao diferente", () => {
  it("transferencia se resolve sozinha e nao e perda", () => {
    const t = traduzirStatusIndisponivel("transfer");
    expect(t.label).toMatch(/transferência/i);
    expect(t.perda).toBe(false);
  });

  it("avaria e perda e manda pedir reembolso", () => {
    const t = traduzirStatusIndisponivel("damaged");
    expect(t.perda).toBe(true);
    expect(t.acao).toMatch(/reembolso/i);
  });

  it("perdido pelo ML tambem e reembolso", () => {
    expect(traduzirStatusIndisponivel("lost").perda).toBe(true);
  });

  it("item nao aceito no Full e perda — parado la nao vende nunca", () => {
    const t = traduzirStatusIndisponivel("not_supported");
    expect(t.perda).toBe(true);
    expect(t.acao).toMatch(/Retire/i);
  });

  it("retirada pedida por voce NAO e perda", () => {
    expect(traduzirStatusIndisponivel("withdrawal").perda).toBe(false);
  });

  it("nao depende de caixa nem de espaco", () => {
    expect(traduzirStatusIndisponivel("  DAMAGED ").perda).toBe(true);
  });

  it("codigo desconhecido aparece com o nome CRU, nao escondido", () => {
    // Unidade retida por motivo novo continua retida — sumir seria pior.
    const t = traduzirStatusIndisponivel("motivo_novo_do_ml");
    expect(t.label).toContain("motivo_novo_do_ml");
    expect(t.perda).toBe(false);
  });

  it("status vazio nao quebra", () => {
    expect(traduzirStatusIndisponivel("").label).toMatch(/não informado/i);
  });
});

describe("separacao entre perda e transito", () => {
  const linhas = [
    { status: "transfer", qtd: 10 },
    { status: "damaged", qtd: 3 },
    { status: "internal_process", qtd: 5 },
    { status: "lost", qtd: 2 },
  ];

  it("perda soma so avaria e extravio", () => {
    expect(unidadesComPerda(linhas)).toBe(5);
  });

  it("transito soma o que volta a vender sozinho", () => {
    expect(unidadesEmTransito(linhas)).toBe(15);
  });

  it("as duas somadas dao o total retido — nada some da conta", () => {
    const total = linhas.reduce((s, l) => s + l.qtd, 0);
    expect(unidadesComPerda(linhas) + unidadesEmTransito(linhas)).toBe(total);
  });

  it("lista vazia da zero nos dois", () => {
    expect(unidadesComPerda([])).toBe(0);
    expect(unidadesEmTransito([])).toBe(0);
  });
});

describe("valorRetido — o tamanho do problema em dinheiro", () => {
  it("multiplica pelo custo medio", () => {
    expect(valorRetido(12, 13.81)).toBeCloseTo(165.72, 2);
  });

  it("entradas negativas viram zero, nunca credito", () => {
    expect(valorRetido(-5, 10)).toBe(0);
    expect(valorRetido(5, -10)).toBe(0);
  });

  it("sem custo cadastrado o valor e zero, nao NaN", () => {
    expect(valorRetido(5, 0)).toBe(0);
  });
});
