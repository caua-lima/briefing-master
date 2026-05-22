import { getAdminDb } from "@/lib/firebase/admin";
import { refreshAccessToken } from "@/lib/ml/client";

export async function getValidMlAccessToken(): Promise<string> {
  const db  = getAdminDb();
  const doc = await db.collection("ml_tokens").doc("main").get();

  if (!doc.exists) throw new Error("Token ML não encontrado. Conecte o Mercado Livre.");

  const data        = doc.data()!;
  const accessToken = String(data.access_token ?? "");
  const updatedAt   = Number(data.updated_at ?? 0);   // timestamp em ms
  const expiresIn   = Number(data.expires_in ?? 21600); // segundos (padrão 6h)

  const expiresAt = updatedAt + expiresIn * 1000;
  const agora     = Date.now();

  // Se ainda válido (com 5 min de margem), retorna direto
  if (accessToken && agora < expiresAt - 5 * 60 * 1000) {
    return accessToken;
  }

  // Senão, renova com o refresh_token
  const refreshToken = String(data.refresh_token ?? "");
  if (!refreshToken) throw new Error("refresh_token ausente. Reconecte o Mercado Livre.");

  const novo = await refreshAccessToken(refreshToken);

  // Salva novo token no Firestore
  await db.collection("ml_tokens").doc("main").update({
    access_token:  novo.access_token,
    refresh_token: novo.refresh_token ?? refreshToken,
    expires_in:    novo.expires_in ?? expiresIn,
    updated_at:    Date.now(),
  });

  return String(novo.access_token);
}