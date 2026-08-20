import { describe, expect, it } from "vitest";
import { classificarVenda, ehStatusNaoVenda, temStatusConfiavel } from "./venda-status";

function entrada(over: Partial<Parameters<typeof classificarVenda>[0]> = {}) {
  return { status: "paid", noCacheDeCancelados: false, temDevolucaoConcluida: false, ...over };
}

describe("ehStatusNaoVenda", () => {
  it("cancelled e invalid não são venda", () => {
    expect(ehStatusNaoVenda("cancelled")).toBe(true);
    expect(ehStatusNaoVenda("invalid")).toBe(true);
  });

  it("não depende de caixa nem de espaço em volta", () => {
    expect(ehStatusNaoVenda(" Cancelled ")).toBe(true);
    expect(ehStatusNaoVenda("INVALID")).toBe(true);
  });

  it("paid e delivered são venda", () => {
    expect(ehStatusNaoVenda("paid")).toBe(false);
    expect(ehStatusNaoVenda("delivered")).toBe(false);
  });

  it("vazio/ausente não é 'não venda' — é falta de informação", () => {
    expect(ehStatusNaoVenda("")).toBe(false);
    expect(ehStatusNaoVenda(undefined)).toBe(false);
    expect(temStatusConfiavel("")).toBe(false);
    expect(temStatusConfiavel("paid")).toBe(true);
  });
});

describe("classificarVenda — o status ao vivo manda sobre o cache", () => {
  it("venda normal é válida", () => {
    expect(classificarVenda(entrada())).toEqual({ classe: "valida", resgatadoDoCache: false });
  });

  it("status cancelled é cancelada, sem depender do cache", () => {
    const r = classificarVenda(entrada({ status: "cancelled" }));
    expect(r.classe).toBe("cancelada");
    expect(r.resgatadoDoCache).toBe(false);
  });

  it("O BUG: cache diz cancelada, ML diz paid → vale, e marca o resgate", () => {
    // ml_returns só escreve e nunca remove. Um cancelamento revertido ficava
    // descontado pra sempre — foi o que tirou R$ 360,28 do faturamento.
    const r = classificarVenda(entrada({ status: "paid", noCacheDeCancelados: true }));
    expect(r.classe).toBe("valida");
    expect(r.resgatadoDoCache).toBe(true);
  });

  it("cache e ML concordando no cancelamento não conta como resgate", () => {
    const r = classificarVenda(entrada({ status: "cancelled", noCacheDeCancelados: true }));
    expect(r.classe).toBe("cancelada");
    expect(r.resgatadoDoCache).toBe(false);
  });

  it("sem status confiável, o cache é a única fonte — segue cancelada", () => {
    const r = classificarVenda(entrada({ status: "", noCacheDeCancelados: true }));
    expect(r.classe).toBe("cancelada");
    expect(r.resgatadoDoCache).toBe(false);
  });

  it("devolução concluída reverte a venda mesmo com status paid", () => {
    // Devolução vem de claim pós-venda; o status do pedido não a carrega.
    const r = classificarVenda(entrada({ status: "paid", temDevolucaoConcluida: true }));
    expect(r.classe).toBe("devolvida");
  });

  it("resgatada do cache mas COM devolução concluída continua devolvida", () => {
    // Não pode virar "válida" só porque o cancelamento era falso: a devolução
    // é um sinal independente e continua valendo.
    const r = classificarVenda(entrada({
      status: "paid", noCacheDeCancelados: true, temDevolucaoConcluida: true,
    }));
    expect(r.classe).toBe("devolvida");
    expect(r.resgatadoDoCache).toBe(true);
  });

  it("cancelada no ML tem prioridade sobre devolução — não há o que devolver", () => {
    const r = classificarVenda(entrada({ status: "cancelled", temDevolucaoConcluida: true }));
    expect(r.classe).toBe("cancelada");
  });
});
