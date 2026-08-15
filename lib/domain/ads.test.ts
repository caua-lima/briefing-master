import { describe, expect, it } from "vitest";
import { calculateBreakEvenRoas, calculateTargetRoas, getAdRecommendation } from "./ads";

describe("calculateBreakEvenRoas", () => {
  it("lucroAntesAds <= 0 nunca tem ROAS que salve — retorna null, nao 0/Infinity", () => {
    expect(calculateBreakEvenRoas(100, 0)).toBeNull();
    expect(calculateBreakEvenRoas(100, -5)).toBeNull();
  });
  it("vendas <= 0 tambem retorna null", () => {
    expect(calculateBreakEvenRoas(0, 50)).toBeNull();
  });
  it("caso normal: vendas / lucroAntesAds", () => {
    expect(calculateBreakEvenRoas(200, 50)).toBe(4);
  });
});

describe("getAdRecommendation", () => {
  const base = { clicks: 100, vendas: 5, cost: 100, lucro: 50, roas: 3, roasTarget: 2, breakEvenRoas: 2, margem: 20, metaMargem: 10 };

  it("saudavel: margem e ROAS acima do alvo/break-even recomenda escalar", () => {
    const r = getAdRecommendation({ ...base, roas: 5, roasTarget: 2, breakEvenRoas: 2, margem: 25, metaMargem: 10 });
    expect(r.acao).toBe("escalar");
    expect(r.tone).toBe("opportunity");
  });

  it("lucro negativo com investimento relevante recomenda revisar/reduzir, nunca a palavra isolada 'Pausar'", () => {
    const r = getAdRecommendation({ ...base, lucro: -10, cost: 50 });
    expect(r.acao).toBe("pausar");
    expect(r.label.toLowerCase()).toContain("revisar");
    expect(r.label).not.toBe("Pausar");
    expect(r.tone).toBe("critical");
  });

  it("gasto sem nenhuma venda, com volume de cliques suficiente, e roas abaixo do alvo/break-even recomenda reduzir", () => {
    const r = getAdRecommendation({ ...base, vendas: 0, lucro: null, roas: 0, roasTarget: 2, breakEvenRoas: 2, margem: null, cost: 40 });
    expect(r.acao).toBe("reduzir");
    expect(r.label.toLowerCase()).toContain("revisar");
  });

  it("baixo volume (poucos cliques e nenhuma venda) vira sem-dados, mesmo com prejuizo", () => {
    const r = getAdRecommendation({ ...base, clicks: 5, vendas: 0, lucro: -50 });
    expect(r.acao).toBe("sem-dados");
    expect(r.tone).toBe("info");
  });

  it("dados insuficientes (lucro null, sem roasTarget nem breakEven) tambem vira sem-dados", () => {
    const r = getAdRecommendation({ ...base, lucro: null, roasTarget: 0, breakEvenRoas: null, margem: null });
    expect(r.acao).toBe("sem-dados");
  });

  it("abaixo do alvo E do break-even recomenda reduzir", () => {
    const r = getAdRecommendation({ ...base, lucro: 5, roas: 1, roasTarget: 2, breakEvenRoas: 2 });
    expect(r.acao).toBe("reduzir");
  });
});

describe("calculateTargetRoas", () => {
  it("com meta 0%, e exatamente o break-even (por construcao)", () => {
    const be = calculateBreakEvenRoas(1000, 250);
    expect(calculateTargetRoas(1000, 250, 0)).toBeCloseTo(be!, 10);
  });

  it("meta de margem exige ROAS MAIOR que o break-even", () => {
    const be = calculateBreakEvenRoas(1000, 250)!;   // 4x
    const alvo = calculateTargetRoas(1000, 250, 10)!; // margem 10%
    expect(alvo).toBeGreaterThan(be);
    // R / (L0 - m*R) = 1000 / (250 - 100) = 6,666...
    expect(alvo).toBeCloseTo(1000 / 150, 6);
  });

  it("produto que nao alcanca a margem nem gastando zero em ads devolve null", () => {
    // L0 = 100 e a meta de 20% sobre 1000 exigiria 200 de lucro: impossivel.
    expect(calculateTargetRoas(1000, 100, 20)).toBeNull();
  });

  it("sem venda ou sem lucro antes de ads, nao ha alvo", () => {
    expect(calculateTargetRoas(0, 250, 10)).toBeNull();
    expect(calculateTargetRoas(1000, 0, 10)).toBeNull();
    expect(calculateTargetRoas(1000, -50, 10)).toBeNull();
  });

  it("meta negativa e tratada como zero, nunca afrouxa abaixo do break-even", () => {
    const be = calculateBreakEvenRoas(1000, 250)!;
    expect(calculateTargetRoas(1000, 250, -30)).toBeCloseTo(be, 10);
  });
});
