import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebase/admin";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");

    if (!code) {
      return NextResponse.json({ error: "Missing code" }, { status: 400 });
    }

    const tokenRes = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: process.env.ML_CLIENT_ID || "",
        client_secret: process.env.ML_CLIENT_SECRET || "",
        code,
        redirect_uri: process.env.ML_REDIRECT_URI || "",
      }),
    });

    const token = await tokenRes.json();

    if (!tokenRes.ok) {
      return NextResponse.json(
        { error: "Token exchange failed", details: token },
        { status: 500 }
      );
    }

    const db = getAdminDb();

    await db.collection("ml_tokens").doc("main").set(
      {
        access_token: token.access_token || null,
        refresh_token: token.refresh_token || null,
        expires_in: token.expires_in || null,
        user_id: token.user_id || null,
        updated_at: new Date().toISOString(),
      },
      { merge: true }
    );

    return NextResponse.json({
      success: true,
      connected: true,
      user_id: token.user_id || null,
    });
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