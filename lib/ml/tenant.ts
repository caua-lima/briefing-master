import "server-only";
import { getAdminDb } from "@/lib/firebase/admin";
import { refreshAccessToken } from "@/lib/ml/client";

const ML_API = "https://api.mercadolibre.com";

/**
 * Conexões do Mercado Livre, UMA POR USUÁRIO (multi-tenant).
 *
 * Estas coleções são SERVER-ONLY de propósito: o firestore.rules não tem match
 * para elas, então o Firestore nega qualquer acesso vindo do cliente. Só o
 * Admin SDK (que ignora as regras) enxerga. É onde mora o refresh_token — se
 * ficasse em users/{uid}/… o próprio cliente conseguiria ler.
 */
const CONEXOES = "ml_conexoes";      // ml_conexoes/{uid}
const OAUTH_STATES = "ml_oauth_states"; // ml_oauth_states/{state}

export type MlConexao = {
  access_token?: string | null;
  refresh_token?: string | null;
  expires_in?: number | null;
  updated_at?: string | null;
  seller_id?: string | null; // conta ML do cliente (vem do /users/me)
  nickname?: string | null;
  conectado_em?: string | null;
};

const conexaoRef = (uid: string) => getAdminDb().collection(CONEXOES).doc(uid);

export async function getMlConexao(uid: string): Promise<MlConexao | null> {
  const snap = await conexaoRef(uid).get();
  return snap.exists ? (snap.data() as MlConexao) : null;
}

function expirado(c: MlConexao): boolean {
  if (!c.expires_in || !c.updated_at) return false;
  const updatedAt = Date.parse(c.updated_at);
  if (Number.isNaN(updatedAt)) return false;
  return Date.now() >= updatedAt + c.expires_in * 1000 - 60_000; // 1 min de folga
}

async function renovar(uid: string, c: MlConexao): Promise<string | null> {
  if (!c.refresh_token) return null;
  const novo = await refreshAccessToken(c.refresh_token);
  await conexaoRef(uid).set(
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

/** Access token válido do usuário (renova sozinho). null = não conectado. */
export async function getMlAccessToken(uid: string): Promise<string | null> {
  const c = await getMlConexao(uid);
  if (!c) return null;
  if (c.access_token && !expirado(c)) return c.access_token;
  if (!c.refresh_token) return c.access_token || null;
  return renovar(uid, c);
}

/** Igual ao anterior, mas lança quando não há conexão — para quem exige token. */
export async function getValidMlAccessToken(uid: string): Promise<string> {
  const token = await getMlAccessToken(uid);
  if (!token) {
    throw new Error("ml_nao_conectado: este usuário ainda não conectou a conta do Mercado Livre.");
  }
  return token;
}

/**
 * seller_id da conta ML DESTE usuário. Substitui a env ML_SELLER_ID, que só
 * servia no modelo de uma conta só.
 */
export async function getSellerId(uid: string): Promise<string> {
  const c = await getMlConexao(uid);
  if (c?.seller_id) return String(c.seller_id);
  // Conexão antiga sem seller_id salvo: busca e persiste.
  const token = await getValidMlAccessToken(uid);
  const me = await buscarConta(token);
  if (!me?.id) throw new Error("ml_sem_seller_id: não consegui identificar a conta do Mercado Livre.");
  await conexaoRef(uid).set({ seller_id: String(me.id), nickname: me.nickname ?? null }, { merge: true });
  return String(me.id);
}

/** Tudo que uma rota precisa saber do tenant, numa chamada só. */
export async function getTenantML(uid: string): Promise<{ token: string; sellerId: string }> {
  const token = await getValidMlAccessToken(uid);
  const sellerId = await getSellerId(uid);
  return { token, sellerId };
}

type ContaML = { id?: number | string; nickname?: string; email?: string };

async function buscarConta(token: string): Promise<ContaML | null> {
  const r = await fetch(`${ML_API}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) return null;
  return (await r.json()) as ContaML;
}

/** Salva a conexão após o OAuth, já resolvendo qual conta ML é. */
export async function salvarConexao(
  uid: string,
  tokens: { access_token?: string; refresh_token?: string; expires_in?: number },
): Promise<{ sellerId: string | null; nickname: string | null }> {
  const me = tokens.access_token ? await buscarConta(tokens.access_token) : null;
  await conexaoRef(uid).set(
    {
      access_token: tokens.access_token ?? null,
      refresh_token: tokens.refresh_token ?? null,
      expires_in: tokens.expires_in ?? null,
      seller_id: me?.id != null ? String(me.id) : null,
      nickname: me?.nickname ?? null,
      updated_at: new Date().toISOString(),
      conectado_em: new Date().toISOString(),
    },
    { merge: true },
  );
  return { sellerId: me?.id != null ? String(me.id) : null, nickname: me?.nickname ?? null };
}

export async function desconectarML(uid: string): Promise<void> {
  await conexaoRef(uid).delete();
}

export async function getStatusML(uid: string) {
  const c = await getMlConexao(uid);
  return {
    connected: Boolean(c?.refresh_token || c?.access_token),
    seller_id: c?.seller_id ?? null,
    nickname: c?.nickname ?? null,
    conectado_em: c?.conectado_em ?? null,
  };
}

// ── OAuth: carregar o uid através do redirect do ML ────────────────────
// O /api/ml/callback chega SEM sessão (é o ML redirecionando o navegador),
// então guardamos uid+verifier no servidor e passamos só um `state` opaco.

export async function criarOAuthState(uid: string, verifier: string): Promise<string> {
  const state = crypto.randomUUID().replace(/-/g, "");
  await getAdminDb().collection(OAUTH_STATES).doc(state).set({
    uid,
    verifier,
    criadoEm: Date.now(),
  });
  return state;
}

/** Lê e APAGA o state (uso único). Expira em 10 min. */
export async function consumirOAuthState(
  state: string,
): Promise<{ uid: string; verifier: string } | null> {
  if (!state) return null;
  const ref = getAdminDb().collection(OAUTH_STATES).doc(state);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const d = snap.data() as { uid?: string; verifier?: string; criadoEm?: number };
  await ref.delete().catch(() => {}); // uso único, mesmo se expirado
  if (!d?.uid || !d?.verifier) return null;
  if (Date.now() - Number(d.criadoEm ?? 0) > 10 * 60 * 1000) return null; // expirado
  return { uid: d.uid, verifier: d.verifier };
}
