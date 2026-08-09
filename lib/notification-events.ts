import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import type { NotificationEvent } from "@/lib/domain/notifications";

const COL = "notification_events";

export type NewNotificationEvent = Omit<NotificationEvent, "id" | "createdAt" | "readBy" | "dismissedBy" | "delivery">;

/**
 * Cria o evento de forma idempotente: o `dedupeKey` (ex.: "sale_paid:2000123456")
 * É o id do documento, e `DocumentReference.create()` falha se o doc já
 * existir. Isso substitui o padrão antigo de "lê o campo notifiedPush numa
 * transação" por algo mais simples e igualmente atômico — o próprio
 * Firestore garante que só UMA chamada concorrente cria o doc, sem precisar
 * ler antes.
 *
 * Retorna `created: false` quando o evento já existia (retry do webhook do
 * ML, ou duas chamadas quase simultâneas pro mesmo pedido) — quem chama deve
 * pular o envio de push nesse caso, mas o evento em si já está lá, intacto.
 */
export async function createNotificationEventIdempotent(
  input: NewNotificationEvent,
): Promise<{ created: boolean; eventId: string }> {
  const db = getAdminDb();
  const ref = db.collection(COL).doc(input.dedupeKey);
  try {
    await ref.create({
      ...input,
      id: input.dedupeKey,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { created: true, eventId: input.dedupeKey };
  } catch (err) {
    // ALREADY_EXISTS (code 6) é o caso esperado de retry — qualquer outro
    // erro (permissão, rede) precisa subir de verdade pra quem chamou saber.
    const code = (err as { code?: number })?.code;
    if (code === 6) return { created: false, eventId: input.dedupeKey };
    throw err;
  }
}

/** Registra a tentativa de push — chamado ANTES de enviar, pra existir rastro mesmo se o envio falhar no meio do caminho. */
export async function markPushAttempted(eventId: string): Promise<void> {
  await getAdminDb().collection(COL).doc(eventId).update({
    "delivery.pushAttemptedAt": FieldValue.serverTimestamp(),
  }).catch(() => {});
}

/** Sucesso: pelo menos um dispositivo recebeu. */
export async function markPushDelivered(eventId: string): Promise<void> {
  await getAdminDb().collection(COL).doc(eventId).update({
    "delivery.pushDeliveredAt": FieldValue.serverTimestamp(),
  }).catch(() => {});
}

/**
 * Erro registrado é só um resumo curto (ex.: "sem dispositivos", "3/5 tokens
 * inválidos") — nunca o token FCM nem qualquer payload completo, pra não
 * vazar dado sensível num campo que fica lido por qualquer autorizado.
 */
export async function markPushError(eventId: string, resumoErro: string): Promise<void> {
  await getAdminDb().collection(COL).doc(eventId).update({
    "delivery.pushError": resumoErro.slice(0, 200),
  }).catch(() => {});
}
