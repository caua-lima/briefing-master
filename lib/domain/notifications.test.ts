import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOW_MARGIN_THRESHOLD,
  HIGH_VALUE_SALE_THRESHOLD,
  buildCancelContent,
  buildGroupedSalesContent,
  buildReturnCompletedContent,
  buildSaleContent,
  classifySale,
  taskAssignedDedupeKey,
  type SaleFinanceInput,
} from "./notifications";

function finance(over: Partial<SaleFinanceInput> = {}): SaleFinanceInput {
  return { grossAmount: 100, estimatedProfit: 50, estimatedMargin: 50, metaMargem: null, ...over };
}

describe("classifySale — prioridade da classificação (regra inegociável: nunca esconder prejuízo atrás de celebração)", () => {
  it("dado indisponível vem ANTES de qualquer classificação por valor/margem", () => {
    const r = classifySale(finance({ estimatedProfit: null, estimatedMargin: null, grossAmount: 999 }));
    expect(r.type).toBe("sale_paid");
    expect(r.severity).toBe("info");
  });

  it("lucro negativo é SEMPRE prejuízo, mesmo com valor bruto alto — nunca vira 'alto valor'", () => {
    const r = classifySale(finance({ grossAmount: 500, estimatedProfit: -10, estimatedMargin: -2 }));
    expect(r.type).toBe("sale_negative_margin");
    expect(r.severity).toBe("danger");
  });

  it("margem baixa (mas lucro positivo) prevalece sobre alto valor", () => {
    const r = classifySale(finance({
      grossAmount: HIGH_VALUE_SALE_THRESHOLD + 100,
      estimatedProfit: 5,
      estimatedMargin: DEFAULT_LOW_MARGIN_THRESHOLD - 1,
    }));
    expect(r.type).toBe("sale_low_margin");
  });

  it("margem baixa usa a META do mês quando configurada, não o padrão fixo", () => {
    // margem de 12% seria "saudável" no padrão (8%), mas abaixo da meta de 15% do usuário
    const r = classifySale(finance({ estimatedMargin: 12, metaMargem: 15, grossAmount: 50 }));
    expect(r.type).toBe("sale_low_margin");
  });

  it("alto valor só quando margem está saudável", () => {
    const r = classifySale(finance({ grossAmount: HIGH_VALUE_SALE_THRESHOLD, estimatedMargin: 50 }));
    expect(r.type).toBe("sale_high_value");
    expect(r.severity).toBe("success");
  });

  it("exatamente no threshold de alto valor já classifica como alto valor (>=, não >)", () => {
    const r = classifySale(finance({ grossAmount: HIGH_VALUE_SALE_THRESHOLD }));
    expect(r.type).toBe("sale_high_value");
  });

  it("venda comum: margem saudável, valor abaixo do threshold de alto valor", () => {
    const r = classifySale(finance({ grossAmount: HIGH_VALUE_SALE_THRESHOLD - 1, estimatedMargin: 50 }));
    expect(r.type).toBe("sale_paid");
    expect(r.severity).toBe("success");
  });
});

describe("buildSaleContent — regra inegociável: nunca mostrar R$0,00 quando o dado é desconhecido", () => {
  it("dado financeiro indisponível mostra 'em atualização', não R$ 0,00", () => {
    const c = buildSaleContent({
      type: "sale_paid", grossAmount: 100, estimatedProfit: null, estimatedMargin: null, metaMargem: null,
      productName: "Produto X", itemCount: 1,
    });
    // regex, não toContain literal: Intl.NumberFormat usa espaço não-quebrável
    // (U+00A0) entre "R$" e o valor — um toContain com espaço normal nunca
    // acusaria a regressão de verdade (o teste passaria mesmo se o R$0,00
    // vazasse, só que com o outro tipo de espaço).
    expect(c.body).not.toMatch(/R\$\s*0,00/);
    expect(c.body).toContain("atualização");
  });

  it("venda padrão com dado disponível mostra o valor bruto formatado em BRL", () => {
    const c = buildSaleContent({
      type: "sale_paid", grossAmount: 139.8, estimatedProfit: 20, estimatedMargin: 14,
      metaMargem: null, productName: "Açaí em Pó", itemCount: 1,
    });
    expect(c.body).toContain("Açaí em Pó");
    expect(c.body).toMatch(/139,80/);
  });

  it("pedido com mais de 1 item mostra 'N itens no pedido', não o nome do primeiro", () => {
    const c = buildSaleContent({
      type: "sale_paid", grossAmount: 100, estimatedProfit: 10, estimatedMargin: 10,
      metaMargem: null, productName: "Produto A", itemCount: 3,
    });
    expect(c.body).toContain("3 itens no pedido");
    expect(c.body).not.toContain("Produto A");
  });

  it("alto valor usa emoji só uma vez, no título, nunca duplicado no corpo", () => {
    const c = buildSaleContent({
      type: "sale_high_value", grossAmount: 500, estimatedProfit: 100, estimatedMargin: 20,
      metaMargem: null, productName: "Kit", itemCount: 1,
    });
    expect(c.title).toContain("🚀");
    expect(c.body).not.toContain("🚀");
  });

  it("margem negativa mostra o prejuízo como valor POSITIVO formatado (não '-R$X')", () => {
    const c = buildSaleContent({
      type: "sale_negative_margin", grossAmount: 100, estimatedProfit: -15, estimatedMargin: -15,
      metaMargem: null, productName: "Produto", itemCount: 1,
    });
    // Intl.NumberFormat pt-BR usa espaço não-quebrável (U+00A0) entre "R$" e o
    // valor, não espaço normal — \s no regex cobre os dois.
    expect(c.body).toMatch(/R\$\s*15,00/);
    expect(c.body).not.toMatch(/-\s*15,00/);
  });
});

describe("buildCancelContent / buildReturnCompletedContent — nunca misturam com texto de venda nova", () => {
  it("cancelamento não usa nenhuma palavra de 'nova venda'", () => {
    const c = buildCancelContent("Produto", 1, 50);
    expect(c.title.toLowerCase()).not.toContain("venda confirmada");
    expect(c.title).toBe("Pedido cancelado");
  });

  it("devolução concluída também não menciona nova venda", () => {
    const c = buildReturnCompletedContent("Produto", 1);
    expect(c.title).toBe("Devolução concluída");
  });
});

describe("buildGroupedSalesContent — resumo agrupado (anti-spam)", () => {
  it("título traz a contagem, corpo traz o total formatado", () => {
    const c = buildGroupedSalesContent(4, 486.2, 2);
    expect(c.title).toContain("4");
    expect(c.body).toMatch(/486,20/);
    expect(c.body).toContain("2 min");
  });
});

describe("taskAssignedDedupeKey (Fase 7: sem duplicar push em retry de rede)", () => {
  it("dois timestamps dentro da mesma janela de 10s geram a MESMA chave (dedupe de retry)", () => {
    const a = taskAssignedDedupeKey("t1", 1_000_000_000);
    const b = taskAssignedDedupeKey("t1", 1_000_000_000 + 9_000);
    expect(a).toBe(b);
  });

  it("timestamps em janelas de 10s diferentes geram chaves diferentes (reatribuição de verdade notifica de novo)", () => {
    const a = taskAssignedDedupeKey("t1", 1_000_000_000);
    const b = taskAssignedDedupeKey("t1", 1_000_000_000 + 11_000);
    expect(a).not.toBe(b);
  });

  it("tarefas diferentes nunca colidem, mesmo no mesmo instante", () => {
    const a = taskAssignedDedupeKey("t1", 1_000_000_000);
    const b = taskAssignedDedupeKey("t2", 1_000_000_000);
    expect(a).not.toBe(b);
  });
});
