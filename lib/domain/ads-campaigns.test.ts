import { describe, expect, it } from "vitest";
import { agregarPorCampanha, CAMPANHA_SEM_ID, type ItemParaCampanha } from "./ads-campaigns";

function item(over: Partial<ItemParaCampanha> = {}): ItemParaCampanha {
  return {
    campaignId: "c1", campaignName: "Campanha 1",
    clicks: 10, prints: 100, cost: 50,
    directSales: 200, directUnits: 2,
    totalSales: 400, totalUnits: 4,
    lucroLiquido: 80, lucroDiretoLiquido: 40,
    diretoDisponivel: true,
    ...over,
  };
}

describe("agregarPorCampanha", () => {
  it("sem itens, lista vazia", () => {
    expect(agregarPorCampanha([], "geral")).toEqual([]);
  });

  it("soma anúncios da mesma campanha", () => {
    const r = agregarPorCampanha([item(), item()], "geral");
    expect(r).toHaveLength(1);
    expect(r[0].anuncios).toBe(2);
    expect(r[0].cost).toBe(100);
    expect(r[0].clicks).toBe(20);
    expect(r[0].receita).toBe(800);
  });

  it("separa campanhas diferentes e ordena pelo maior investimento", () => {
    const r = agregarPorCampanha([
      item({ campaignId: "pequena", cost: 10 }),
      item({ campaignId: "grande", cost: 900 }),
    ], "geral");
    expect(r.map((c) => c.campaignId)).toEqual(["grande", "pequena"]);
  });

  it("modo pub usa venda direta; modo geral usa venda total", () => {
    const pub = agregarPorCampanha([item()], "pub")[0];
    const geral = agregarPorCampanha([item()], "geral")[0];
    expect(pub.receita).toBe(200);
    expect(geral.receita).toBe(400);
    expect(pub.lucroAposAds).toBe(40);
    expect(geral.lucroAposAds).toBe(80);
  });

  it("modo pub sem NENHUMA venda vinculada deixa lucro null, nao zero", () => {
    const r = agregarPorCampanha([item({ diretoDisponivel: false })], "pub")[0];
    expect(r.lucroAposAds).toBeNull();
  });

  it("modo pub soma so quem tem venda vinculada, sem puxar o lucro pra baixo com zeros", () => {
    const r = agregarPorCampanha([
      item({ diretoDisponivel: true, lucroDiretoLiquido: 100 }),
      item({ diretoDisponivel: false, lucroDiretoLiquido: 0 }),
    ], "pub")[0];
    expect(r.lucroAposAds).toBe(100);
  });

  it("ROAS = receita / investido; ACOS = investido / receita", () => {
    const r = agregarPorCampanha([item({ cost: 100, totalSales: 500 })], "geral")[0];
    expect(r.roas).toBe(5);
    expect(r.acos).toBeCloseTo(20, 5);
  });

  it("sem investimento, ROAS indefinido (null) em vez de divisao por zero", () => {
    const r = agregarPorCampanha([item({ cost: 0 })], "geral")[0];
    expect(r.roas).toBeNull();
  });

  it("sem receita, ACOS indefinido (null) em vez de infinito", () => {
    const r = agregarPorCampanha([item({ totalSales: 0 })], "geral")[0];
    expect(r.acos).toBeNull();
  });

  it("anuncio sem campanha vai pro grupo proprio, sem sumir da soma", () => {
    const r = agregarPorCampanha([item({ campaignId: "", campaignName: "" })], "geral");
    expect(r[0].campaignId).toBe(CAMPANHA_SEM_ID);
    expect(r[0].campaignName).toBe("Sem campanha identificada");
  });
});
