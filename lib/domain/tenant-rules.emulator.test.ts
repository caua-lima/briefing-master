/**
 * Isolamento entre tenants — provado contra as REGRAS DE VERDADE, não contra
 * a nossa lógica em TypeScript.
 *
 * lib/domain/tenant.test.ts já testa `podeAcessarTenant()`. Mas aquilo é a UX:
 * decide o que a interface mostra. Se `firestore.rules.saas` estiver frouxo,
 * qualquer um com o SDK do Firebase e um token válido lê o dado do vizinho
 * direto, sem passar pelo nosso código — e os 20 testes continuariam verdes.
 *
 * Por isso este arquivo sobe o emulador do Firestore, carrega o .rules real e
 * tenta o acesso indevido de fato. É o que transforma "multi-tenant" de
 * promessa em fato verificável.
 *
 * NÃO roda no `npm test` de propósito: exige emulador (e Java) no ambiente.
 * Roda com `npm run test:rules`, que sobe o emulador em volta (ver package.json).
 */

import { readFileSync } from "node:fs";
// Sem `expect`: quem afirma aqui é assertFails/assertSucceeds, que já falham
// o teste sozinhos — a asserção é o próprio acesso ser negado ou permitido.
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";

const T_A = "tenant-alfa";
const T_B = "tenant-beta";

const OWNER_A = { uid: "uid-owner-a", email: "owner-a@x.com" };
const COLAB_A = { uid: "uid-colab-a", email: "colab-a@x.com" };
const OWNER_B = { uid: "uid-owner-b", email: "owner-b@x.com" };
const SEM_VINCULO = { uid: "uid-zero", email: "zero@x.com" };

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "zxp-rules-test",
    firestore: {
      rules: readFileSync("firestore.rules.saas", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  // Semeia vínculos e licenças ignorando as regras — é o estado que o
  // servidor teria criado no onboarding.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "tenant_membros", OWNER_A.uid), { tenantId: T_A, email: OWNER_A.email, papel: "owner" });
    await setDoc(doc(db, "tenant_membros", COLAB_A.uid), { tenantId: T_A, email: COLAB_A.email, papel: "colaborador", permissoesEdicao: ["estoque"] });
    await setDoc(doc(db, "tenant_membros", OWNER_B.uid), { tenantId: T_B, email: OWNER_B.email, papel: "owner" });

    for (const e of [OWNER_A.email, COLAB_A.email, OWNER_B.email, SEM_VINCULO.email]) {
      await setDoc(doc(db, "licencas", e), { email: e, status: "ativo", expiresAt: null });
    }

    await setDoc(doc(db, "tenants", T_A, "estoque", "p1"), { name: "Erva do tenant A", custo: "10" });
    await setDoc(doc(db, "tenants", T_B, "estoque", "p1"), { name: "Erva do tenant B", custo: "20" });
    await setDoc(doc(db, "tenants", T_A, "ml_orders", "o1"), { total_amount: 100 });
  });
});

const como = (u: { uid: string; email: string }) =>
  env.authenticatedContext(u.uid, { email: u.email }).firestore();

describe("isolamento entre tenants — o que o SaaS promete", () => {
  it("owner do A LÊ o estoque do A", async () => {
    await assertSucceeds(getDoc(doc(como(OWNER_A), "tenants", T_A, "estoque", "p1")));
  });

  it("owner do A NÃO lê o estoque do B", async () => {
    await assertFails(getDoc(doc(como(OWNER_A), "tenants", T_B, "estoque", "p1")));
  });

  it("owner do A NÃO escreve no estoque do B", async () => {
    await assertFails(setDoc(doc(como(OWNER_A), "tenants", T_B, "estoque", "p1"), { name: "invadido" }));
  });

  it("owner do B NÃO lê o estoque do A — o inverso também vale", async () => {
    await assertFails(getDoc(doc(como(OWNER_B), "tenants", T_A, "estoque", "p1")));
  });

  it("usuário logado SEM vínculo não lê tenant nenhum", async () => {
    await assertFails(getDoc(doc(como(SEM_VINCULO), "tenants", T_A, "estoque", "p1")));
    await assertFails(getDoc(doc(como(SEM_VINCULO), "tenants", T_B, "estoque", "p1")));
  });

  it("anônimo não lê nada", async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, "tenants", T_A, "estoque", "p1")));
  });
});

describe("colaboração dentro do MESMO tenant — o que o modelo users/{uid} quebrava", () => {
  it("colaborador do A lê o estoque do A (mesmo espaço do owner)", async () => {
    await assertSucceeds(getDoc(doc(como(COLAB_A), "tenants", T_A, "estoque", "p1")));
  });

  it("colaborador edita a aba liberada", async () => {
    await assertSucceeds(setDoc(doc(como(COLAB_A), "tenants", T_A, "estoque", "p2"), { name: "novo", custo: "5" }));
  });

  it("colaborador NÃO edita aba não liberada", async () => {
    await assertFails(setDoc(doc(como(COLAB_A), "tenants", T_A, "custos", "c1"), { valor: 10 }));
  });

  it("owner edita qualquer aba, sem precisar de permissoesEdicao", async () => {
    await assertSucceeds(setDoc(doc(como(OWNER_A), "tenants", T_A, "custos", "c1"), { valor: 10 }));
  });

  it("colaborador NÃO alcança o tenant B", async () => {
    await assertFails(getDoc(doc(como(COLAB_A), "tenants", T_B, "estoque", "p1")));
  });
});

describe("licença — o portão comercial", () => {
  it("licença suspensa derruba o acesso do owner", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "licencas", OWNER_A.email), { email: OWNER_A.email, status: "suspenso" });
    });
    await assertFails(getDoc(doc(como(OWNER_A), "tenants", T_A, "estoque", "p1")));
  });

  it("licença vencida derruba o acesso", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "licencas", OWNER_A.email), {
        email: OWNER_A.email, status: "ativo", expiresAt: new Date(Date.now() - 86400000),
      });
    });
    await assertFails(getDoc(doc(como(OWNER_A), "tenants", T_A, "estoque", "p1")));
  });

  it("sem licença nenhuma não acessa, mesmo com vínculo válido", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "tenant_membros", "uid-sem-lic"), { tenantId: T_A, email: "semlic@x.com", papel: "owner" });
    });
    const semLic = env.authenticatedContext("uid-sem-lic", { email: "semlic@x.com" }).firestore();
    await assertFails(getDoc(doc(semLic, "tenants", T_A, "estoque", "p1")));
  });
});

describe("escalada de privilégio — o cliente não reescreve as próprias credenciais", () => {
  it("não muda o próprio papel para owner", async () => {
    await assertFails(setDoc(doc(como(COLAB_A), "tenant_membros", COLAB_A.uid), {
      tenantId: T_A, email: COLAB_A.email, papel: "owner",
    }));
  });

  it("não muda o próprio tenantId para o do vizinho", async () => {
    await assertFails(setDoc(doc(como(OWNER_A), "tenant_membros", OWNER_A.uid), {
      tenantId: T_B, email: OWNER_A.email, papel: "owner",
    }));
  });

  it("não cria vínculo para um uid qualquer", async () => {
    await assertFails(setDoc(doc(como(OWNER_A), "tenant_membros", "uid-inventado"), {
      tenantId: T_A, email: "x@x.com", papel: "owner",
    }));
  });

  it("não estende a própria licença", async () => {
    await assertFails(setDoc(doc(como(OWNER_A), "licencas", OWNER_A.email), {
      email: OWNER_A.email, status: "ativo", expiresAt: null,
    }));
  });

  it("não se promove a admin master do SaaS", async () => {
    await assertFails(setDoc(doc(como(OWNER_A), "saas_admins", OWNER_A.email), { email: OWNER_A.email }));
  });

  it("não lê o vínculo de um membro de OUTRO tenant", async () => {
    // Regressão: a 1ª versão da regra usava só `souOwner()`, que pergunta "sou
    // owner de alguma coisa?" e não "deste tenant". Vazava e-mail, papel e
    // tenantId do time do concorrente.
    await assertFails(getDoc(doc(como(OWNER_A), "tenant_membros", OWNER_B.uid)));
  });

  it("owner LÊ o vínculo de quem é do próprio tenant", async () => {
    // O contrapeso do teste acima: fechar demais quebraria a tela de time.
    await assertSucceeds(getDoc(doc(como(OWNER_A), "tenant_membros", COLAB_A.uid)));
  });

  it("não LISTA vínculos sem filtrar pelo próprio tenant", async () => {
    // Busca sem filtro alcançaria membros de todos os clientes. O Firestore só
    // aceita a query se toda linha do resultado satisfizer a regra.
    await assertFails(getDocs(collection(como(OWNER_A), "tenant_membros")));
  });

  it("lista vínculos do PRÓPRIO tenant quando a query é filtrada", async () => {
    await assertSucceeds(getDocs(
      query(collection(como(OWNER_A), "tenant_membros"), where("tenantId", "==", T_A)),
    ));
  });

  it("não lista vínculos filtrando pelo tenant do vizinho", async () => {
    await assertFails(getDocs(
      query(collection(como(OWNER_A), "tenant_membros"), where("tenantId", "==", T_B)),
    ));
  });
});

describe("dado vindo do Mercado Livre é somente-leitura pro cliente", () => {
  it("membro lê pedidos", async () => {
    await assertSucceeds(getDoc(doc(como(OWNER_A), "tenants", T_A, "ml_orders", "o1")));
  });

  it("nem o owner escreve pedido à mão — número de venda não se digita", async () => {
    await assertFails(setDoc(doc(como(OWNER_A), "tenants", T_A, "ml_orders", "o1"), { total_amount: 999999 }));
  });
});

describe("conexão do ML é invisível pro cliente (onde mora o refresh_token)", () => {
  it("nem o próprio owner lê a conexão ML do seu tenant", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "ml_conexoes", T_A), { refresh_token: "SEGREDO" });
    });
    await assertFails(getDoc(doc(como(OWNER_A), "ml_conexoes", T_A)));
  });
});
