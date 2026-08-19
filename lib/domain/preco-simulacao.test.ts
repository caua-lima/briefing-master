import { describe, expect, it } from "vitest";
import { precoParaMargem, simularPreco, type EntradaSimulacao } from "./preco-simulacao";

function base(over: Partial<EntradaSimulacao> = {}): EntradaSimulacao {
  return { preco: 100, comissao: 14, frete: 8.55, custo: 40, impostoPct: 8, ...over };
}

describe("simularPreco — a conta que decide o preço", () => {
  it("bate com a conta feita a mão", () => {
    // 100 − 14 (comissão) − 8,55 (frete) = 77,45 de repasse
    // 77,45 − 40 (custo) − 8 (imposto 8%) = 29,45 de lucro
    const r = simularPreco(base());
    expect(r.repasse).toBeCloseTo(77.45, 2);
    expect(r.imposto).toBeCloseTo(8, 2);
    expect(r.lucro).toBeCloseTo(29.45, 2);
    expect(r.margem).toBeCloseTo(29.45, 2);
  });

  it("markup mede retorno sobre o CUSTO, não sobre a venda", () => {
    // 29,45 de lucro sobre 40 de custo = 73,6%
    expect(simularPreco(base()).markup).toBeCloseTo(73.63, 1);
  });

  it("ads e outros custos entram quando informados", () => {
    const semAds = simularPreco(base());
    const comAds = simularPreco(base({ adsPorUnidade: 5, outrosPorUnidade: 2 }));
    expect(comAds.lucro).toBeCloseTo(semAds.lucro - 7, 2);
  });

  it("ads ausente NÃO é estimado — fica zero, não um chute", () => {
    const r = simularPreco(base());
    expect(r.ads).toBe(0);
    expect(r.outros).toBe(0);
  });

  it("prejuízo aparece como negativo, não é escondido em zero", () => {
    const r = simularPreco(base({ preco: 45 }));
    expect(r.lucro).toBeLessThan(0);
    expect(r.margem).toBeLessThan(0);
  });

  it("sem custo cadastrado, markup é 0 e não Infinity", () => {
    // Divisão por zero viraria "Infinity%" na tela — 0 comunica melhor.
    const r = simularPreco(base({ custo: 0 }));
    expect(Number.isFinite(r.markup)).toBe(true);
    expect(r.markup).toBe(0);
  });

  it("preço zero não quebra a margem (divisão por zero)", () => {
    const r = simularPreco(base({ preco: 0 }));
    expect(Number.isFinite(r.margem)).toBe(true);
    expect(r.margem).toBe(0);
  });

  it("valores negativos de entrada são tratados como zero", () => {
    const r = simularPreco(base({ frete: -10, custo: -5, impostoPct: -8 }));
    expect(r.frete).toBe(0);
    expect(r.custo).toBe(0);
    expect(r.imposto).toBe(0);
  });

  it("frete zero (comprador paga) melhora o lucro exatamente pelo valor do frete", () => {
    const comFrete = simularPreco(base());
    const semFrete = simularPreco(base({ frete: 0 }));
    expect(semFrete.lucro).toBeCloseTo(comFrete.lucro + 8.55, 2);
  });
});

describe("precoParaMargem — busca binária porque a comissão não é linear", () => {
  // Espelha o comportamento REAL medido na API: 14% até 200, 11% acima —
  // é justamente o degrau que impede resolver isso por álgebra.
  const comissaoEscalonada = async (p: number) => (p > 200 ? p * 0.11 : p * 0.14);

  it("encontra o preço que entrega a margem pedida", async () => {
    const p = await precoParaMargem(20, { frete: 8.55, custo: 40, impostoPct: 8 }, comissaoEscalonada);
    expect(p).not.toBeNull();
    const r = simularPreco({ preco: p!, comissao: await comissaoEscalonada(p!), frete: 8.55, custo: 40, impostoPct: 8 });
    expect(r.margem).toBeGreaterThanOrEqual(20);
  });

  it("o preço encontrado é o MENOR que serve — 1 centavo abaixo já não atinge", async () => {
    const p = await precoParaMargem(20, { frete: 8.55, custo: 40, impostoPct: 8 }, comissaoEscalonada);
    const abaixo = p! - 0.02;
    const r = simularPreco({ preco: abaixo, comissao: await comissaoEscalonada(abaixo), frete: 8.55, custo: 40, impostoPct: 8 });
    expect(r.margem).toBeLessThan(20);
  });

  it("atravessa o degrau de comissão sem se perder", async () => {
    // Margem alta o bastante pra forçar preço na faixa dos 11%.
    const p = await precoParaMargem(40, { frete: 8.55, custo: 40, impostoPct: 8 }, comissaoEscalonada);
    expect(p).not.toBeNull();
    const r = simularPreco({ preco: p!, comissao: await comissaoEscalonada(p!), frete: 8.55, custo: 40, impostoPct: 8 });
    expect(r.margem).toBeGreaterThanOrEqual(40);
  });

  it("margem impossível devolve null, não um preço que não se sustenta", async () => {
    // Comissão 14% + imposto 8% = 22% do preço já vão embora; 90% é inalcançável.
    const p = await precoParaMargem(90, { frete: 8.55, custo: 40, impostoPct: 8 }, comissaoEscalonada, { max: 10000 });
    expect(p).toBeNull();
  });

  it("arredonda pra CIMA no centavo — pra baixo ficaria abaixo da meta", async () => {
    const p = await precoParaMargem(25, { frete: 8.55, custo: 40, impostoPct: 8 }, comissaoEscalonada);
    expect(p).toBe(Math.ceil(p! * 100) / 100);
  });
});
