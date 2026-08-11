import { describe, expect, it } from "vitest";
import {
  calculateAdsReconciliation,
  getAdsDataQualityLabel,
  getAdsDataQualityStatus,
  getCoveragePercent,
} from "./ads-reconciliation";

describe("getCoveragePercent", () => {
  it("sem investimento total, retorna null (nao inventa 0% nem 100%)", () => {
    expect(getCoveragePercent(0, 0)).toBeNull();
  });
  it("cobertura total = 100%", () => {
    expect(getCoveragePercent(1000, 1000)).toBe(100);
  });
  it("cobertura parcial calcula proporcao correta", () => {
    expect(getCoveragePercent(1000, 800)).toBe(80);
  });
});

describe("getAdsDataQualityStatus", () => {
  it("nada investido no periodo = confirmada (nada pra esconder)", () => {
    const s = getAdsDataQualityStatus({ temItens: false, investimentoTotal: 0, anunciosContagemFalhou: false, coveragePercent: null });
    expect(s).toBe("confirmada");
  });

  it("investimento existe mas cobertura nao calculavel = sem-dados (nunca assume 0% nem 100%)", () => {
    const s = getAdsDataQualityStatus({ temItens: true, investimentoTotal: 500, anunciosContagemFalhou: false, coveragePercent: null });
    expect(s).toBe("sem-dados");
  });

  it("contagem de anuncios falhou = atencao, mesmo com cobertura alta", () => {
    const s = getAdsDataQualityStatus({ temItens: true, investimentoTotal: 500, anunciosContagemFalhou: true, coveragePercent: 99 });
    expect(s).toBe("atencao");
  });

  it("cobertura >= 98% e sem falha = confirmada", () => {
    const s = getAdsDataQualityStatus({ temItens: true, investimentoTotal: 500, anunciosContagemFalhou: false, coveragePercent: 98 });
    expect(s).toBe("confirmada");
  });

  it("cobertura entre 80% e 98% = parcial", () => {
    const s = getAdsDataQualityStatus({ temItens: true, investimentoTotal: 500, anunciosContagemFalhou: false, coveragePercent: 85 });
    expect(s).toBe("parcial");
  });

  it("cobertura abaixo de 80% = atencao", () => {
    const s = getAdsDataQualityStatus({ temItens: true, investimentoTotal: 500, anunciosContagemFalhou: false, coveragePercent: 50 });
    expect(s).toBe("atencao");
  });
});

describe("getAdsDataQualityLabel", () => {
  it("mapeia cada status pro rotulo em portugues", () => {
    expect(getAdsDataQualityLabel("confirmada")).toBe("Confirmada");
    expect(getAdsDataQualityLabel("parcial")).toBe("Parcial");
    expect(getAdsDataQualityLabel("atencao")).toBe("Atenção");
    expect(getAdsDataQualityLabel("sem-dados")).toBe("Sem dados");
  });
});

describe("calculateAdsReconciliation", () => {
  it("investimento totalmente vinculado (sem orfao/sem-vinculo) = confirmada, 100%", () => {
    const r = calculateAdsReconciliation({
      investimentoTotal: 1000, gastoOrfao: 0, gastoSemVinculo: 0,
      anunciosContagemFalhou: false, temItens: true,
    });
    expect(r.investimentoVinculado).toBe(1000);
    expect(r.investimentoNaoVinculado).toBe(0);
    expect(r.coveragePercent).toBe(100);
    expect(r.status).toBe("confirmada");
  });

  it("investimento com gasto orfao E sem vinculo soma os dois como nao-vinculado", () => {
    const r = calculateAdsReconciliation({
      investimentoTotal: 1000, gastoOrfao: 100, gastoSemVinculo: 50,
      anunciosContagemFalhou: false, temItens: true,
    });
    expect(r.investimentoNaoVinculado).toBe(150);
    expect(r.investimentoVinculado).toBe(850);
    expect(r.coveragePercent).toBe(85);
    expect(r.status).toBe("parcial");
  });

  it("nao vinculado maior que o total nunca produz vinculado negativo", () => {
    const r = calculateAdsReconciliation({
      investimentoTotal: 100, gastoOrfao: 80, gastoSemVinculo: 40,
      anunciosContagemFalhou: false, temItens: true,
    });
    expect(r.investimentoVinculado).toBe(0);
    expect(r.investimentoNaoVinculado).toBe(120);
  });

  it("sem nenhum item e sem investimento = confirmada (nada a reconciliar)", () => {
    const r = calculateAdsReconciliation({
      investimentoTotal: 0, gastoOrfao: 0, gastoSemVinculo: 0,
      anunciosContagemFalhou: false, temItens: false,
    });
    expect(r.status).toBe("confirmada");
  });
});
