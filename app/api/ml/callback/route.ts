import { exchangeCodeForToken } from "@/lib/ml/client";
import { getAdminDb } from "@/lib/firebase/admin";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "Código ausente" }, { status: 400 });
  }

  try {
    const token = await exchangeCodeForToken(code);
    const adminDb = getAdminDb();

    await adminDb.collection("ml_tokens").doc("main").set({
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_in: token.expires_in,
      user_id: token.user_id,
      updated_at: new Date().toISOString(),
    });

    return NextResponse.redirect(new URL("/?ml=conectado", req.url));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(
      new URL(`/?ml=erro&msg=${encodeURIComponent(msg)}`, req.url)
    );
  }
}