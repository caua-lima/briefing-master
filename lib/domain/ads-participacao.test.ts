import { describe, expect, it } from "vitest";
import { calcularParticipacaoAds, lerParticipacao } from "./ads-participacao";

describe("calcularParticipacaoAds", () => {
  it("sem receita total, nao ha o que dividir", () => {
    const r = calcularParticipacaoAds(100, 200, 0);
    expect(r.direta).toBeNull();
    expect(r.comAssistidas).toBeNull();
    expect(r.acimaDe100).toBe(false);
  });

  it("metade da receita veio de clique direto", () => {
    const r = calcularParticipacaoAds(500, 500, 1000);
    expect(r.direta).toBe(50);
  });

  it("assistidas sempre contam pra cima da direta", () => {
    const r = calcularParticipacaoAds(300, 700, 1000);
    expect(r.direta).toBe(30);
    expect(r.comAssistidas).toBe(70);
  });

  it("sem nenhuma venda atribuida, participacao e zero (nao null)", () => {
    const r = calcularParticipacaoAds(0, 0, 1000);
    expect(r.direta).toBe(0);
    expect(r.comAssistidas).toBe(0);
  });

  it("acima de 100% e sinalizado, nao truncado — janela de atribuicao difere", () => {
    // O ML credita a venda ao dia do CLIQUE; nossos pedidos usam o dia do
    // pedido. Num recorte curto isso passa de 100% sem ser erro de conta.
    const r = calcularParticipacaoAds(1200, 1500, 1000);
    expect(r.acimaDe100).toBe(true);
    expect(r.direta).toBe(120);
  });

  it("valor negativo da API e tratado como zero, nunca vira participacao negativa", () => {
    const r = calcularParticipacaoAds(-50, -10, 1000);
    expect(r.direta).toBe(0);
    expect(r.comAssistidas).toBe(0);
  });
});

describe("lerParticipacao", () => {
  it("null explica a ausencia em vez de mostrar 0%", () => {
    expect(lerParticipacao(null).texto).toBe("sem venda no período pra calcular");
  });

  it("dependencia alta a partir de 70%", () => {
    expect(lerParticipacao(70).texto).toBe("dependência alta da publicidade");
    expect(lerParticipacao(69.9).texto).not.toBe("dependência alta da publicidade");
  });

  it("majoritariamente organica abaixo de 15%", () => {
    expect(lerParticipacao(5).texto).toBe("venda majoritariamente orgânica");
  });
});
