import { describe, expect, it } from "vitest";
import { mapearCampanhasParaProdutos, normalizarMlb, produtoDoMlb } from "./ads-campaign-link";

describe("normalizarMlb", () => {
  it("adiciona o prefixo MLB quando falta", () => {
    expect(normalizarMlb("123456")).toBe("MLB123456");
  });
  it("mantem o prefixo quando ja existe, so normaliza caixa/espaco", () => {
    expect(normalizarMlb(" mlb123456 ")).toBe("MLB123456");
  });
  it("string vazia continua vazia", () => {
    expect(normalizarMlb("")).toBe("");
  });
});

describe("mapearCampanhasParaProdutos", () => {
  const produtos = [
    { id: "p1", name: "Produto 1", mlbs: ["MLB111"] },
    { id: "p2", name: "Produto 2", mlb: "MLB222" },
    { id: "p3", name: "Produto 3 sem anuncio" },
  ];

  it("liga campanha ao produto certo via MLB do anuncio", () => {
    const map = mapearCampanhasParaProdutos(produtos, [{ itemId: "MLB111", campaignId: "camp-a" }]);
    expect(map.get("camp-a")?.map((p) => p.id)).toEqual(["p1"]);
  });

  it("uma campanha com anuncios de produtos diferentes soma os dois, sem duplicar", () => {
    const map = mapearCampanhasParaProdutos(produtos, [
      { itemId: "MLB111", campaignId: "camp-b" },
      { itemId: "MLB222", campaignId: "camp-b" },
      { itemId: "MLB111", campaignId: "camp-b" }, // repetido, nao deve duplicar
    ]);
    expect(map.get("camp-b")?.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
  });

  it("item sem campaignId resolvido nao entra no mapa", () => {
    const map = mapearCampanhasParaProdutos(produtos, [{ itemId: "MLB111", campaignId: "" }]);
    expect(map.size).toBe(0);
  });

  it("MLB sem produto vinculado no Estoque nao aparece em nenhuma campanha", () => {
    const map = mapearCampanhasParaProdutos(produtos, [{ itemId: "MLB999", campaignId: "camp-c" }]);
    expect(map.has("camp-c")).toBe(false);
  });
});

describe("produtoDoMlb", () => {
  const produtos = [
    { id: "p1", name: "Produto 1", mlbs: ["MLB111", "MLB113"] },
    { id: "p2", name: "Produto 2", mlb: "MLB222" },
  ];

  it("acha o produto certo mesmo com varios MLBs no mesmo produto", () => {
    expect(produtoDoMlb(produtos, "MLB113")?.id).toBe("p1");
  });
  it("MLB desconhecido retorna null", () => {
    expect(produtoDoMlb(produtos, "MLB999")).toBeNull();
  });
});
