import { describe, expect, it } from "vitest";
import { montarResumoDiario, type ResumoDiarioInput } from "./resumo-diario";

function base(over: Partial<ResumoDiarioInput> = {}): ResumoDiarioInput {
  return {
    faturamento: 1000, pedidos: 8, lucro: 150, margem: 15,
    metaDiaria: null, produtosEmRisco: 0, anunciosNoPrejuizo: 0,
    ...over,
  };
}

describe("montarResumoDiario", () => {
  it("dia sem venda tem titulo proprio, nao 'R$ 0,00 em 0 vendas'", () => {
    const r = montarResumoDiario(base({ faturamento: 0, pedidos: 0, lucro: null, margem: null }));
    expect(r.title).toBe("Dia sem vendas");
    expect(r.body).toBe("Nenhuma movimentação hoje.");
  });

  it("uma venda usa singular", () => {
    expect(montarResumoDiario(base({ pedidos: 1 })).title).toContain("1 venda");
  });

  it("lucro indisponivel e DITO, nunca vira R$ 0,00", () => {
    const r = montarResumoDiario(base({ lucro: null, margem: null }));
    expect(r.body).toContain("ainda não calculável");
    expect(r.body).not.toContain("R$ 0,00");
  });

  it("meta batida e meta parcial tem textos diferentes", () => {
    expect(montarResumoDiario(base({ faturamento: 1000, metaDiaria: 800 })).body).toContain("batida");
    expect(montarResumoDiario(base({ faturamento: 400, metaDiaria: 800 })).body).toContain("50% da meta");
  });

  it("meta zero nao entra (divisao por zero)", () => {
    const r = montarResumoDiario(base({ metaDiaria: 0 }));
    expect(r.body).not.toContain("meta");
  });

  it("alertas so aparecem quando existem", () => {
    const semAlerta = montarResumoDiario(base());
    expect(semAlerta.body).not.toContain("risco");
    expect(semAlerta.body).not.toContain("break-even");

    const comAlerta = montarResumoDiario(base({ produtosEmRisco: 2, anunciosNoPrejuizo: 3 }));
    expect(comAlerta.body).toContain("2 produto(s) em risco");
    expect(comAlerta.body).toContain("3 anúncio(s) abaixo do break-even");
  });
});
