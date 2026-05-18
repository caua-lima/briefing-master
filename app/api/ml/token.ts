import "server-only";
import { getAdminDb } from "../../../lib/firebase/admin";
import { refreshAccessToken } from "@/lib/ml/client";

export type MlTokenData = {
  access_token?: string | null;
  refresh_token?: string | null;
  expires_in?: number | null;
  user_id?: string | number | null;
  updated_at?: string | null;
};

export async function getMlTokenData(): Promise<MlTokenData | null> {
  const db = getAdminDb();
  const doc = await db.collection("ml_tokens").doc("main").get();

  if (!doc.exists) return null;
  return doc.data() as MlTokenData;
}

function tokenExpired(tokenData: MlTokenData) {
  if (!tokenData.expires_in || !tokenData.updated_at) return false;

  const updatedAt = Date.parse(tokenData.updated_at);
  if (Number.isNaN(updatedAt)) return false;

  const expiresAt = updatedAt + tokenData.expires_in * 1000;
  return Date.now() >= expiresAt - 60_000;
}

async function refreshMlTokens(tokenData: MlTokenData) {
  if (!tokenData.refresh_token) return null;

  const refreshed = await refreshAccessToken(tokenData.refresh_token);
  const db = getAdminDb();

  await db.collection("ml_tokens").doc("main").set(
    {
      access_token: refreshed.access_token ?? null,
      refresh_token: refreshed.refresh_token ?? tokenData.refresh_token,
      expires_in: refreshed.expires_in ?? tokenData.expires_in,
      user_id: refreshed.user_id ?? tokenData.user_id,
      updated_at: new Date().toISOString(),
    },
    { merge: true }
  );

  return refreshed.access_token ?? null;
}

export async function getMlTokenStatus() {
  const data = await getMlTokenData();
  return {
    connected: Boolean(data?.refresh_token || data?.access_token),
    user_id: data?.user_id ? String(data.user_id) : null,
  };
}

export async function getMlAccessToken() {
  const tokenData = await getMlTokenData();
  if (!tokenData) return null;

  if (tokenData.access_token && !tokenExpired(tokenData)) {
    return tokenData.access_token;
  }

  if (!tokenData.refresh_token) {
    return tokenData.access_token || null;
  }

  return refreshMlTokens(tokenData);
}
