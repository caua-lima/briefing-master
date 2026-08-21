import { describe, expect, it } from "vitest";
import { classificarVenda, detectarPedidosSubstituidos, ehStatusNaoVenda, temStatusConfiavel } from "./venda-status";

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

describe("detectarPedidosSubstituidos — separacao de envio nao e cancelamento", () => {
  /**
   * O caso descrito pelo vendedor: compra de 2 unidades, envio separado na
   * agencia. O ML cancela o pedido original e cria dois unitarios no MESMO
   * pacote. Contar o original inflava bruto e canceladas ao mesmo tempo.
   */
  const pacoteSeparado = [
    { orderId: "orig", packId: "pack1", status: "cancelled" },
    { orderId: "novo1", packId: "pack1", status: "paid" },
    { orderId: "novo2", packId: "pack1", status: "paid" },
  ];

  it("marca o original como substituido", () => {
    const s = detectarPedidosSubstituidos(pacoteSeparado);
    expect(s.has("orig")).toBe(true);
  });

  it("nao marca os pedidos novos — eles sao a venda", () => {
    const s = detectarPedidosSubstituidos(pacoteSeparado);
    expect(s.has("novo1")).toBe(false);
    expect(s.has("novo2")).toBe(false);
  });

  it("pacote INTEIRO cancelado e cancelamento de verdade, nao substituicao", () => {
    const s = detectarPedidosSubstituidos([
      { orderId: "a", packId: "pack2", status: "cancelled" },
      { orderId: "b", packId: "pack2", status: "cancelled" },
    ]);
    expect(s.size).toBe(0);
  });

  it("pedido avulso cancelado (sem pacote) segue cancelamento", () => {
    const s = detectarPedidosSubstituidos([
      { orderId: "solo", packId: null, status: "cancelled" },
      { orderId: "outro", packId: "", status: "cancelled" },
    ]);
    expect(s.size).toBe(0);
  });

  it("a ordem dos pedidos na lista nao importa", () => {
    // O valido pode vir depois do cancelado — dois passes garantem isso.
    const s = detectarPedidosSubstituidos([
      { orderId: "orig", packId: "p", status: "cancelled" },
      { orderId: "novo", packId: "p", status: "paid" },
    ]);
    const inverso = detectarPedidosSubstituidos([
      { orderId: "novo", packId: "p", status: "paid" },
      { orderId: "orig", packId: "p", status: "cancelled" },
    ]);
    expect(s).toEqual(inverso);
    expect(s.has("orig")).toBe(true);
  });

  it("pacotes diferentes nao se contaminam", () => {
    const s = detectarPedidosSubstituidos([
      { orderId: "a", packId: "p1", status: "cancelled" },
      { orderId: "b", packId: "p2", status: "paid" },
    ]);
    expect(s.size).toBe(0);
  });
});

describe("classificarVenda com substituicao", () => {
  it("substituido NAO conta como cancelado nem como venda", () => {
    const r = classificarVenda(entrada({ status: "cancelled", substituidoNoPacote: true }));
    expect(r.classe).toBe("substituida");
  });

  it("substituicao so vale pra pedido de fato cancelado", () => {
    // Um pedido valido nunca deve ser descartado por causa da flag.
    const r = classificarVenda(entrada({ status: "paid", substituidoNoPacote: true }));
    expect(r.classe).toBe("valida");
  });

  it("cancelamento normal segue cancelamento", () => {
    const r = classificarVenda(entrada({ status: "cancelled", substituidoNoPacote: false }));
    expect(r.classe).toBe("cancelada");
  });
});
