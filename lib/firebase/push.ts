"use client";

import { deleteDoc, doc, setDoc } from "firebase/firestore";
import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { getFirebase } from "./client";

const LOCAL_FLAG = "push_enabled";
const SW_PATH = "/firebase-messaging-sw.js";

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

    await setDoc(doc(db, "pushTokens", token), {
      email,
      createdAt: Date.now(),
      userAgent: navigator.userAgent,
    });
    localStorage.setItem(LOCAL_FLAG, "1");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao ativar notificações." };
  }
}

/** Apaga o token deste dispositivo do Firestore — o backend para de mandar pra ele. */
export async function disablePushNotifications(): Promise<void> {
  try {
    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
    if (vapidKey && "serviceWorker" in navigator && Notification.permission === "granted") {
      const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
      if (registration) {
        const { app, db } = getFirebase();
        const messaging = getMessaging(app);
        const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration }).catch(() => null);
        if (token) await deleteDoc(doc(db, "pushTokens", token));
      }
    }
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
    new Notification(title, { body: bodyText, icon: "/manifest-icon-192" });
  });
}
