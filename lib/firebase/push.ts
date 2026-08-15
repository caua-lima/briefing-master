"use client";

import { deleteDoc, doc, setDoc } from "firebase/firestore";
import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { getFirebase } from "./client";

const LOCAL_FLAG = "push_enabled";
const SW_PATH = "/firebase-messaging-sw.js";
const DEVICE_ID_KEY = "push_device_id";

/**
 * Id estável deste navegador/dispositivo, guardado no localStorage.
 *
 * Existe porque o token do FCM ROTACIONA (reinstalação do app, limpeza de
 * dados, renovação automática do Firebase). Antes o documento era
 * identificado pelo próprio token: cada rotação criava um documento NOVO e
 * o antigo ficava pra trás — como o token velho continua valendo por um
 * tempo, o mesmo aparelho recebia a notificação duas vezes. Com o id do
 * dispositivo como chave, renovar o token sobrescreve o mesmo registro.
 */
function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = (crypto.randomUUID?.() ?? `d${Date.now()}${Math.random().toString(36).slice(2)}`).replace(/[^a-zA-Z0-9-]/g, "");
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

/** Doc id determinístico por (usuário, dispositivo) — nunca acumula. */
function tokenDocId(email: string, deviceId: string): string {
  // "/" quebraria o caminho do documento no Firestore; o resto do e-mail é seguro.
  return `${email.replace(/\//g, "_")}__${deviceId}`;
}

type PushStatus = "unsupported" | "off" | "on" | "denied";

/** Estado atual, só olhando o navegador — não depende de round-trip com o Firestore. */
export async function getPushStatus(): Promise<PushStatus> {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return "unsupported";
  }
  if (!(await isSupported().catch(() => false))) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  return localStorage.getItem(LOCAL_FLAG) === "1" ? "on" : "off";
}

type EnableResult = { ok: true } | { ok: false; error: string };

/**
 * Pede permissão, registra o Service Worker de mensagens, gera o token FCM
 * do dispositivo e salva no Firestore associado ao e-mail — é essa lista de
 * tokens que o backend usa pra saber pra quem mandar quando sair uma venda.
 */
export async function enablePushNotifications(email: string): Promise<EnableResult> {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return { ok: false, error: "Este navegador não suporta notificações." };
  }
  if (!(await isSupported().catch(() => false))) {
    return { ok: false, error: "Este navegador não suporta notificações push." };
  }

  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) {
    return { ok: false, error: "Notificações ainda não configuradas neste projeto (falta a chave VAPID)." };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, error: "Permissão negada — ative notificações para este site nas configurações do navegador." };
  }

  try {
    const registration = await navigator.serviceWorker.register(SW_PATH);
    const { app, db } = getFirebase();
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
    if (!token) return { ok: false, error: "Não consegui gerar o token de notificação." };

    // Chave = (e-mail, dispositivo). Renovar o token sobrescreve este mesmo
    // documento em vez de criar outro, então nunca há dois registros vivos
    // pro mesmo aparelho (era a origem da notificação duplicada).
    const deviceId = getDeviceId();
    await setDoc(doc(db, "pushTokens", tokenDocId(email, deviceId)), {
      email,
      token,
      deviceId,
      updatedAt: Date.now(),
      userAgent: navigator.userAgent,
    });
    localStorage.setItem(LOCAL_FLAG, "1");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao ativar notificações." };
  }
}

/** Apaga o registro deste dispositivo — o backend para de mandar pra ele. */
export async function disablePushNotifications(email: string): Promise<void> {
  try {
    const { db } = getFirebase();
    // Apaga pelo id determinístico: não depende de conseguir gerar o token de
    // novo (que pode falhar se a permissão já foi revogada no navegador).
    await deleteDoc(doc(db, "pushTokens", tokenDocId(email, getDeviceId())));
  } catch {
    /* já não existia, ou sem permissão — o flag local abaixo é o que importa */
  } finally {
    localStorage.removeItem(LOCAL_FLAG);
  }
}

let foregroundInited = false;

/** Mesmos campos que lib/push-send.ts serializa em `data` — ver SalePushPayload em lib/domain/notifications.ts. */
export type ForegroundPushEvent = {
  eventId: string;
  type: string;
  title: string;
  body: string;
  tag: string;
  orderId?: string;
  deepLink: string;
  productName?: string;
  grossAmount?: string;
  estimatedProfit?: string;
  estimatedMargin?: string;
  financialState?: string;
  /** "1" = produto com campanha de Ads ativa (nao e atribuicao por pedido). */
  viaAds?: string;
  /** "1" = o proprio ML marcou esta venda como vinda de anuncio pago. */
  vendaPorPublicidade?: string;
  adsInvestido?: string;
  timestamp: string;
};

const foregroundListeners = new Set<(evt: ForegroundPushEvent) => void>();

/**
 * Assina eventos de push chegando com o app ABERTO — é o que alimenta o
 * toast premium (SaleNotificationProvider). Retorna a função de cancelar a
 * assinatura, padrão useEffect.
 */
export function onForegroundPush(cb: (evt: ForegroundPushEvent) => void): () => void {
  foregroundListeners.add(cb);
  return () => foregroundListeners.delete(cb);
}

/**
 * Com o app ABERTO em primeiro plano, o FCM não mostra notificação nativa
 * sozinho (isso só acontece em segundo plano, via Service Worker) — sem
 * isto, uma venda que chega com o dashboard aberto na tela passaria em
 * silêncio. Chamado uma vez na raiz do app; idempotente.
 *
 * NÃO abre mais um `new Notification()` nativo aqui: o toast premium (ver
 * components/SaleNotificationProvider.tsx) é a experiência de foreground —
 * mostrar os dois ao mesmo tempo duplicaria o aviso pro usuário com a aba
 * focada, o mesmo princípio de "nunca duas notificações pro mesmo evento"
 * que já rege a deduplicação por dispositivo.
 */
export async function initForegroundPush(): Promise<void> {
  if (foregroundInited || typeof window === "undefined") return;
  if (!(await isSupported().catch(() => false))) return;
  foregroundInited = true;

  const { app } = getFirebase();
  const messaging = getMessaging(app);
  onMessage(messaging, (payload) => {
    // Lê de "data", não "notification" — o envio manda só "data" de
    // propósito (ver lib/push-send.ts) pra nunca correr o risco do próprio
    // Firebase exibir a notificação em paralelo com este código.
    const d = payload.data;
    if (!d?.title) return;
    const evt: ForegroundPushEvent = {
      eventId: d.eventId ?? "", type: d.type ?? "system", title: d.title, body: d.body ?? "",
      tag: d.tag ?? "", orderId: d.orderId || undefined, deepLink: d.deepLink ?? "/",
      productName: d.productName || undefined, grossAmount: d.grossAmount || undefined,
      estimatedProfit: d.estimatedProfit || undefined, estimatedMargin: d.estimatedMargin || undefined,
      financialState: d.financialState || undefined,
      viaAds: d.viaAds || undefined, vendaPorPublicidade: d.vendaPorPublicidade || undefined,
      adsInvestido: d.adsInvestido || undefined,
      timestamp: d.timestamp ?? new Date().toISOString(),
    };
    foregroundListeners.forEach((cb) => cb(evt));
  });
}
