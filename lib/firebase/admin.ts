import "server-only";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";
import { getSecurityRules } from "firebase-admin/security-rules";

function formatPrivateKey(key?: string) {
  if (!key) return undefined;
  return key.replace(/\\n/g, "\n");
}

function ensureAdminApp() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing Firebase Admin env vars");
  }

  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }
}

export function getAdminDb() {
  ensureAdminApp();
  return getFirestore();
}

export function getAdminAuth() {
  ensureAdminApp();
  return getAuth();
}

export function getAdminMessaging() {
  ensureAdminApp();
  return getMessaging();
}

/** Usado só pela Saúde da operação (Fase 1) pra comparar a regra REALMENTE publicada contra o arquivo local. */
export function getAdminSecurityRules() {
  ensureAdminApp();
  return getSecurityRules();
}