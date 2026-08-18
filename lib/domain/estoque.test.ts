import { describe, expect, it } from "vitest";
import { consolidarEstoqueAnuncios, estoqueForaDoFull, type AnuncioEstoque } from "./estoque";

function full(available: number, inventoryId?: string): AnuncioEstoque {
  return { available, logistic: "fulfillment", inventoryId };
}
function proprio(available: number): AnuncioEstoque {
  return { available, logistic: "drop_off" };
}

describe("consolidarEstoqueAnuncios — Full compartilhado entre anúncios", () => {
  it("dois anuncios no MESMO pool contam uma vez, nao o dobro", () => {
    // Caso real: Erva Tradicional tinha 148 un no Full e o painel mostrava 296.
    const r = consolidarEstoqueAnuncios([full(148, "INV-1"), full(148, "INV-1")]);
    expect(r.full).toBe(148);
    expect(r.fullCompartilhado).toBe(true);
  });

  it("pools DIFERENTES somam — sao estoques de verdade separados", () => {
    const r = consolidarEstoqueAnuncios([full(100, "INV-1"), full(40, "INV-2")]);
    expect(r.full).toBe(140);
    expect(r.fullCompartilhado).toBe(false);
  });

  it("sem inventoryId nao deduplica no escuro — conta cada um", () => {
    // Preferir inflar (visível, o dono reclama) a sumir com estoque real
    // (silencioso, ninguem percebe ate faltar produto).
    const r = consolidarEstoqueAnuncios([full(50), full(30)]);
    expect(r.full).toBe(80);
    expect(r.fullCompartilhado).toBe(false);
  });

  it("mistura Full e proprio separa os dois baldes", () => {
    const r = consolidarEstoqueAnuncios([full(148, "INV-1"), full(148, "INV-1"), proprio(25)]);
    expect(r.full).toBe(148);
    expect(r.proprio).toBe(25);
    expect(r.ehFull).toBe(true);
  });

  it("so anuncio proprio nao marca ehFull", () => {
    const r = consolidarEstoqueAnuncios([proprio(30), proprio(12)]);
    expect(r.ehFull).toBe(false);
    expect(r.proprio).toBe(42);
    expect(r.full).toBe(0);
  });

  it("lista vazia = ML ainda nao respondeu, nao 'zero estoque'", () => {
    const r = consolidarEstoqueAnuncios([]);
    expect(r.temDado).toBe(false);
    expect(r.full).toBe(0);
  });
});

describe("estoqueForaDoFull — casa e agencia sao o mesmo galpao", () => {
  it("COM Full: usa o livro e IGNORA o anuncio proprio (mesma unidade)", () => {
    // Erva Tradicional: 189 em casa, 25 expostos no anuncio da agencia.
    // O total fora do Full e 189, nao 214.
    expect(estoqueForaDoFull(189, 25, true)).toBe(189);
  });

  it("SEM Full: usa o anuncio, porque o livro nunca desce com venda", () => {
    expect(estoqueForaDoFull(500, 30, false)).toBe(30);
  });

  it("casa negativa (livro furado) nao vira desconto no total", () => {
    expect(estoqueForaDoFull(-5, 10, true)).toBe(0);
  });
});

describe("total consolidado — o numero que o dono confere", () => {
  it("Erva Tradicional: 148 no Full + 189 em casa = 337 (antes dava 510)", () => {
    const c = consolidarEstoqueAnuncios([full(148, "INV-1"), full(148, "INV-1"), proprio(25)]);
    const total = c.full + estoqueForaDoFull(189, c.proprio, c.ehFull);
    expect(total).toBe(337);
  });
});
