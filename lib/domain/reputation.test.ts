import { describe, expect, it } from "vitest";
import { getPowerSellerLabel, getProximoNivelLabel, getReputationLevelMeta } from "./reputation";

describe("getReputationLevelMeta", () => {
  it("nível conhecido", () => {
    expect(getReputationLevelMeta("5_green").label).toBe("Verde — melhor nível");
  });
  it("sem nível ainda (conta nova)", () => {
    expect(getReputationLevelMeta(null).label).toBe("Sem nível calculado ainda");
  });
  it("nível desconhecido cai pro próprio texto cru, não trava", () => {
    expect(getReputationLevelMeta("novo_nivel_futuro").label).toBe("novo_nivel_futuro");
  });
});

describe("getPowerSellerLabel", () => {
  it("sem selo", () => {
    expect(getPowerSellerLabel(null)).toBe("Ainda sem selo de Mercado Líder");
  });
  it("platinum", () => {
    expect(getPowerSellerLabel("platinum")).toBe("Mercado Líder Platinum");
  });
});

describe("getProximoNivelLabel", () => {
  it("sem selo → próximo é o Mercado Líder básico", () => {
    expect(getProximoNivelLabel(null)).toBe("Mercado Líder");
  });
  it("silver → próximo é Gold", () => {
    expect(getProximoNivelLabel("silver")).toBe("Mercado Líder Gold");
  });
  it("platinum já é o topo → null", () => {
    expect(getProximoNivelLabel("platinum")).toBeNull();
  });
});
