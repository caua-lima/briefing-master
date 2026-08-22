import { describe, expect, it } from "vitest";
import { montarDocsCliente, normalizarTenantId, senhaInicial, validarNovoCliente } from "./onboarding";

describe("normalizarTenantId — nome de empresa vira caminho de coleção", () => {
  it("acento vira letra simples, espaço vira hífen", () => {
    expect(normalizarTenantId("Loja do João")).toBe("loja-do-joao");
  });

  it("símbolo e pontuação viram hífen, sem repetir", () => {
    expect(normalizarTenantId("Erva & Cia — Ltda.")).toBe("erva-cia-ltda");
  });

  it("não sobra hífen nas pontas", () => {
    expect(normalizarTenantId("  ...Loja...  ")).toBe("loja");
  });

  it("corta em 40 sem deixar hífen solto na ponta", () => {
    const id = normalizarTenantId("a".repeat(38) + " " + "b".repeat(10));
    expect(id.length).toBeLessThanOrEqual(40);
    expect(id.endsWith("-")).toBe(false);
  });

  it("nome vazio devolve string vazia — a validação é quem recusa", () => {
    expect(normalizarTenantId("")).toBe("");
  });
});

describe("validarNovoCliente — o tenantId vira parte de todo caminho", () => {
  const base = { tenantId: "loja-do-joao", nome: "Loja do João", email: "joao@loja.com" };

  it("aceita um cliente bem formado", () => {
    expect(validarNovoCliente(base)).toEqual({ ok: true });
  });

  it("recusa maiúscula, espaço e acento no id", () => {
    for (const ruim of ["Loja", "loja do joao", "loja-joão", "loja/joao", "loja_joao"]) {
      const r = validarNovoCliente({ ...base, tenantId: ruim });
      expect(r.ok, `deveria recusar "${ruim}"`).toBe(false);
    }
  });

  it("recusa id começando por número ou hífen", () => {
    expect(validarNovoCliente({ ...base, tenantId: "1loja" }).ok).toBe(false);
    expect(validarNovoCliente({ ...base, tenantId: "-loja" }).ok).toBe(false);
  });

  it("recusa id reservado — 'main' era o doc do modelo single-tenant", () => {
    const r = validarNovoCliente({ ...base, tenantId: "main" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros[0]).toMatch(/reservado/);
  });

  it("recusa e-mail inválido", () => {
    expect(validarNovoCliente({ ...base, email: "joao" }).ok).toBe(false);
    expect(validarNovoCliente({ ...base, email: "joao@loja" }).ok).toBe(false);
  });

  it("recusa dias de licença negativos", () => {
    expect(validarNovoCliente({ ...base, diasLicenca: -1 }).ok).toBe(false);
  });

  it("aceita 0 dias — é 'sem prazo', não 'vencida'", () => {
    expect(validarNovoCliente({ ...base, diasLicenca: 0 })).toEqual({ ok: true });
  });

  it("junta TODOS os erros em vez de parar no primeiro", () => {
    const r = validarNovoCliente({ tenantId: "", nome: "", email: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.length).toBeGreaterThanOrEqual(3);
  });
});

describe("montarDocsCliente — as três peças, separadas", () => {
  const agora = Date.parse("2026-08-22T12:00:00.000Z");
  const c = { tenantId: "loja-do-joao", nome: "Loja do João", email: "Joao@Loja.com " };

  it("normaliza o e-mail: ele é a CHAVE da licença", () => {
    // licencas/{email} — maiúscula ou espaço criaria um doc que a regra do
    // Firestore (que compara com o e-mail do Auth) nunca acharia.
    const d = montarDocsCliente(c, "master@zxp.com", agora);
    expect(d.licenca.email).toBe("joao@loja.com");
    expect(d.membro.email).toBe("joao@loja.com");
  });

  it("sem dias, a licença fica SEM PRAZO (null), não vencida", () => {
    const d = montarDocsCliente(c, "master@zxp.com", agora);
    expect(d.licenca.expiresAt).toBeNull();
    expect(d.licenca.status).toBe("ativo");
  });

  it("com dias, calcula o vencimento a partir de agora", () => {
    const d = montarDocsCliente({ ...c, diasLicenca: 30 }, "master@zxp.com", agora);
    expect(d.licenca.expiresAt).toBe(agora + 30 * 86400000);
  });

  it("o dono entra como owner do PRÓPRIO tenant", () => {
    const d = montarDocsCliente(c, "master@zxp.com", agora);
    expect(d.membro.papel).toBe("owner");
    expect(d.membro.tenantId).toBe("loja-do-joao");
  });

  it("registra quem criou — a trilha de quem abriu a conta", () => {
    const d = montarDocsCliente(c, "master@zxp.com", agora);
    expect(d.tenant.criadoPor).toBe("master@zxp.com");
    expect(d.membro.adicionadoPor).toBe("master@zxp.com");
  });

  it("owner do tenant NÃO vira admin do SaaS — são coisas separadas", () => {
    // A colisão que o modelo antigo tinha: role "owner" queria dizer as duas
    // coisas. Nada aqui pode produzir um doc de saas_admins.
    const d = montarDocsCliente(c, "master@zxp.com", agora);
    expect(JSON.stringify(d)).not.toMatch(/saas_admin|master["']?\s*:/i);
  });

  it("é determinístico com o mesmo `agora`", () => {
    expect(montarDocsCliente(c, "m@z.com", agora)).toEqual(montarDocsCliente(c, "m@z.com", agora));
  });
});

describe("senhaInicial — conta criada por terceiro precisa de senha imprevisível", () => {
  it("tem 14 caracteres", () => {
    expect(senhaInicial()).toHaveLength(14);
  });

  it("não repete entre chamadas", () => {
    const n = new Set(Array.from({ length: 50 }, () => senhaInicial()));
    expect(n.size).toBe(50);
  });

  it("evita caracteres que se confundem ao ditar (O/0, I/l/1)", () => {
    // A senha é passada por WhatsApp ou lida em voz alta — "O" e "0" viram
    // suporte, não segurança.
    const s = Array.from({ length: 200 }, () => senhaInicial()).join("");
    expect(s).not.toMatch(/[O0Il1]/);
  });
});
