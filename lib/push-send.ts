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
 * Um aparelho podia ter VÁRIOS registros vivos: antes o documento era
 * identificado pelo próprio token do FCM, e o token rotaciona — cada rotação
 * criava um documento novo sem apagar o antigo. Como o token velho segue
 * válido por um tempo, o mesmo celular recebia a notificação duplicada.
 * Agrupa por dispositivo e fica só com o registro mais recente; os antigos
 * (`duplicados`) são devolvidos pra quem chamar apagar.
 */
function deduplicarPorDispositivo(docs: FirebaseFirestore.QueryDocumentSnapshot[]): { envio: Registro[]; duplicados: string[] } {
  const duplicados: string[] = [];
  const comDevice: Registro[] = [];
  const legados: Registro[] = [];

  for (const d of docs) {
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
  return { envio, duplicados };
}

/**
 * Manda `title`/`body` pros dispositivos em `registros`, com dedupe de
 * `tag`/`collapseKey` (o aparelho SUBSTITUI uma notificação já existente com
 * a mesma tag em vez de empilhar outra — rede de segurança extra, mesmo que
 * algo mande dois pushes do mesmo evento o usuário vê um aviso só). Limpa
 * token morto (app desinstalado, permissão revogada) sozinho.
 * Retorna quantos dispositivos realmente receberam.
 */
async function enviarPara(registros: Registro[], title: string, body: string, dedupeKey?: string): Promise<number> {
  if (registros.length === 0) return 0;
  const db = getAdminDb();
  const tag = dedupeKey ? `${dedupeKey}` : undefined;
  const messaging = getAdminMessaging();
  const resp = await messaging.sendEachForMulticast({
    tokens: registros.map((r) => r.token),
    notification: { title, body },
    android: tag ? { collapseKey: tag, notification: { tag } } : undefined,
    webpush: {
      headers: tag ? { Topic: tag } : undefined,
      notification: { icon: "/manifest-icon-192", badge: "/manifest-icon-192", tag },
      fcmOptions: { link: "/" },
    },
  });

  const mortos: string[] = [];
  resp.responses.forEach((r, i) => {
    const code = r.error?.code;
    if (!r.success && (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token")) {
      mortos.push(registros[i].docId);
    }
  });
  if (mortos.length > 0) {
    const batch = db.batch();
    mortos.forEach((id) => batch.delete(db.collection("pushTokens").doc(id)));
    await batch.commit();
  }
  return resp.successCount;
}

/**
 * Manda a mesma notificação pra TODOS os dispositivos registrados
 * (owner e colaborador, cada celular/navegador que ativou) — uma venda é
 * informação do time inteiro, não só de quem tá logado no momento.
 *
 * `dedupeKey` normalmente é o id do pedido — ver `enviarPara`.
 */
export async function sendPushToAll(title: string, body: string, dedupeKey?: string): Promise<void> {
  const db = getAdminDb();
  const snap = await db.collection("pushTokens").get();
  const { envio, duplicados } = deduplicarPorDispositivo(snap.docs);

  if (duplicados.length > 0) {
    const batch = db.batch();
    duplicados.forEach((id) => batch.delete(db.collection("pushTokens").doc(id)));
    await batch.commit();
  }

  await enviarPara(envio, title, body, dedupeKey ? `venda-${dedupeKey}` : undefined);
}

/**
 * Manda uma notificação só pros dispositivos de UM e-mail — usado pelo botão
 * "Enviar teste": prova que o pipeline inteiro funciona (token salvo no
 * Firestore → FCM aceita → aparelho de fato mostra o aviso) sem incomodar o
 * resto do time. Retorna quantos dispositivos desse usuário receberam, pra
 * UI poder dizer "nenhum dispositivo seu está registrado" quando for 0.
 */
export async function sendPushToUser(email: string, title: string, body: string): Promise<{ enviados: number }> {
  const db = getAdminDb();
  const snap = await db.collection("pushTokens").where("email", "==", email).get();
  const { envio, duplicados } = deduplicarPorDispositivo(snap.docs);

  if (duplicados.length > 0) {
    const batch = db.batch();
    duplicados.forEach((id) => batch.delete(db.collection("pushTokens").doc(id)));
    await batch.commit();
  }

  const enviados = await enviarPara(envio, title, body);
  return { enviados };
}
