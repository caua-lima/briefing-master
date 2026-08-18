import "server-only";
import { getAdminDb } from "@/lib/firebase/admin";
import { refreshAccessToken } from "@/lib/ml/client";
import {
  licencaValida, normalizarPapel,
  type Licenca, type MembroTenant,
} from "@/lib/domain/tenant";

/**
 * Resolução de tenant no servidor — o lado de I/O de lib/domain/tenant.ts
 * (que é puro e tem os testes).
 *
 * Adaptado do lib/ml/tenant.ts do branch `saas`, com UMA mudança de fundo:
 * lá tudo era indexado por `uid`, aqui é por `tenantId`.
 *
 * ─── POR QUE A CONEXÃO DO ML É POR TENANT, NÃO POR uid ──────────────────
 *
 * No branch saas a conexão morava em `ml_conexoes/{uid}`. Isso quer dizer que
 * o colaborador, tendo outro uid, cairia numa conexão VAZIA — e teria que
 * conectar a própria conta do Mercado Livre para ver os pedidos da loja onde
 * trabalha. Não faz sentido: a conta ML é da OPERAÇÃO, não da pessoa. O sócio
 * não tem (nem deveria ter) credencial própria da loja.
 *
 * Indexando por tenantId, o Owner conecta uma vez e todo mundo do tenant
 * enxerga os mesmos pedidos — que é como o produto já funciona hoje.
 *
 * ─── SEGURANÇA ──────────────────────────────────────────────────────────
 *
 * `ml_conexoes` e `ml_oauth_states` NÃO têm match em firestore.rules.saas, de
 * propósito: sem regra, o Firestore nega tudo que vem do cliente e só o Admin
 * SDK enxerga. É onde mora o refresh_token — se o cliente pudesse ler, um
 * vazamento daria acesso à conta ML do vendedor. Há teste de emulador
 * cobrindo isso (nem o próprio owner lê).
 */

const ML_API = "https://api.mercadolibre.com";

const MEMBROS = "tenant_membros";   // tenant_membros/{uid}
const LICENCAS = "licencas";        // licencas/{email}
const CONEXOES = "ml_conexoes";     // ml_conexoes/{tenantId}  ← por TENANT

export type ContextoTenant = {
  uid: string;
  email: string;
  tenantId: string;
  membro: MembroTenant;
};

const conexaoRef = (tenantId: string) => getAdminDb().collection(CONEXOES).doc(tenantId);

/** Coleção de dados DESTE tenant. Tem que casar com o caminho que o cliente usa. */
export function tenantCol(tenantId: string, nome: string) {
  return getAdminDb().collection("tenants").doc(tenantId).collection(nome);
}

export async function getMembro(uid: string): Promise<MembroTenant | null> {
  const snap = await getAdminDb().collection(MEMBROS).doc(uid).get();
  if (!snap.exists) return null;
  const d = snap.data() ?? {};
  return {
    tenantId: String(d.tenantId ?? ""),
    email: String(d.email ?? ""),
    papel: normalizarPapel(d.papel),
    permissoesEdicao: Array.isArray(d.permissoesEdicao) ? d.permissoesEdicao : undefined,
    displayName: d.displayName,
    adicionadoEm: d.adicionadoEm,
    adicionadoPor: d.adicionadoPor,
  };
}

export async function getLicenca(email: string): Promise<Licenca | null> {
  const snap = await getAdminDb().collection(LICENCAS).doc(email.toLowerCase()).get();
  if (!snap.exists) return null;
  const d = snap.data() ?? {};
  // expiresAt pode vir como Timestamp do Firestore ou número — normaliza pra ms.
  const raw = d.expiresAt;
  const expiresAt =
    raw == null ? null
      : typeof raw === "number" ? raw
        : typeof raw?.toMillis === "function" ? raw.toMillis()
          : null;
  return {
    email: String(d.email ?? email),
    status: d.status === "suspenso" ? "suspenso" : "ativo",
    expiresAt,
    plano: d.plano,
    nota: d.nota,
  };
}

/**
 * Resolve o tenant de um usuário autenticado, já validando a licença.
 *
 * Devolve `null` em vez de lançar quando não resolve — quem chama decide se
 * é 401, 403 ou "ainda não fez onboarding". NUNCA cai num tenant padrão: era
 * exatamente esse fallback silencioso (`|| "2420261535"`) que fazia o sistema
 * servir dado da VAZXPRESS quando a resolução falhava.
 */
export async function resolverTenant(uid: string, email: string): Promise<ContextoTenant | null> {
  const membro = await getMembro(uid);
  if (!membro?.tenantId) return null;

  const licenca = await getLicenca(membro.email || email);
  if (!licencaValida(licenca, Date.now())) return null;

  return { uid, email, tenantId: membro.tenantId, membro };
}

// ── Conexão com o Mercado Livre, por tenant ────────────────────────

export type MlConexao = {
  access_token?: string | null;
  refresh_token?: string | null;
  expires_in?: number | null;
  updated_at?: string | null;
  seller_id?: string | null;
  nickname?: string | null;
  conectado_em?: string | null;
  /** uid de quem conectou — rastro, não autorização. */
  conectado_por?: string | null;
};

export async function getMlConexao(tenantId: string): Promise<MlConexao | null> {
  const snap = await conexaoRef(tenantId).get();
  return snap.exists ? (snap.data() as MlConexao) : null;
}

function expirado(c: MlConexao): boolean {
  if (!c.expires_in || !c.updated_at) return false;
  const updatedAt = Date.parse(c.updated_at);
  if (Number.isNaN(updatedAt)) return false;
  return Date.now() >= updatedAt + c.expires_in * 1000 - 60_000; // 1 min de folga
}

async function renovar(tenantId: string, c: MlConexao): Promise<string | null> {
  if (!c.refresh_token) return null;
  const novo = await refreshAccessToken(c.refresh_token);
  await conexaoRef(tenantId).set(
    {
      access_token: novo.access_token ?? null,
      refresh_token: novo.refresh_token ?? c.refresh_token,
      expires_in: novo.expires_in ?? c.expires_in,
      updated_at: new Date().toISOString(),
    },
    { merge: true },
  );
  return novo.access_token ?? null;
}

/** Token válido do tenant (renova sozinho). null = não conectado. */
export async function getMlAccessToken(tenantId: string): Promise<string | null> {
  const c = await getMlConexao(tenantId);
  if (!c) return null;
  if (c.access_token && !expirado(c)) return c.access_token;
  if (!c.refresh_token) return c.access_token || null;
  return renovar(tenantId, c);
}

export async function getValidMlAccessToken(tenantId: string): Promise<string> {
  const token = await getMlAccessToken(tenantId);
  if (!token) throw new Error("ml_nao_conectado: este tenant ainda não conectou a conta do Mercado Livre.");
  return token;
}

type ContaML = { id?: number | string; nickname?: string };

async function buscarConta(token: string): Promise<ContaML | null> {
  const r = await fetch(`${ML_API}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) return null;
  return (await r.json()) as ContaML;
}

/**
 * seller_id da conta ML DESTE tenant. Substitui a env `ML_SELLER_ID` e, mais
 * importante, o fallback `|| "2420261535"` que existia em 6 arquivos: aqui,
 * não conseguir resolver LANÇA, em vez de servir a conta do dono em silêncio.
 */
export async function getSellerId(tenantId: string): Promise<string> {
  const c = await getMlConexao(tenantId);
  if (c?.seller_id) return String(c.seller_id);

  const token = await getValidMlAccessToken(tenantId);
  const me = await buscarConta(token);
  if (!me?.id) throw new Error("ml_sem_seller_id: não consegui identificar a conta do Mercado Livre deste tenant.");
  await conexaoRef(tenantId).set({ seller_id: String(me.id), nickname: me.nickname ?? null }, { merge: true });
  return String(me.id);
}

/** Tudo que uma rota precisa do ML, numa chamada só. */
export async function getTenantML(tenantId: string): Promise<{ token: string; sellerId: string }> {
  const token = await getValidMlAccessToken(tenantId);
  const sellerId = await getSellerId(tenantId);
  return { token, sellerId };
}

/**
 * Qual tenant é dono desta conta do Mercado Livre?
 *
 * É o que o webhook precisa: o ML manda `user_id` (o seller), não o nosso
 * tenantId. Sem isto, o webhook grava o pedido de um cliente no espaço de
 * outro — hoje o handler nem olha de quem é o pedido.
 *
 * Consulta por `seller_id`, que é gravado no momento da conexão. Devolve null
 * quando nenhum tenant reivindica aquele seller: quem chama deve RECUSAR o
 * evento, nunca escolher um tenant padrão.
 */
export async function tenantPorSellerId(sellerId: string): Promise<string | null> {
  const id = String(sellerId ?? "").trim();
  if (!id) return null;
  const snap = await getAdminDb().collection(CONEXOES).where("seller_id", "==", id).limit(2).get();
  if (snap.empty) return null;
  if (snap.size > 1) {
    // Dois tenants com a mesma conta ML é estado inválido: não dá pra escolher
    // um sem chutar de quem é a venda. Recusa e deixa o erro visível.
    console.error("[tenant] seller_id reivindicado por mais de um tenant", { sellerId: id });
    return null;
  }
  return snap.docs[0].id;
}

export async function salvarConexao(
  tenantId: string,
  uid: string,
  tokens: { access_token?: string; refresh_token?: string; expires_in?: number },
): Promise<{ sellerId: string | null; nickname: string | null }> {
  const me = tokens.access_token ? await buscarConta(tokens.access_token) : null;
  await conexaoRef(tenantId).set(
    {
      access_token: tokens.access_token ?? null,
      refresh_token: tokens.refresh_token ?? null,
      expires_in: tokens.expires_in ?? null,
      updated_at: new Date().toISOString(),
      conectado_em: new Date().toISOString(),
      conectado_por: uid,
      ...(me?.id ? { seller_id: String(me.id) } : {}),
      ...(me?.nickname ? { nickname: me.nickname } : {}),
    },
    { merge: true },
  );
  return { sellerId: me?.id ? String(me.id) : null, nickname: me?.nickname ?? null };
}
