import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebase/admin";
import { exchangeCodeForToken } from "@/lib/ml/client";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");

    if (!code) {
      return NextResponse.json({ error: "Missing code" }, { status: 400 });
    }

    const token = await exchangeCodeForToken(code);

    const db = getAdminDb();

    // try fetch the authenticated user's profile to store alongside tokens
    let userProfile: any = null;
    try {
      const profileRes = await fetch("https://api.mercadolibre.com/users/me", {
        headers: { Authorization: `Bearer ${token.access_token}` },
        cache: "no-store",
      });
      if (profileRes.ok) userProfile = await profileRes.json();
    } catch (e) {
      // ignore profile fetch errors, token still saved
    }

    await db.collection("ml_tokens").doc("main").set(
      {
        access_token: token.access_token || null,
        refresh_token: token.refresh_token || null,
        expires_in: token.expires_in || null,
        user_id: token.user_id || null,
        user_profile: userProfile,
        updated_at: new Date().toISOString(),
      },
      { merge: true }
    );

    // Redireciona para a home em vez de retornar JSON
    const response = NextResponse.redirect(new URL("/", req.url));
    // Limpa o flag de desconectado
    response.cookies.set("ml_disconnected", "false", { maxAge: 0 });
    return response;
  } catch (error: any) {
    return NextResponse.json(
      {
        error: "Unexpected error in callback",
        details: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}