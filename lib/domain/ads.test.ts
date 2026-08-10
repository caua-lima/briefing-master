import { describe, expect, it } from "vitest";
import {
  buildAdItem,
  calculateBreakEvenRoas,
  getAdRecommendation,
  isNaoVenda,
  normId,
  normSku,
  reconciliarConta,
  sortAdItems,
  statusLabel,
  vendasPorItem,
  type ProdutoData,
  type VendaItem,
} from "./ads";

describe("normId / normSku", () => {
  it("normId remove o prefixo MLB e maiuscula", () => {
    expect(normId("mlb123")).toBe("123");
    expect(normId(" MLB456 ")).toBe("456");
  });
  it("normSku so tira espaco e minuscula", () => {
    expect(normSku(" ABC-1 ")).toBe("abc-1");
  });
});

describe("isNaoVenda", () => {
  it("cancelled e invalid nao contam como venda", () => {
    expect(isNaoVenda("cancelled")).toBe(true);
    expect(isNaoVenda("INVALID")).toBe(true);
  });
  it("paid conta como venda", () => {
    expect(isNaoVenda("paid")).toBe(false);
  });
});

describe("vendasPorItem", () => {
  const porMlb = new Map<string, ProdutoData>([["1", { custo: 10, imposto: 5 }]]);
  const porSku = new Map<string, ProdutoData>();

  it("soma receita/unidades/cmv/imposto/taxaML/envio por item", () => {
    const orders = [
      {
        order_id: "o1", status: "paid", shipping_cost: 20,
        items: [{ item_id: "MLB1", quantity: 2, unit_price: 50, sale_fee: 5 }],
      },
    ];
    const m = vendasPorItem(orders, porMlb, porSku, new Set(), new Set());
    const v = m.get("MLB1")!;
    expect(v.receita).toBe(100);
    expect(v.unidades).toBe(2);
    expect(v.cmv).toBe(20); // 10 * 2
    expect(v.imposto).toBe(5); // 100 * 5%
    expect(v.taxaML).toBe(10); // 5 * 2
    expect(v.envio).toBe(20); // frete todo pra unica linha
  });

  it("exclui pedido cancelado, mesmo com status pago", () => {
    const orders = [
      { order_id: "o1", status: "paid", items: [{ item_id: "MLB1", quantity: 1, unit_price: 10 }] },
    ];
    const m = vendasPorItem(orders, porMlb, porSku, new Set(["o1"]), new Set());
    expect(m.size).toBe(0);
  });

  it("exclui pedido com devolucao registrada", () => {
    const orders = [
      { order_id: "o1", status: "paid", items: [{ item_id: "MLB1", quantity: 1, unit_price: 10 }] },
    ];
    const m = vendasPorItem(orders, porMlb, porSku, new Set(), new Set(["o1"]));
    expect(m.size).toBe(0);
  });

  it("exclui status cancelled/invalid mesmo sem estar nos sets de retorno", () => {
    const orders = [
      { order_id: "o1", status: "cancelled", items: [{ item_id: "MLB1", quantity: 1, unit_price: 10 }] },
    ];
    const m = vendasPorItem(orders, porMlb, porSku, new Set(), new Set());
    expect(m.size).toBe(0);
  });
});

describe("statusLabel", () => {
  it("sem campaignId vira sem_campanha", () => {
    expect(statusLabel("", "active")).toBe("sem_campanha");
  });
  it("campanha active vira ativo", () => {
    expect(statusLabel("c1", "active")).toBe("ativo");
  });
  it("campanha paused vira pausado", () => {
    expect(statusLabel("c1", "paused")).toBe("pausado");
  });
  it("tem campaignId mas status desconhecido vira config_indisponivel", () => {
    expect(statusLabel("c1", "")).toBe("config_indisponivel");
  });
});

describe("buildAdItem", () => {
  const metric = { itemId: "MLB1", title: "Produto", clicks: 10, prints: 100, cost: 30, directSales: 50, directUnits: 1, sales: 60, units: 2 };

  it("com venda vinculada, calcula lucro geral e direto proporcional a margem", () => {
    const v: VendaItem = { receita: 100, unidades: 2, cmv: 20, imposto: 5, taxaML: 10, envio: 5 };
    const item = buildAdItem(metric, v, { campaignId: "c1", status: "active" }, "active");
    // lucroAntesAds = 100 - 20 - 5 - 10 - 5 = 60
    expect(item.lucroAntesAds).toBe(60);
    expect(item.lucroLiquido).toBe(30); // 60 - 30 (cost)
    expect(item.diretoDisponivel).toBe(true);
    // margem = 60/100 = 0.6; lucroDiretoAntesAds = 50 * 0.6 = 30; liquido = 30 - 30 = 0
    expect(item.lucroDiretoAntesAds).toBe(30);
    expect(item.lucroDiretoLiquido).toBe(0);
    expect(item.status).toBe("ativo");
  });

  it("sem NENHUMA venda vinculada, diretoDisponivel fica false em vez de virar -100% de prejuizo", () => {
    const v: VendaItem = { receita: 0, unidades: 0, cmv: 0, imposto: 0, taxaML: 0, envio: 0 };
    const item = buildAdItem(metric, v, undefined, "");
    expect(item.diretoDisponivel).toBe(false);
    expect(item.lucroDiretoLiquido).toBe(0); // nao inventa -30 de prejuizo
    expect(item.lucroDiretoAntesAds).toBe(0);
    expect(item.status).toBe("sem_campanha");
  });
});

describe("sortAdItems", () => {
  it("sem_campanha vai pro fim, independente do custo", () => {
    const items = [
      { status: "sem_campanha" as const, cost: 999 },
      { status: "ativo" as const, cost: 10 },
    ];
    const sorted = sortAdItems(items);
    expect(sorted[0].status).toBe("ativo");
    expect(sorted[1].status).toBe("sem_campanha");
  });

  it("dentro do mesmo grupo, maior custo primeiro", () => {
    const items = [
      { status: "ativo" as const, cost: 10 },
      { status: "ativo" as const, cost: 50 },
    ];
    const sorted = sortAdItems(items);
    expect(sorted[0].cost).toBe(50);
    expect(sorted[1].cost).toBe(10);
  });

  it("nao muta o array original", () => {
    const items = [{ status: "ativo" as const, cost: 1 }, { status: "ativo" as const, cost: 2 }];
    const original = [...items];
    sortAdItems(items);
    expect(items).toEqual(original);
  });
});

describe("reconciliarConta", () => {
  it("soma receita/unidades/lucro de TODOS os itens vendidos, nao so anunciados", () => {
    const vendas = new Map<string, VendaItem>([
      ["MLB1", { receita: 100, unidades: 2, cmv: 20, imposto: 5, taxaML: 10, envio: 5 }],
      ["MLB2", { receita: 50, unidades: 1, cmv: 10, imposto: 0, taxaML: 5, envio: 0 }],
    ]);
    const r = reconciliarConta(vendas);
    expect(r.receita).toBe(150);
    expect(r.unidades).toBe(3);
    expect(r.itens).toBe(2);
    expect(r.lucroAntesAds).toBe(60 + 35); // (100-20-5-10-5) + (50-10-0-5-0)
  });

  it("mapa vazio da zero em tudo, nao quebra", () => {
    const r = reconciliarConta(new Map());
    expect(r).toEqual({ receita: 0, unidades: 0, lucroAntesAds: 0, itens: 0 });
  });
});

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

  it("volume baixo (poucos cliques e nenhuma venda) vira sem-dados, mesmo com prejuizo", () => {
    const r = getAdRecommendation({ ...base, clicks: 5, vendas: 0, lucro: -50 });
    expect(r.acao).toBe("sem-dados");
  });

  it("prejuizo com investimento relevante recomenda pausar", () => {
    const r = getAdRecommendation({ ...base, lucro: -10, cost: 50 });
    expect(r.acao).toBe("pausar");
  });

  it("abaixo do alvo E do break-even recomenda reduzir", () => {
    const r = getAdRecommendation({ ...base, lucro: 5, roas: 1, roasTarget: 2, breakEvenRoas: 2 });
    expect(r.acao).toBe("reduzir");
  });

  it("margem e roas saudaveis recomendam escalar", () => {
    const r = getAdRecommendation({ ...base, roas: 5, roasTarget: 2, breakEvenRoas: 2, margem: 25, metaMargem: 10 });
    expect(r.acao).toBe("escalar");
  });
});
