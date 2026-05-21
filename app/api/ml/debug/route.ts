import { NextResponse } from "next/server";
import { getMlAccessToken } from "../token";

export async function GET() {
  const token = await getMlAccessToken();
  if (!token) return NextResponse.json({ error: "sem token" });

  const res = await fetch("https://api.mercadolibre.com/users/me", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  const body = await res.json();
  return NextResponse.json({ status: res.status, body, tokenPreview: token.slice(0, 30) + "..." });
}