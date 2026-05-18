import { getAdminDb } from "@/lib/firebase/admin";

export async function getValidMlAccessToken() {
  const db = getAdminDb();
  const ref = db.collection("ml_tokens").doc("main");
  const snap = await ref.get();

  if (!snap.exists) return null;

  const data = snap.data()!;
  const accessToken = data.access_token as string | undefined;
  const refreshToken = data.refresh_token as string | undefined;
  const updatedAt = data.updated_at ? new Date(data.updated_at) : null;
  const expiresIn = Number(data.expires_in ?? 0);

  if (!accessToken) return null;

  const expired =
    !updatedAt || Date.now() > updatedAt.getTime() + expiresIn * 1000 - 5 * 60 * 1000;

  if (!expired) return accessToken;

  if (!refreshToken) return null;

  const refreshRes = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.ML_CLIENT_ID!,
      client_secret: process.env.ML_CLIENT_SECRET!,
      refresh_token: refreshToken,
    }),
  });

  const refreshed = await refreshRes.json();

  if (!refreshRes.ok) return null;

  await ref.set(
    {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? refreshToken,
      expires_in: refreshed.expires_in ?? expiresIn,
      user_id: refreshed.user_id ?? data.user_id ?? null,
      updated_at: new Date().toISOString(),
    },
    { merge: true }
  );

  return refreshed.access_token as string;
}