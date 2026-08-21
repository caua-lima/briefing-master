import { describe, expect, it } from "vitest";
import { movIdRemessa, unidadesPendentesPorProduto, type Remessa } from "./remessas";
import type { EstoqueMovimento } from "./types";

function remessa(over: Partial<Remessa> = {}): Remessa {
  return {
    remessa: "R1", data: "2026-08-15", recebido: 23, problema: 0,
    saldoFull: 22, refs: [], ehTransferencia: false, tipos: [],
    produtos: [{ inventory: "inv-1", nome: "Erva Hortelã", cadastrado: true, productId: "p-hortela", qtd: 23 }],
    ...over,
  } as Remessa;
}

function baixaDe(remessaId: string, productId: string): EstoqueMovimento {
  return { id: movIdRemessa(remessaId, productId), productId, tipo: "saida_full", quantidade: 23, data: "2026-08-15" } as EstoqueMovimento;
}

describe("unidadesPendentesPorProduto — o estoque contado duas vezes", () => {
  it("remessa sem baixa marca as unidades como duplicadas", () => {
    // O caso relatado: 23 un ja no Full e ainda no livro do galpao.
    const m = unidadesPendentesPorProduto([remessa()], [], new Set());
    expect(m.get("p-hortela")).toBe(23);
  });

  it("com a baixa lancada, nao ha duplicacao", () => {
    const m = unidadesPendentesPorProduto([remessa()], [baixaDe("R1", "p-hortela")], new Set());
    expect(m.size).toBe(0);
  });

  it("remessa marcada como ja resolvida a mao sai da conta", () => {
    const m = unidadesPendentesPorProduto([remessa()], [], new Set(["R1"]));
    expect(m.size).toBe(0);
  });

  it("transferencia entre centros do ML nunca duplica — nao saiu de casa", () => {
    const m = unidadesPendentesPorProduto([remessa({ ehTransferencia: true })], [], new Set());
    expect(m.size).toBe(0);
  });

  it("soma varias remessas pendentes do mesmo produto", () => {
    const m = unidadesPendentesPorProduto(
      [remessa({ remessa: "R1" }), remessa({ remessa: "R2", produtos: [{ inventory: "inv-1", nome: "x", cadastrado: true, productId: "p-hortela", qtd: 10 }] })],
      [], new Set(),
    );
    expect(m.get("p-hortela")).toBe(33);
  });

  it("baixa parcial: produto ja baixado nao entra, o pendente entra", () => {
    // remessaTemBaixa exige TODOS os produtos baixados; a remessa segue
    // pendente, mas so contamos o que de fato tem cadastro.
    const r = remessa({
      produtos: [
        { inventory: "i1", nome: "A", cadastrado: true, productId: "p-a", qtd: 5 },
        { inventory: "i2", nome: "B", cadastrado: true, productId: "p-b", qtd: 7 },
      ],
    });
    const m = unidadesPendentesPorProduto([r], [baixaDe("R1", "p-a")], new Set());
    expect(m.get("p-b")).toBe(7);
  });

  it("produto sem cadastro nao vira alerta — nao ha de quem descontar", () => {
    const r = remessa({ produtos: [{ inventory: "i1", nome: "?", cadastrado: false, productId: "", qtd: 9 }] });
    expect(unidadesPendentesPorProduto([r], [], new Set()).size).toBe(0);
  });

  it("sem remessas, mapa vazio", () => {
    expect(unidadesPendentesPorProduto([], [], new Set()).size).toBe(0);
  });
});
