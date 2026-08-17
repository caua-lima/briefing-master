import { describe, expect, it } from "vitest";
import { buildSaleContent } from "./notifications";

const base = {
  type: "sale_paid" as const,
  productName: "Erva Mate", itemCount: 1,
  grossAmount: 89.9, metaMargem: null,
};

describe("buildSaleContent — venda sem produto cadastrado", () => {
  it("diz o que houve e por que o numero esta errado", () => {
    const c = buildSaleContent({
      ...base, estimatedProfit: null, estimatedMargin: null, semCadastro: true,
    });
    expect(c.title).toBe("Venda de produto sem cadastro");
    expect(c.body).toContain("lucro está inflado");
  });

  it("sem cadastro NAO e o mesmo que calculo pendente", () => {
    // Dado que vai chegar sozinho vs. dado que so chega se alguem cadastrar:
    // a acao do usuario e diferente, entao o texto tem que ser diferente.
    const pendente = buildSaleContent({
      ...base, estimatedProfit: null, estimatedMargin: null, semCadastro: false,
    });
    expect(pendente.title).toBe("Nova venda confirmada");
    expect(pendente.body).toContain("em atualização");
  });

  it("venda normal com lucro nao e afetada pela flag", () => {
    const c = buildSaleContent({
      ...base, estimatedProfit: 20, estimatedMargin: 22, semCadastro: false,
    });
    expect(c.title).toBe("Nova venda confirmada");
  });
});

describe("buildSaleContent — pedido com mais de um produto", () => {
  it("2 itens nomeia os dois, nao fala 'itens no pedido'", () => {
    const c = buildSaleContent({
      ...base, itemCount: 2, estimatedProfit: 20, estimatedMargin: 22,
      itens: [{ title: "Erva Mate", quantity: 1 }, { title: "Cuia de vidro", quantity: 1 }],
    });
    expect(c.body).toContain("Erva Mate e Cuia de vidro");
  });

  it("3+ itens nomeia o primeiro e conta o resto", () => {
    const c = buildSaleContent({
      ...base, itemCount: 3, estimatedProfit: 20, estimatedMargin: 22,
      itens: [{ title: "Erva Mate", quantity: 1 }, { title: "Cuia", quantity: 1 }, { title: "Bomba", quantity: 1 }],
    });
    expect(c.body).toContain("Erva Mate e outros 2");
  });

  it("sem detalhe de itens, cai no texto antigo — nunca quebra", () => {
    const c = buildSaleContent({ ...base, itemCount: 4, estimatedProfit: 20, estimatedMargin: 22 });
    expect(c.body).toContain("4 itens no pedido");
  });
});
