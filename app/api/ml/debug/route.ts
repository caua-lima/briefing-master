import { NextResponse } from "next/server";
import { getMlAccessToken } from "@/lib/ml/tenant";
import { requireAccess } from "@/lib/api-auth";

export async function GET(req: Request) {
  const gate = await requireAccess(req, { adminOnly: true });
  if (gate instanceof NextResponse) return gate;

  const token = await getMlAccessToken(gate.uid);
  if (!token) return NextResponse.json({ error: "sem token" });

  const res = await fetch("https://api.mercadolibre.com/users/me", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  const body = await res.json();
  return NextResponse.json({ status: res.status, body, tokenPreview: token.slice(0, 30) + "..." });
}