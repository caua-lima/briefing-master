"use client";

import { getAuth } from "firebase/auth";

/**
 * fetch autenticado: anexa o ID token do Firebase no header Authorization para
 * que as rotas /api/ml/* possam validar o usuário no servidor.
 *
 * Se não houver usuário logado, faz a requisição sem o header (a rota
 * responderá 401, tratado pelo chamador).
 */
export async function authedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const user = getAuth().currentUser;
  const headers = new Headers(init.headers);

  if (user) {
    try {
      const token = await user.getIdToken();
      headers.set("Authorization", `Bearer ${token}`);
    } catch {
      /* segue sem token — rota retorna 401 */
    }
  }

  return fetch(input, { ...init, headers });
}
