import { describe, expect, it } from "vitest";
import {
  clamp,
  computeAd,
  computeSummary,
  emptyListing,
  getMarginStatus,
  isFullMonth,
  parseBRNumber,
  prevPeriod,
  projetarMes,
  scenariosDeProjecao,
  totalCustosDia,
  totalCustosMes,
} from "./calc";
import type { Cost, Listing } from "./types";

describe("parseBRNumber", () => {
  it("aceita vírgula como separador decimal (pt-BR)", () => {
    expect(parseBRNumber("10,50")).toBe(10.5);
  });

  it("aceita ponto como separador de milhar + vírgula decimal", () => {
    expect(parseBRNumber("1.234,56")).toBe(1234.56);
  });

  it("aceita ponto como decimal quando não há vírgula (input já normalizado)", () => {
    expect(parseBRNumber("10.5")).toBe(10.5);
  });

  it("string vazia, null e undefined viram 0 — nunca NaN", () => {
    expect(parseBRNumber("")).toBe(0);
    expect(parseBRNumber(null)).toBe(0);
    expect(parseBRNumber(undefined)).toBe(0);
  });

  it("lixo não numérico vira 0, não NaN — regra 'nunca mostrar NaN'", () => {
    expect(parseBRNumber("abc")).toBe(0);
    expect(Number.isNaN(parseBRNumber("abc"))).toBe(false);
  });
});

describe("computeAd — cálculo financeiro por anúncio (Fase 2 do dashboard antigo)", () => {
  function listing(over: Partial<Listing> = {}): Listing {
    return { ...emptyListing(), name: "Produto X", preco: "50", retorno: "45", custo: "20", vendas: "10", ads: "30", ...over };
  }

  it("faturamento = preço × vendas (bruto, não o retorno)", () => {
    const r = computeAd(listing());
    expect(r.faturamento).toBe(500); // 50 × 10
  });

  it("cmv = custo × vendas", () => {
    const r = computeAd(listing());
    expect(r.cmv).toBe(200); // 20 × 10
  });

  it("bruto = retorno×vendas − cmv, líquido = bruto − ads", () => {
    const r = computeAd(listing());
    expect(r.bruto).toBe(250); // 45×10 − 200
    expect(r.liquido).toBe(220); // 250 − 30
  });

  it("margem é sobre o FATURAMENTO (preço cheio), não sobre o retorno", () => {
    const r = computeAd(listing());
    expect(r.margem).toBeCloseTo((220 / 500) * 100, 5); // 44%
  });

  it("sem venda nenhuma, margem e ROAS não dividem por zero", () => {
    const r = computeAd(listing({ vendas: "0", ads: "0" }));
    expect(r.margem).toBe(0);
    expect(r.roas).toBeNull(); // sem investimento em ads, ROAS é null, não Infinity/0 enganoso
  });

  it("nome vazio cai pro rótulo padrão, nunca string vazia na tela", () => {
    const r = computeAd(listing({ name: "  " }));
    expect(r.name).toBe("Sem nome");
  });
});

describe("computeSummary — soma consistente com computeAd por linha", () => {
  it("totais batem com a soma manual das linhas", () => {
    const linhas: Listing[] = [
      { ...emptyListing(), name: "A", preco: "10", retorno: "9", custo: "3", vendas: "5", ads: "5" },
      { ...emptyListing(), name: "B", preco: "20", retorno: "18", custo: "8", vendas: "2", ads: "0" },
    ];
    const s = computeSummary(linhas);
    // A: fat=50 cmv=15 bruto=45-15=30 liq=25 | B: fat=40 cmv=16 bruto=36-16=20 liq=20
    expect(s.totalFaturamento).toBe(90);
    expect(s.totalCMV).toBe(31);
    expect(s.totalBruto).toBe(50);
    expect(s.totalLiquido).toBe(45);
    expect(s.totalAds).toBe(5);
  });
});

describe("totalCustosDia / totalCustosMes — regra de negócio: custo diário multiplica pelos dias do mês", () => {
  const custos: Cost[] = [
    { id: "1", nome: "Aluguel", valor: "1000", freq: "mensal", data: "" },
    { id: "2", nome: "Embalagem", valor: "10", freq: "diario", data: "" },
    { id: "3", nome: "Ferramenta pontual", valor: "50", freq: "avulso", data: "2026-08-05" },
    { id: "4", nome: "Avulso de outro mês", valor: "999", freq: "avulso", data: "2026-07-05" },
  ];

  it("dia específico: só diário sempre conta + avulso SE for daquele dia exato", () => {
    expect(totalCustosDia(custos, "2026-08-05")).toBe(10 + 50);
    expect(totalCustosDia(custos, "2026-08-06")).toBe(10); // avulso não conta em outro dia
  });

  it("mês inteiro: mensal conta uma vez, diário × dias do mês, avulso só do mês certo", () => {
    // agosto/2026 tem 31 dias
    const total = totalCustosMes(custos, "2026-08");
    expect(total).toBe(1000 + 10 * 31 + 50);
  });

  it("custo avulso de OUTRO mês nunca contamina o total (regra: nunca inventar dado)", () => {
    // agosto não inclui os 999 do avulso de julho (já provado no teste acima);
    // julho tem 31 dias também, então o diário multiplica igual, só muda o avulso
    expect(totalCustosMes(custos, "2026-07")).toBe(1000 + 10 * 31 + 999);
  });
});

describe("projetarMes / scenariosDeProjecao — nunca dividir por zero, cenários derivam do mesmo número", () => {
  it("projeção linear simples: ritmo do dia atual × dias do mês", () => {
    expect(projetarMes(1000, 10, 30)).toBe(3000); // R$100/dia × 30 dias
  });

  it("dia 0 (mês não começou) retorna 0, não Infinity/NaN", () => {
    expect(projetarMes(1000, 0, 30)).toBe(0);
    expect(projetarMes(1000, -1, 30)).toBe(0);
  });

  it("cenários conservador/agressivo são ±15% do mesmo valor esperado, nunca cruzam", () => {
    const c = scenariosDeProjecao(1000, 10, 30);
    expect(c.esperado).toBe(3000);
    expect(c.conservador).toBeCloseTo(2550, 5);
    expect(c.agressivo).toBeCloseTo(3450, 5);
    expect(c.conservador).toBeLessThan(c.esperado);
    expect(c.agressivo).toBeGreaterThan(c.esperado);
  });
});

describe("getMarginStatus — classificação de margem (mesma regra usada em Pedidos e Ads)", () => {
  it("negativa é sempre prejuízo, mesmo com meta baixa", () => {
    expect(getMarginStatus(-0.01, 0)).toBe("prejuizo");
  });

  it("acima ou igual à meta é saudável", () => {
    expect(getMarginStatus(10, 10)).toBe("saudavel");
    expect(getMarginStatus(15, 10)).toBe("saudavel");
  });

  it("positiva mas abaixo da meta é atenção, não prejuízo", () => {
    expect(getMarginStatus(5, 10)).toBe("atencao");
  });
});

describe("isFullMonth / prevPeriod — comparação de período (bug real corrigido nesta base: mês em andamento vs mês anterior INTEIRO)", () => {
  it("mês civil completo é reconhecido", () => {
    expect(isFullMonth("2026-08-01", "2026-08-31")).toBe(true);
    expect(isFullMonth("2026-02-01", "2026-02-28")).toBe(true); // fev não-bissexto
  });

  it("período parcial não é mês completo", () => {
    expect(isFullMonth("2026-08-01", "2026-08-15")).toBe(false);
    expect(isFullMonth("2026-08-05", "2026-08-31")).toBe(false);
  });

  it("mês fechado anterior compara com o mês civil anterior inteiro", () => {
    // to < hoje (mês já fechado por completo)
    const p = prevPeriod("2026-06-01", "2026-06-30");
    expect(p).toEqual({ from: "2026-05-01", to: "2026-05-31" });
  });

  it("range livre (não mês completo) desloca a janela pelo mesmo tamanho", () => {
    const p = prevPeriod("2026-08-10", "2026-08-16"); // 7 dias
    expect(p).toEqual({ from: "2026-08-03", to: "2026-08-09" });
  });
});

describe("clamp", () => {
  it("segura o valor dentro do intervalo", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
  });
});
