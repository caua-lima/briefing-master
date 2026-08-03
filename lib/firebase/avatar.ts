"use client";

import { updateProfile } from "firebase/auth";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getFirebase } from "./client";
import { updateAccessEntry } from "./data";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — evita foto gigante de celular travando o upload
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Sobe a foto de perfil pro Storage (sempre no mesmo caminho por uid, então
 * trocar de foto substitui a anterior em vez de acumular lixo) e atualiza o
 * `photoURL` do usuário no Firebase Auth — é essa fonte que a barra lateral
 * já lê (`user.photoURL`), então não precisa de mais nada pra aparecer.
 * Também tenta sincronizar o registro de acesso (best-effort: colaborador não
 * tem permissão de escrever ali, então essa parte pode falhar em silêncio
 * sem quebrar o essencial, que é o Auth).
 */
export async function uploadProfilePhoto(uid: string, email: string, file: File): Promise<string> {
  if (!ALLOWED.includes(file.type)) {
    throw new Error("Formato não suportado. Use JPG, PNG, WEBP ou GIF.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("Imagem muito grande (máx. 5MB).");
  }

  const { storage, auth } = getFirebase();
  const fileRef = ref(storage, `avatars/${uid}`);
  await uploadBytes(fileRef, file, { contentType: file.type });
  const url = await getDownloadURL(fileRef);

  if (auth.currentUser) {
    await updateProfile(auth.currentUser, { photoURL: url });
  }
  await updateAccessEntry(email, { photoURL: url }).catch(() => {});

  return url;
}
