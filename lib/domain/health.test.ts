import { describe, expect, it } from "vitest";
import {
  avaliarAds,
  avaliarCron,
  avaliarFirestoreRules,
  avaliarMercadoPago,
  avaliarNotificacoes,
  avaliarTokenML,
  statusGeral,
} from "./health";

describe("avaliarTokenML", () => {
  it("token ausente é sempre crítico", () => {
    const s = avaliarTokenML({ presente: false, expiraEmMin: null, ultimoRefresh: null, ultimoPedidoRegistrado: null, ultimaDevolucaoRegistrada: null });
    expect(s.status).toBe("critico");
  });

  it("token presente mas sem dado de expiração vira sem-dados, não 'saudável' inventado", () => {
    const s = avaliarTokenML({ presente: true, expiraEmMin: null, ultimoRefresh: null, ultimoPedidoRegistrado: null, ultimaDevolucaoRegistrada: null });
    expect(s.status).toBe("sem-dados");
  });

  it("expirado (<=0 min) é crítico", () => {
    const s = avaliarTokenML({ presente: true, expiraEmMin: -5, ultimoRefresh: null, ultimoPedidoRegistrado: null, ultimaDevolucaoRegistrada: null });
    expect(s.status).toBe("critico");
  });

  it("perto de expirar (<=60min) é atenção, não crítico", () => {
    const s = avaliarTokenML({ presente: true, expiraEmMin: 30, ultimoRefresh: null, ultimoPedidoRegistrado: null, ultimaDevolucaoRegistrada: null });
    expect(s.status).toBe("atencao");
  });

  it("bem dentro da validade é saudável", () => {
    const s = avaliarTokenML({ presente: true, expiraEmMin: 300, ultimoRefresh: null, ultimoPedidoRegistrado: null, ultimaDevolucaoRegistrada: null });
    expect(s.status).toBe("saudavel");
  });

  it("estoque Full e status do webhook nunca fingem ter dado — sempre 'não verificado' hoje", () => {
    const s = avaliarTokenML({ presente: true, expiraEmMin: 300, ultimoRefresh: null, ultimoPedidoRegistrado: null, ultimaDevolucaoRegistrada: null });
    const full = s.itens.find((i) => i.label.includes("estoque Full"));
    const webhook = s.itens.find((i) => i.label.includes("webhook"));
    expect(full?.status).toBe("sem-dados");
    expect(webhook?.status).toBe("sem-dados");
  });
});

describe("avaliarAds — nada persistido ainda, nunca inventa dado", () => {
  it("seção inteira é sem-dados", () => {
    const s = avaliarAds();
    expect(s.status).toBe("sem-dados");
    expect(s.itens.every((i) => i.status === "sem-dados")).toBe(true);
  });
});

describe("avaliarCron — nada persistido ainda, nunca inventa dado", () => {
  it("seção inteira é sem-dados", () => {
    const s = avaliarCron();
    expect(s.status).toBe("sem-dados");
  });
});

describe("avaliarMercadoPago", () => {
  it("sem nenhum pedido na amostra é sem-dados", () => {
    const s = avaliarMercadoPago({ confirmados: 0, semRepasse: 0, totalAmostra: 0, janelaDias: 30 });
    expect(s.status).toBe("sem-dados");
  });

  it("mais confirmado que sem-repasse é saudável", () => {
    const s = avaliarMercadoPago({ confirmados: 8, semRepasse: 2, totalAmostra: 10, janelaDias: 30 });
    expect(s.status).toBe("saudavel");
  });

  it("mais sem-repasse que confirmado é atenção (não crítico — pode ser normal, repasse demora)", () => {
    const s = avaliarMercadoPago({ confirmados: 2, semRepasse: 8, totalAmostra: 10, janelaDias: 30 });
    expect(s.status).toBe("atencao");
  });
});

describe("avaliarNotificacoes", () => {
  it("zero dispositivos ativos é atenção, não crítico (pode ser só ninguém ativou ainda)", () => {
    const s = avaliarNotificacoes({ dispositivosAtivos: 0, ultimoEventoVenda: null, ultimoPushTentado: null, ultimoPushAceito: null, errosRecentes: [] });
    expect(s.status).toBe("atencao");
  });

  it("com dispositivos e sem erro recente é saudável", () => {
    const s = avaliarNotificacoes({ dispositivosAtivos: 3, ultimoEventoVenda: "2026-08-10T10:00:00Z", ultimoPushTentado: "2026-08-10T10:00:01Z", ultimoPushAceito: "2026-08-10T10:00:02Z", errosRecentes: [] });
    expect(s.status).toBe("saudavel");
  });

  it("erro recente de entrega vira atenção mesmo com dispositivos ativos", () => {
    const s = avaliarNotificacoes({ dispositivosAtivos: 3, ultimoEventoVenda: null, ultimoPushTentado: null, ultimoPushAceito: null, errosRecentes: ["token inválido"] });
    expect(s.status).toBe("atencao");
  });

  it("erro recente NUNCA vaza token/payload — só o texto já sanitizado passado por quem chama", () => {
    const s = avaliarNotificacoes({ dispositivosAtivos: 1, ultimoEventoVenda: null, ultimoPushTentado: null, ultimoPushAceito: null, errosRecentes: ["destinatário bloqueou por preferência"] });
    const item = s.itens.find((i) => i.label.includes("Erros recentes"));
    expect(item?.nota).not.toMatch(/[A-Za-z0-9_-]{100,}/); // heurística: nenhum token longo colado
  });
});

describe("avaliarFirestoreRules", () => {
  it("falha de conexão é sempre crítico", () => {
    const s = avaliarFirestoreRules({ conexaoOk: false, publicadoIgual: null, publicadoEm: null });
    expect(s.status).toBe("critico");
  });

  it("não dá pra comparar (API de rules indisponível) vira sem-dados, não assume igual", () => {
    const s = avaliarFirestoreRules({ conexaoOk: true, publicadoIgual: null, publicadoEm: null });
    expect(s.status).toBe("sem-dados");
  });

  it("regra publicada IGUAL ao repositório é saudável", () => {
    const s = avaliarFirestoreRules({ conexaoOk: true, publicadoIgual: true, publicadoEm: "2026-08-10T00:00:00Z" });
    expect(s.status).toBe("saudavel");
  });

  it("regra publicada DIFERENTE do repositório é crítico — é o achado A1 da auditoria", () => {
    const s = avaliarFirestoreRules({ conexaoOk: true, publicadoIgual: false, publicadoEm: "2026-08-01T00:00:00Z" });
    expect(s.status).toBe("critico");
    const item = s.itens.find((i) => i.label.includes("=="));
    expect(item?.nota).toContain("deploy separado");
  });
});

describe("statusGeral — o pior status entre as seções vence", () => {
  it("uma seção crítica torna o geral crítico, mesmo com o resto saudável", () => {
    const geral = statusGeral([
      { titulo: "A", status: "saudavel", itens: [] },
      { titulo: "B", status: "critico", itens: [] },
      { titulo: "C", status: "saudavel", itens: [] },
    ]);
    expect(geral).toBe("critico");
  });

  it("sem nenhum crítico/atenção, sem-dados ainda pesa mais que saudável (não esconde lacuna)", () => {
    const geral = statusGeral([
      { titulo: "A", status: "saudavel", itens: [] },
      { titulo: "B", status: "sem-dados", itens: [] },
    ]);
    expect(geral).toBe("sem-dados");
  });

  it("tudo saudável é saudável", () => {
    const geral = statusGeral([
      { titulo: "A", status: "saudavel", itens: [] },
      { titulo: "B", status: "saudavel", itens: [] },
    ]);
    expect(geral).toBe("saudavel");
  });
});
