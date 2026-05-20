// app/api/ml/auth/route.ts
import { getAuthURL } from "@/lib/ml/client";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const forceLogin = url.searchParams.get("login") === "true";
  
  const authUrl = getAuthURL(forceLogin);
  return NextResponse.redirect(authUrl);
}