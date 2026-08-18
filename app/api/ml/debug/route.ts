import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getMlAccessToken, resolverTenantDaRequisicao } from "@/lib/tenant";

export async function GET(req: Request) {
  const gate = await requireAccess(req, { adminOnly: true });
  if (gate instanceof NextResponse) return gate;

  const tenant = await resolverTenantDaRequisicao(gate);
  if (!tenant) return NextResponse.json({ error: "sem_tenant" }, { status: 403 });

  const token = await getMlAccessToken(tenant.tenantId);
  if (!token) return NextResponse.json({ error: "sem token" });

  const res = await fetch("https://api.mercadolibre.com/users/me", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  const body = await res.json();
  return NextResponse.json({ status: res.status, body, tokenPreview: token.slice(0, 30) + "..." });
}