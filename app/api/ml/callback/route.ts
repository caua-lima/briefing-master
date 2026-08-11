import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebase/admin";
import { exchangeCodeForToken } from "@/lib/ml/client";

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") ?? "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");

    if (!code) {
      return NextResponse.json({ error: "Missing code" }, { status: 400 });
    }

    // PKCE: recupera o code_verifier salvo no cookie pela rota /auth
    const codeVerifier = readCookie(req, "ml_pkce_verifier") ?? "";
    const token = await exchangeCodeForToken(code, codeVerifier);

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
    // Limpa o flag de desconectado e o verifier do PKCE
    response.cookies.set("ml_disconnected", "false", { maxAge: 0 });
    response.cookies.set("ml_pkce_verifier", "", { maxAge: 0, path: "/" });
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