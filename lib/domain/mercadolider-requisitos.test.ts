import { describe, expect, it } from "vitest";
import { avaliarRequisitosMercadoLider } from "./mercadolider-requisitos";

describe("avaliarRequisitosMercadoLider", () => {
  it("sem reputação, lista vazia", () => {
    expect(avaliarRequisitosMercadoLider(null)).toEqual([]);
  });

  it("métricas dentro do limite → ok", () => {
    const r = avaliarRequisitosMercadoLider({
      level_id: "5_green",
      metrics: { claims: { rate: 0.005 }, cancellations: { rate: 0.001 }, delayed_handling_time: { rate: 0.02 } },
    });
    expect(r.find((x) => x.id === "reputacao")?.status).toBe("ok");
    expect(r.find((x) => x.id === "reclamacoes")?.status).toBe("ok");
    expect(r.find((x) => x.id === "cancelamentos")?.status).toBe("ok");
    expect(r.find((x) => x.id === "envios")?.status).toBe("ok");
  });

  it("métricas acima do limite → atenção", () => {
    const r = avaliarRequisitosMercadoLider({
      level_id: "3_yellow",
      metrics: { claims: { rate: 0.02 }, cancellations: { rate: 0.01 }, delayed_handling_time: { rate: 0.1 } },
    });
    expect(r.find((x) => x.id === "reputacao")?.status).toBe("atencao");
    expect(r.find((x) => x.id === "reclamacoes")?.status).toBe("atencao");
    expect(r.find((x) => x.id === "cancelamentos")?.status).toBe("atencao");
    expect(r.find((x) => x.id === "envios")?.status).toBe("atencao");
  });

  it("mediações sempre indisponível (a API não separa esse campo)", () => {
    const r = avaliarRequisitosMercadoLider({ level_id: "5_green", metrics: {} });
    expect(r.find((x) => x.id === "mediacoes")?.status).toBe("indisponivel");
  });

  it("métrica ausente vira indisponível, não um falso ok/atenção", () => {
    const r = avaliarRequisitosMercadoLider({ level_id: null, metrics: null });
    expect(r.find((x) => x.id === "reclamacoes")?.status).toBe("indisponivel");
    expect(r.find((x) => x.id === "reputacao")?.status).toBe("indisponivel");
  });
});
