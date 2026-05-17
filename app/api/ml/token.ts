import "server-only";
import { getAdminDb } from "../../../lib/firebase/admin";

export async function getMlAccessToken() {
  const db = getAdminDb();
  const doc = await db.collection("ml_tokens").doc("main").get();

  if (!doc.exists) return null;

  return doc.data()?.access_token || null;
}