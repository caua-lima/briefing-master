import "server-only";
import { getAdminDb, getAdminMessaging } from "@/lib/firebase/admin";

type Registro = {
  docId: string; token: string; updatedAt: number;
  deviceId: string; email: string; userAgent: string;
};

/** Assinatura do aparelho que TANTO o registro novo quanto o legado conseguem produzir. */
const assinatura = (r: Registro) => `${r.email}|${r.userAgent}`;

/** Fica com o mais recente entre dois registros do mesmo aparelho. */
function maisNovo(a: Registro, b: Registro): [Registro, string] {
  return b.updatedAt > a.updatedAt ? [b, a.docId] : [a, b.docId];
}

/**
 * Manda a mesma notificação pra TODOS os dispositivos registrados
 * (owner e colaborador, cada celular/navegador que ativou) — uma venda é
 * informação do time inteiro, não só de quem tá logado no momento.
 *
 * `tag` (e `collapseKey`) fazem o aparelho SUBSTITUIR uma notificação já
 * existente do mesmo pedido em vez de empilhar outra. É a rede de segurança:
 * mesmo que algo mande dois pushes do mesmo evento, o usuário vê um aviso só.
 */
export async function sendPushToAll(title: string, body: string, dedupeKey?: string): Promise<void> {
  const db = getAdminDb();
  const snap = await db.collection("pushTokens").get();

  /**
   * Um aparelho podia ter VÁRIOS registros vivos: antes o documento era
   * identificado pelo próprio token do FCM, e o token rotaciona — cada
   * rotação criava um documento novo sem apagar o antigo. Como o token velho
   * segue válido por um tempo, o mesmo celular recebia a notificação
   * duplicada. Aqui agrupamos por dispositivo e ficamos só com o registro
   * mais recente; os antigos são apagados.
   */
  const duplicados: string[] = [];
  const comDevice: Registro[] = [];
  const legados: Registro[] = [];

  for (const d of snap.docs) {
    const data = d.data() ?? {};
    const token = String(data.token ?? d.id); // legado: doc antigo tinha o token como id
    if (!token) continue;
    const r: Registro = {
      docId: d.id, token,
      updatedAt: Number(data.updatedAt ?? data.createdAt ?? 0),
      deviceId: String(data.deviceId ?? ""),
      email: String(data.email ?? ""),
      userAgent: String(data.userAgent ?? ""),
    };
    (r.deviceId ? comDevice : legados).push(r);
  }

  // 1) Registros novos: um por deviceId, o mais recente vence.
  const porDevice = new Map<string, Registro>();
  for (const r of comDevice) {
    const atual = porDevice.get(r.deviceId);
    if (!atual) { porDevice.set(r.deviceId, r); continue; }
    const [fica, sai] = maisNovo(atual, r);
    porDevice.set(r.deviceId, fica);
    duplicados.push(sai);
  }

  /**
   * 2) Registros LEGADOS (sem deviceId, criados quando o doc era identificado
   * pelo token). Se já existe um registro novo do MESMO aparelho — mesma
   * assinatura e-mail+navegador —, o legado é sobra da migração e vira
   * duplicata: sem este passo, o aparelho continuaria recebendo dois avisos
   * mesmo depois da correção.
   */
  const assinaturasNovas = new Set(Array.from(porDevice.values()).map(assinatura));
  const porLegado = new Map<string, Registro>();
  for (const r of legados) {
    const sig = assinatura(r);
    if (assinaturasNovas.has(sig)) { duplicados.push(r.docId); continue; }
    const atual = porLegado.get(sig);
    if (!atual) { porLegado.set(sig, r); continue; }
    const [fica, sai] = maisNovo(atual, r);
    porLegado.set(sig, fica);
    duplicados.push(sai);
  }

  const registros = [...porDevice.values(), ...porLegado.values()];
  // Mesmo token em dispositivos distintos não deveria acontecer, mas se
  // acontecer o FCM entregaria duas vezes — corta aqui também.
  const vistos = new Set<string>();
  const envio = registros.filter((r) => (vistos.has(r.token) ? false : (vistos.add(r.token), true)));

  if (duplicados.length > 0) {
    const batch = db.batch();
    duplicados.forEach((id) => batch.delete(db.collection("pushTokens").doc(id)));
    await batch.commit();
  }
  if (envio.length === 0) return;

  const tag = dedupeKey ? `venda-${dedupeKey}` : undefined;
  const messaging = getAdminMessaging();
  const resp = await messaging.sendEachForMulticast({
    tokens: envio.map((r) => r.token),
    notification: { title, body },
    android: tag ? { collapseKey: tag, notification: { tag } } : undefined,
    webpush: {
      headers: tag ? { Topic: tag } : undefined,
      notification: { icon: "/manifest-icon-192", badge: "/manifest-icon-192", tag },
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
      mortos.push(envio[i].docId);
    }
  });
  if (mortos.length > 0) {
    const batch = db.batch();
    mortos.forEach((id) => batch.delete(db.collection("pushTokens").doc(id)));
    await batch.commit();
  }
}
