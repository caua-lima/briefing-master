// app/api/ml/auth/route.ts
import { getAuthURL, generatePkce } from "@/lib/ml/client";
import { NextResponse } from "next/server";

export async function GET() {
  const { verifier, challenge } = generatePkce();

  const response = NextResponse.redirect(getAuthURL(challenge));
  // guarda o code_verifier para usar no callback (PKCE)
  response.cookies.set("ml_pkce_verifier", verifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
