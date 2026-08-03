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

/**
 * Com o app ABERTO em primeiro plano, o FCM não mostra notificação nativa
 * sozinho (isso só acontece em segundo plano, via Service Worker) — sem
 * isto, uma venda que chega com o dashboard aberto na tela passaria em
 * silêncio. Chamado uma vez na raiz do app; idempotente.
 */
export async function initForegroundPush(): Promise<void> {
  if (foregroundInited || typeof window === "undefined") return;
  if (!(await isSupported().catch(() => false))) return;
  foregroundInited = true;

  const { app } = getFirebase();
  const messaging = getMessaging(app);
  onMessage(messaging, (payload) => {
    if (Notification.permission !== "granted") return;
    const title = payload.notification?.title ?? "Nova venda!";
    const bodyText = payload.notification?.body ?? "";
    // Mesma `tag` do Service Worker: com o app aberto E um aviso do mesmo
    // pedido já na tela, o sistema substitui em vez de mostrar dois.
    const tag = (payload.notification as { tag?: string } | undefined)?.tag;
    new Notification(title, { body: bodyText, icon: "/manifest-icon-192", tag });
  });
}
