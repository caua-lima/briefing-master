import { describe, expect, it } from "vitest";
import { estimateOrderFinance, type OrderFinanceItem, type ProdutoCusto } from "./order-finance";

const HOJE = "2026-08-10";

describe("estimateOrderFinance — CMV, imposto e margem de UM pedido no momento em que chega", () => {
  it("pedido de 1 item, produto vinculado: CMV/imposto/taxa descontam certo do bruto", () => {
    const items: OrderFinanceItem[] = [
      { item_id: "MLB111", sku: "sku1", title: "Produto A", quantity: 2, unit_price: 50, sale_fee: 5 },
    ];
    const porMlb = new Map<string, ProdutoCusto>([["111", { custo: 10, imposto: 8 }]]);
    const r = estimateOrderFinance(items, porMlb, new Map(), 0, HOJE, null);

    // grossAmount = 50×2 = 100
    expect(r.grossAmount).toBe(100);
    // cmv = 10×2 = 20 | taxaML = 5×2 = 10 | imposto = 100 × 8% = 8 | frete = 0
    // lucro = 100 - 20 - 10 - 8 - 0 = 62
    expect(r.estimatedProfit).toBe(62);
    expect(r.estimatedMargin).toBeCloseTo(62, 5); // 62% sobre 100 de receita
  });

  it("regra inegociável: CMV vem do custo médio ponderado do produto vinculado, não de um valor arbitrário", () => {
    const items: OrderFinanceItem[] = [{ item_id: "MLB1", quantity: 3, unit_price: 30, sale_fee: 0 }];
    const porMlb = new Map<string, ProdutoCusto>([["1", { custo: 7.5 }]]); // custo médio ponderado já calculado alhures
    const r = estimateOrderFinance(items, porMlb, new Map(), 0, HOJE, null);
    // cmv = 7.5 × 3 = 22.5, lucro = 90 - 22.5 = 67.5 (sem taxa/imposto/frete)
    expect(r.estimatedProfit).toBe(67.5);
  });

  it("QUALQUER item sem produto vinculado torna o pedido INTEIRO indisponível — nunca mistura custo conhecido com desconhecido", () => {
    const items: OrderFinanceItem[] = [
      { item_id: "MLB1", quantity: 1, unit_price: 50 },
      { item_id: "MLB2", quantity: 1, unit_price: 30 }, // sem vínculo
    ];
    const porMlb = new Map<string, ProdutoCusto>([["1", { custo: 10 }]]); // só o MLB1 está cadastrado
    const r = estimateOrderFinance(items, porMlb, new Map(), 0, HOJE, null);

    expect(r.estimatedProfit).toBeNull();
    expect(r.estimatedMargin).toBeNull();
    // regra "nunca mostrar R$0,00 pra dado desconhecido": profit é null, não 0
    expect(r.estimatedProfit).not.toBe(0);
  });

  it("pedido sem nenhum item vira indisponível, não lucro 0", () => {
    const r = estimateOrderFinance([], new Map(), new Map(), 0, HOJE, null);
    expect(r.estimatedProfit).toBeNull();
    expect(r.grossAmount).toBe(0);
  });

  it("frete AUSENTE (ainda não sincronizado) não derruba pra indisponível — vira 0, mesma tolerância do resto do app", () => {
    const items: OrderFinanceItem[] = [{ item_id: "MLB1", quantity: 1, unit_price: 100 }];
    const porMlb = new Map<string, ProdutoCusto>([["1", { custo: 20 }]]);
    const r = estimateOrderFinance(items, porMlb, new Map(), null, HOJE, null); // shippingCost = null
    expect(r.estimatedProfit).toBe(80); // 100 - 20 - 0 (frete tratado como 0, não bloqueia o cálculo)
  });

  it("vínculo por SKU funciona quando não há MLB casado", () => {
    const items: OrderFinanceItem[] = [{ sku: "ABC-123", quantity: 1, unit_price: 40 }];
    const porSku = new Map<string, ProdutoCusto>([["abc-123", { custo: 15 }]]); // normalizado lowercase
    const r = estimateOrderFinance(items, new Map(), porSku, 0, HOJE, null);
    expect(r.estimatedProfit).toBe(25);
  });

  it("imposto respeita a faixa vigente NA DATA DA VENDA (imposto histórico), não a alíquota atual", () => {
    const items: OrderFinanceItem[] = [{ item_id: "MLB1", quantity: 1, unit_price: 100 }];
    const produtoComFaixas: ProdutoCusto = {
      custo: 0,
      impostoFaixas: [
        { desde: "2020-01-01", pct: 4 },
        { desde: "2027-01-01", pct: 20 }, // só passa a valer no futuro
      ],
    };
    const porMlb = new Map<string, ProdutoCusto>([["1", produtoComFaixas]]);
    const r = estimateOrderFinance(items, porMlb, new Map(), 0, "2026-06-01", null);
    // venda em 2026-06: só a faixa de 2020 já valia (4%), não a de 2027 (20%)
    expect(r.estimatedProfit).toBe(96); // 100 - 0 (cmv) - 4 (imposto 4%)
  });

  it("múltiplos itens: productName é do primeiro, itemCount conta itens distintos (não soma quantidade)", () => {
    const items: OrderFinanceItem[] = [
      { item_id: "MLB1", title: "Primeiro produto", quantity: 3, unit_price: 10 },
      { item_id: "MLB2", title: "Segundo produto", quantity: 1, unit_price: 20 },
    ];
    const porMlb = new Map<string, ProdutoCusto>([
      ["1", { custo: 1 }],
      ["2", { custo: 1 }],
    ]);
    const r = estimateOrderFinance(items, porMlb, new Map(), 0, HOJE, null);
    expect(r.productName).toBe("Primeiro produto");
    expect(r.itemCount).toBe(2);
    expect(r.quantityTotal).toBe(4); // 3 + 1
  });
});
