import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { buildFreshness, sanitizeErrorForStorage, type DataFreshness, type DataFreshnessSource } from "@/lib/domain/freshness";

const COL = "sync_runs";

// Depois de quanto tempo sem sucesso um dado bom vira "desatualizado" — cada
// fonte tem um ritmo esperado diferente (pedido é quase em tempo real via
// webhook + cron diário; Ads e estoque Full só são buscados quando alguém
// abre a aba, então toleram uma janela maior antes de soar alarme falso).
const STALE_AFTER_MIN: Record<DataFreshnessSource, number> = {
  orders: 90,
  claims: 24 * 60,
  mercado_pago: 24 * 60,
  ads: 6 * 60,
  full_stock: 6 * 60,
};

/** Chamado ANTES de tentar sincronizar — existe rastro mesmo se a chamada nunca terminar (timeout/crash). */
export async function recordSyncAttempt(source: DataFreshnessSource): Promise<void> {
  await getAdminDb().collection(COL).doc(source).set(
    { source, lastAttemptAt: FieldValue.serverTimestamp() },
    { merge: true },
  ).catch(() => {});
}

export async function recordSyncSuccess(
  source: DataFreshnessSource,
  recordsProcessed: number,
  coverage?: { expected?: number; processed?: number },
): Promise<void> {
  const db = getAdminDb();
  const patch: Record<string, unknown> = {
    source,
    lastSuccessAt: FieldValue.serverTimestamp(),
    lastAttemptFailed: false,
    lastError: FieldValue.delete(),
    recordsProcessed,
  };
  if (coverage) patch.coverage = coverage;
  await db.collection(COL).doc(source).set(patch, { merge: true }).catch(() => {});
}

/**
 * Erro sanitizado ANTES de chegar aqui, é responsabilidade de quem chama
 * (ver sanitizeErrorForStorage) — mas aplica de novo como rede de segurança,
 * igual ao padrão já usado em lib/notification-events.ts pra erro de push.
 */
export async function recordSyncFailure(source: DataFreshnessSource, error: string): Promise<void> {
  await getAdminDb().collection(COL).doc(source).set(
    { source, lastAttemptFailed: true, lastError: sanitizeErrorForStorage(error) },
    { merge: true },
  ).catch(() => {});
}

function toIso(v: unknown): string | null {
  const anyV = v as { toDate?: () => Date } | null;
  const d = anyV?.toDate?.();
  return d ? d.toISOString() : null;
}

export async function getFreshness(source: DataFreshnessSource): Promise<DataFreshness> {
  const doc = await getAdminDb().collection(COL).doc(source).get();
  const d = doc.data() ?? {};
  return buildFreshness(source, {
    lastSuccessAt: toIso(d.lastSuccessAt),
    lastAttemptAt: toIso(d.lastAttemptAt),
    lastAttemptFailed: !!d.lastAttemptFailed,
    lastError: d.lastError ?? null,
    recordsProcessed: d.recordsProcessed ?? null,
    coverage: d.coverage ?? null,
    staleAfterMinutes: STALE_AFTER_MIN[source],
  });
}

export async function getAllFreshness(): Promise<DataFreshness[]> {
  const sources: DataFreshnessSource[] = ["orders", "claims", "mercado_pago", "ads", "full_stock"];
  return Promise.all(sources.map(getFreshness));
}
