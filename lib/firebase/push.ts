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
/**
 * Registra o Service Worker e GARANTE que a versão publicada é a que está
 * tratando os pushes.
 *
 * `register()` sozinho não basta. O navegador guarda o Service Worker em
 * cache e, mesmo quando baixa um novo, o antigo continua no comando até todas
 * as janelas do app fecharem — num PWA de celular, que vive em segundo plano,
 * isso pode não acontecer por dias. O resultado é uma correção publicada que
 * simplesmente não entra em vigor, sem nada indicando o porquê.
 *
 * `update()` força a checagem agora; o `skipWaiting`/`clients.claim` do lado
 * do Service Worker (ver app/firebase-messaging-sw.js/route.ts) faz o novo
 * assumir na hora. Ativar as notificações passa a ser também o botão de
 * "aplicar a versão nova", que é o gesto que o usuário já faz quando algo
 * não chega.
 */
async function registrarServiceWorkerAtualizado(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register(SW_PATH, { updateViaCache: "none" });
  // Best-effort: falha de rede aqui não pode impedir o registro do token.
  await registration.update().catch(() => {});
  return registration;
}

/** Versão do Service Worker ATIVO — pergunta direto a ele, não ao servidor. */
export async function versaoServiceWorkerAtivo(): Promise<string | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
    const sw = reg?.active;
    if (!sw) return null;
    return await new Promise<string | null>((resolve) => {
      const canal = new MessageChannel();
      // Service Worker antigo não conhece esta mensagem e nunca responde —
      // o timeout é o que transforma esse silêncio em "versão antiga".
      const timer = setTimeout(() => resolve(null), 1500);
      canal.port1.onmessage = (e) => {
        clearTimeout(timer);
        resolve(e.data?.versao ?? null);
      };
      sw.postMessage({ tipo: "versao" }, [canal.port2]);
    });
  } catch {
    return null;
  }
}

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
    const registration = await registrarServiceWorkerAtualizado();
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
  /** JSON de { title, quantity }[] — ver o campo homônimo em SalePushPayload. */
  itensJson?: string;
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
      itensJson: d.itensJson || undefined,
      timestamp: d.timestamp ?? new Date().toISOString(),
    };
    foregroundListeners.forEach((cb) => cb(evt));
  });
}
