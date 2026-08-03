import "server-only";
import { getAdminDb, getAdminMessaging } from "@/lib/firebase/admin";

/**
 * Manda a mesma notificação pra TODOS os dispositivos registrados
 * (owner e colaborador, cada celular/navegador que ativou) — uma venda é
 * informação do time inteiro, não só de quem tá logado no momento.
 */
export async function sendPushToAll(title: string, body: string): Promise<void> {
  const db = getAdminDb();
  const snap = await db.collection("pushTokens").get();
  const tokens = snap.docs.map((d) => d.id);
  if (tokens.length === 0) return;

  const messaging = getAdminMessaging();
  const resp = await messaging.sendEachForMulticast({
    tokens,
    notification: { title, body },
    webpush: {
      notification: { icon: "/manifest-icon-192", badge: "/manifest-icon-192" },
      fcmOptions: { link: "/" },
    },
  });

  // Token morto (app desinstalado, permissão revogada, navegador nunca mais
  // aberto) — limpa da lista, senão ela só cresce e o próximo envio continua
  // tentando bater numa porta fechada pra sempre.
  const mortos: string[] = [];
  resp.responses.forEach((r, i) => {
    const code = r.error?.code;
    if (!r.success && (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token")) {
      mortos.push(tokens[i]);
    }
  });
  if (mortos.length > 0) {
    const batch = db.batch();
    mortos.forEach((t) => batch.delete(db.collection("pushTokens").doc(t)));
    await batch.commit();
  }
}
