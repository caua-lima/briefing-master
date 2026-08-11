import { describe, expect, it } from "vitest";
import { ehTerminal, podeCancelar, proximaTransicao, sugerirVinculoRecebimento, totalEmTransito } from "./full-coletas";
import type { FullColeta } from "./types";
import type { Remessa } from "./remessas";

describe("proximaTransicao", () => {
  it("agendado -> em_transporte -> recebido", () => {
    expect(proximaTransicao("agendado")).toBe("em_transporte");
    expect(proximaTransicao("em_transporte")).toBe("recebido");
  });
  it("recebido e cancelado sao terminais (null)", () => {
    expect(proximaTransicao("recebido")).toBeNull();
    expect(proximaTransicao("cancelado")).toBeNull();
  });
});

describe("podeCancelar / ehTerminal", () => {
  it("agendado e em_transporte podem ser cancelados", () => {
    expect(podeCancelar("agendado")).toBe(true);
    expect(podeCancelar("em_transporte")).toBe(true);
  });
  it("recebido e cancelado nao podem ser cancelados de novo", () => {
    expect(podeCancelar("recebido")).toBe(false);
    expect(podeCancelar("cancelado")).toBe(false);
  });
  it("ehTerminal reflete o mesmo conjunto", () => {
    expect(ehTerminal("recebido")).toBe(true);
    expect(ehTerminal("cancelado")).toBe(true);
    expect(ehTerminal("agendado")).toBe(false);
  });
});

function remessa(over: Partial<Remessa> = {}): Remessa {
  return {
    remessa: "r1", data: "2026-08-15", recebido: 10, problema: 0, saldoFull: 100,
    produtos: [{ inventory: "inv1", nome: "Produto A", cadastrado: true, productId: "p1", qtd: 10 }],
    tipos: [], refs: [], ehTransferencia: false,
    ...over,
  };
}

describe("sugerirVinculoRecebimento", () => {
  const coleta = { productId: "p1", quantidade: 10, dataAgendada: "2026-08-10" };

  it("acha a remessa que bate em produto e quantidade, recebida depois da data agendada", () => {
    const s = sugerirVinculoRecebimento(coleta, [remessa()], new Set());
    expect(s).toEqual({ remessa: "r1", data: "2026-08-15", qtdRecebida: 10 });
  });

  it("nao sugere remessa com quantidade diferente", () => {
    const r = remessa({ produtos: [{ inventory: "inv1", nome: "A", cadastrado: true, productId: "p1", qtd: 7 }] });
    expect(sugerirVinculoRecebimento(coleta, [r], new Set())).toBeNull();
  });

  it("nao sugere remessa recebida ANTES da data agendada (nao pode ter chegado antes de sair)", () => {
    const r = remessa({ data: "2026-08-05" });
    expect(sugerirVinculoRecebimento(coleta, [r], new Set())).toBeNull();
  });

  it("nao sugere remessa fora da janela de dias", () => {
    const r = remessa({ data: "2026-10-15" }); // muito mais de 45 dias depois
    expect(sugerirVinculoRecebimento(coleta, [r], new Set())).toBeNull();
  });

  it("nao sugere remessa ja vinculada a outra coleta", () => {
    const s = sugerirVinculoRecebimento(coleta, [remessa()], new Set(["r1"]));
    expect(s).toBeNull();
  });

  it("nao sugere transferencia entre centros do ML (nao e envio novo)", () => {
    const r = remessa({ ehTransferencia: true });
    expect(sugerirVinculoRecebimento(coleta, [r], new Set())).toBeNull();
  });

  it("entre varias candidatas, escolhe a mais proxima da data agendada", () => {
    const longe = remessa({ remessa: "longe", data: "2026-08-30" });
    const perto = remessa({ remessa: "perto", data: "2026-08-12" });
    const s = sugerirVinculoRecebimento(coleta, [longe, perto], new Set());
    expect(s?.remessa).toBe("perto");
  });
});

describe("totalEmTransito", () => {
  const coletas: FullColeta[] = [
    { id: "1", productId: "p1", productName: "A", quantidade: 10, dataAgendada: "2026-08-01", status: "agendado", createdBy: "x", createdAt: 0 },
    { id: "2", productId: "p1", productName: "A", quantidade: 5, dataAgendada: "2026-08-02", status: "em_transporte", createdBy: "x", createdAt: 0 },
    { id: "3", productId: "p2", productName: "B", quantidade: 20, dataAgendada: "2026-08-03", status: "recebido", createdBy: "x", createdAt: 0 },
    { id: "4", productId: "p1", productName: "A", quantidade: 99, dataAgendada: "2026-08-04", status: "cancelado", createdBy: "x", createdAt: 0 },
  ];

  it("soma so agendado + em_transporte, ignora recebido e cancelado", () => {
    expect(totalEmTransito(coletas)).toBe(15);
  });

  it("filtra por produto quando informado", () => {
    expect(totalEmTransito(coletas, "p1")).toBe(15);
    expect(totalEmTransito(coletas, "p2")).toBe(0);
  });
});
