import { describe, expect, it } from "vitest";
import { detectarVendaPorPublicidade } from "./ads-order-tag";

describe("detectarVendaPorPublicidade", () => {
  it("acha marcador dentro de tags do pedido", () => {
    const r = detectarVendaPorPublicidade({ id: 1, tags: ["paid", "advertising"] });
    expect(r.viaAds).toBe(true);
    expect(r.caminho).toContain("tags");
  });

  it("acha marcador aninhado no item do pedido", () => {
    const r = detectarVendaPorPublicidade({
      order_items: [{ item: { id: "MLB1" }, origin: "PRODUCT_ADS" }],
    });
    expect(r.viaAds).toBe(true);
    expect(r.marcador).toBe("product_ads");
  });

  it("acha quando o marcador e a propria CHAVE com valor preenchido", () => {
    const r = detectarVendaPorPublicidade({ context: { advertising: { campaign_id: "123" } } });
    expect(r.viaAds).toBe(true);
  });

  it("chave de publicidade DESLIGADA nao marca a venda como paga", () => {
    // Campo presente porém falso/vazio é o caso mais perigoso: marcar aqui
    // transformaria toda venda orgânica em "veio do Ads".
    expect(detectarVendaPorPublicidade({ advertising: false }).viaAds).toBe(false);
    expect(detectarVendaPorPublicidade({ advertising: null }).viaAds).toBe(false);
    expect(detectarVendaPorPublicidade({ advertising: "" }).viaAds).toBe(false);
    expect(detectarVendaPorPublicidade({ advertising: 0 }).viaAds).toBe(false);
  });

  it("pedido organico nao e marcado", () => {
    const r = detectarVendaPorPublicidade({
      id: 2000014545293335, status: "paid", tags: ["not_delivered"],
      order_items: [{ item: { id: "MLB123", title: "Erva Mate" }, quantity: 1 }],
    });
    expect(r.viaAds).toBe(false);
    expect(r.caminho).toBeNull();
  });

  it('"ads" solto nao dispara — casaria com adsense, loads e ids quaisquer', () => {
    expect(detectarVendaPorPublicidade({ nota: "carga de loads", canal: "adsense" }).viaAds).toBe(false);
  });

  it("aceita variacoes em portugues e espanhol", () => {
    expect(detectarVendaPorPublicidade({ origem: "Venda por publicidade" }).viaAds).toBe(true);
    expect(detectarVendaPorPublicidade({ origen: "venta por publicidad" }).viaAds).toBe(true);
    expect(detectarVendaPorPublicidade({ x: "PATROCINADO" }).viaAds).toBe(true);
  });

  it("nao quebra com nulo, vazio ou tipo inesperado", () => {
    expect(detectarVendaPorPublicidade(null).viaAds).toBe(false);
    expect(detectarVendaPorPublicidade(undefined).viaAds).toBe(false);
    expect(detectarVendaPorPublicidade(42).viaAds).toBe(false);
    expect(detectarVendaPorPublicidade({}).viaAds).toBe(false);
  });

  it("nao entra em laco infinito com referencia circular", () => {
    const o: Record<string, unknown> = { id: 1 };
    o.self = o;
    expect(() => detectarVendaPorPublicidade(o)).not.toThrow();
  });
});
