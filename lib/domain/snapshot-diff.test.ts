import { describe, expect, it } from "vitest";
import {
  apenasPioras, compararAnuncios, compararReputacao,
  type AnuncioSnapshot, type ReputacaoSnapshot,
} from "./snapshot-diff";

function an(over: Partial<AnuncioSnapshot> = {}): AnuncioSnapshot {
  return { mlb: "MLB1", titulo: "Erva", preco: 100, emPromocao: false, status: "active", disponivel: 10, ...over };
}

describe("compararAnuncios", () => {
  it("sem mudanca, nao inventa alerta", () => {
    expect(compararAnuncios([an()], [an()])).toEqual([]);
  });

  it("queda de preco vira alerta com a variacao", () => {
    const m = compararAnuncios([an({ preco: 100 })], [an({ preco: 80 })]);
    expect(m).toHaveLength(1);
    expect(m[0].tipo).toBe("preco");
    expect(m[0].variacaoPct).toBeCloseTo(-20, 5);
  });

  it("variacao de centavos NAO alerta — viraria ruido diario", () => {
    expect(compararAnuncios([an({ preco: 100 })], [an({ preco: 100.5 })])).toEqual([]);
  });

  it("entrada e saida de promocao sao eventos distintos", () => {
    expect(compararAnuncios([an()], [an({ emPromocao: true })])[0].tipo).toBe("promocao_entrou");
    expect(compararAnuncios([an({ emPromocao: true })], [an()])[0].tipo).toBe("promocao_saiu");
  });

  it("mudanca de status do anuncio alerta", () => {
    const m = compararAnuncios([an()], [an({ status: "paused" })]);
    expect(m[0].tipo).toBe("status");
    expect(m[0].depois).toBe("paused");
  });

  it("alerta no momento em que ZERA, e nao todo dia depois", () => {
    expect(compararAnuncios([an({ disponivel: 5 })], [an({ disponivel: 0 })])[0].tipo).toBe("zerou");
    // Continuar zerado no dia seguinte nao e noticia nova.
    expect(compararAnuncios([an({ disponivel: 0 })], [an({ disponivel: 0 })])).toEqual([]);
  });

  it("anuncio novo nao vira mudanca — nao havia com o que comparar", () => {
    expect(compararAnuncios([], [an()])).toEqual([]);
  });
});

function rep(over: Partial<ReputacaoSnapshot> = {}): ReputacaoSnapshot {
  return { nivel: "5_green", selo: "gold", reclamacoes: 0.01, atrasoEnvio: 0.02, cancelamentos: 0.0, ...over };
}

describe("compararReputacao", () => {
  it("sem snapshot anterior nao compara", () => {
    expect(compararReputacao(null, rep())).toEqual([]);
  });

  it("cair de nivel e marcado como piora", () => {
    const m = compararReputacao(rep({ nivel: "5_green" }), rep({ nivel: "3_yellow" }));
    expect(m[0].campo).toBe("nivel");
    expect(m[0].piorou).toBe(true);
  });

  it("subir de nivel NAO e piora", () => {
    const m = compararReputacao(rep({ nivel: "3_yellow" }), rep({ nivel: "5_green" }));
    expect(m[0].piorou).toBe(false);
  });

  it("perder o selo e piora; ganhar nao", () => {
    expect(compararReputacao(rep({ selo: "platinum" }), rep({ selo: "gold" }))[0].piorou).toBe(true);
    expect(compararReputacao(rep({ selo: null }), rep({ selo: "silver" }))[0].piorou).toBe(false);
  });

  it("taxa de problema subindo e piora (subir e ruim)", () => {
    const m = compararReputacao(rep({ reclamacoes: 0.01 }), rep({ reclamacoes: 0.05 }));
    expect(m[0].campo).toBe("reclamacoes");
    expect(m[0].piorou).toBe(true);
  });

  it("oscilacao minima da taxa nao alerta", () => {
    // Uma venda a mais move o denominador sem nada ter acontecido.
    expect(compararReputacao(rep({ atrasoEnvio: 0.020 }), rep({ atrasoEnvio: 0.022 }))).toEqual([]);
  });

  it("apenasPioras filtra o que melhorou", () => {
    const m = compararReputacao(rep({ nivel: "3_yellow", selo: "gold" }), rep({ nivel: "5_green", selo: "silver" }));
    const p = apenasPioras(m);
    expect(p.every((x) => x.piorou)).toBe(true);
    expect(p.map((x) => x.campo)).toEqual(["selo"]);
  });
});
