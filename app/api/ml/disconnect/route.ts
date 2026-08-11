import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";

export async function POST(req: Request) {
  const gate = await requireAccess(req, { adminOnly: true });
  if (gate instanceof NextResponse) return gate;

  try {
    const db = getAdminDb();
    await db.collection("ml_tokens").doc("main").set(
      {
        access_token: null,
        refresh_token: null,
        expires_in: null,
        user_id: null,
        user_profile: null,
        updated_at: new Date().toISOString(),
      },
      { merge: true }
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: "disconnect_failed", details: error?.message || String(error) }, { status: 500 });
  }
}
