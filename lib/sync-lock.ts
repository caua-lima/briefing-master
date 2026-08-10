import "server-only";
import { getAdminDb } from "@/lib/firebase/admin";
import type { DataFreshnessSource } from "@/lib/domain/freshness";

const COL = "sync_locks";

/**
 * Lock idempotente com expiração — impede duas sincronizações concorrentes
 * da MESMA fonte (clique duplo no botão manual, ou o cron disparando
 * enquanto uma sync manual já está no ar). Expira sozinho (TTL) em vez de
 * exigir um "release" garantido: se o processo travar/crashar no meio e
 * nunca chamar releaseSyncLock, o lock não fica preso pra sempre — depois
 * do TTL, a próxima tentativa pode reivindicar de novo.
 *
 * Implementado com uma transação: lê o lock atual, só escreve um novo se
 * não existir ou já tiver expirado — fecha a mesma janela de corrida que
 * o webhook do ML já resolvia com dedupeKey (ver lib/notification-events.ts),
 * só que aqui pra sincronização em vez de notificação.
 */
export async function acquireSyncLock(
  source: DataFreshnessSource,
  ttlMs = 5 * 60 * 1000,
): Promise<{ acquired: boolean; expiresAt?: string; heldUntil?: string }> {
  const db = getAdminDb();
  const ref = db.collection(COL).doc(source);
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const expiresAtExistente = snap.exists ? Date.parse(String(snap.data()?.expiresAt ?? "")) : NaN;
    const aindaValido = !Number.isNaN(expiresAtExistente) && expiresAtExistente > now;

    if (aindaValido) {
      return { acquired: false, heldUntil: new Date(expiresAtExistente).toISOString() };
    }

    const expiresAt = new Date(now + ttlMs).toISOString();
    tx.set(ref, { source, acquiredAt: new Date(now).toISOString(), expiresAt }, { merge: false });
    return { acquired: true, expiresAt };
  });
}

/** Libera o lock antes do TTL expirar — chamado no `finally` de quem adquiriu. Não é erro fatal se falhar (o TTL cobre). */
export async function releaseSyncLock(source: DataFreshnessSource): Promise<void> {
  await getAdminDb().collection(COL).doc(source).delete().catch(() => {});
}
