import { describe, expect, it } from "vitest";
import { calcularLucroEstoque, medirTaxas, type FinanceiroProduto } from "./estoque-lucro";

function realizado(over: Partial<FinanceiroProduto> = {}): FinanceiroProduto {
  // 10 un a R$100 = R$1.000 de receita, R$140 de comissão (14%), R$85,50 de frete
  return { receita: 1000, taxaML: 140, frete: 85.5, unidades: 10, ...over };
}

describe("medirTaxas — taxa vem do realizado, não de fórmula", () => {
  it("extrai a comissão efetiva e o frete por unidade", () => {
    const t = medirTaxas(realizado())!;
    expect(t.comissaoPct).toBeCloseTo(0.14, 4);
    expect(t.fretePorUnidade).toBeCloseTo(8.55, 2);
  });

  it("produto sem venda no período NÃO tem taxa medida", () => {
    expect(medirTaxas(undefined)).toBeNull();
    expect(medirTaxas(realizado({ receita: 0, unidades: 0 }))).toBeNull();
  });

  it("receita zero com unidades > 0 também é indefinido, não 0%", () => {
    // Brinde/erro de cadastro: dividir por zero daria Infinity ou NaN na tela.
    expect(medirTaxas(realizado({ receita: 0 }))).toBeNull();
  });
});

describe("calcularLucroEstoque — a conta que diz se vale segurar estoque", () => {
  const taxas = medirTaxas(realizado());

  it("bate com a conta feita a mão", () => {
    // 100 − 14 (comissão) − 8,55 (frete) − 40 (custo) − 8 (imposto 8%) = 29,45
    const r = calcularLucroEstoque({ preco: 100, custo: 40, impostoPct: 8, unidades: 30, taxas })!;
    expect(r.lucroUnitario).toBeCloseTo(29.45, 2);
    expect(r.lucroTotal).toBeCloseTo(883.5, 2);
    expect(r.margem).toBeCloseTo(29.45, 2);
    expect(r.receitaPotencial).toBeCloseTo(3000, 2);
  });

  it("é a MESMA fórmula de simularPreco — divergir quebraria a promessa da tela", async () => {
    const { simularPreco } = await import("./preco-simulacao");
    const sim = simularPreco({ preco: 100, comissao: 14, frete: 8.55, custo: 40, impostoPct: 8 });
    const est = calcularLucroEstoque({ preco: 100, custo: 40, impostoPct: 8, unidades: 1, taxas })!;
    expect(est.lucroUnitario).toBeCloseTo(sim.lucro, 2);
    expect(est.margem).toBeCloseTo(sim.margem, 2);
  });

  it("sem taxa medida devolve null — não inventa lucro", () => {
    expect(calcularLucroEstoque({ preco: 100, custo: 40, impostoPct: 8, unidades: 30, taxas: null })).toBeNull();
  });

  it("sem preço de anúncio devolve null, não R$ 0", () => {
    expect(calcularLucroEstoque({ preco: 0, custo: 40, impostoPct: 8, unidades: 30, taxas })).toBeNull();
  });

  it("prejuízo aparece negativo — é o alerta que justifica a tela", () => {
    const r = calcularLucroEstoque({ preco: 50, custo: 45, impostoPct: 8, unidades: 20, taxas })!;
    expect(r.lucroUnitario).toBeLessThan(0);
    expect(r.lucroTotal).toBeLessThan(0);
    expect(r.margem).toBeLessThan(0);
  });

  it("estoque zerado: lucro unitário existe, total é zero", () => {
    // Serve pra decidir preço mesmo sem estoque — só não há o que realizar.
    const r = calcularLucroEstoque({ preco: 100, custo: 40, impostoPct: 8, unidades: 0, taxas })!;
    expect(r.lucroUnitario).toBeCloseTo(29.45, 2);
    expect(r.lucroTotal).toBe(0);
  });

  it("entradas negativas são tratadas como zero", () => {
    const r = calcularLucroEstoque({
      preco: 100, custo: -40, impostoPct: -8, unidades: -5,
      taxas: { comissaoPct: -0.1, fretePorUnidade: -3 },
    })!;
    expect(r.lucroUnitario).toBeCloseTo(100, 2);
    expect(r.lucroTotal).toBe(0);
  });
});
