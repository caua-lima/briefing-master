import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getMlAccessToken, resolverTenantDaRequisicao } from "@/lib/tenant";

const ML_API = "https://api.mercadolibre.com";

/** Diagnóstico das devoluções/claims: mostra a resposta crua da busca. */
export async function GET(req: Request) {
  const gate = await requireAccess(req, { adminOnly: true });
  if (gate instanceof NextResponse) return gate;

  const tenant = await resolverTenantDaRequisicao(gate);
  if (!tenant) return NextResponse.json({ error: "sem_tenant" }, { status: 403 });

  try {
    const token = await getMlAccessToken(tenant.tenantId);
    if (!token) return NextResponse.json({ error: "sem token" }, { status: 400 });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json", "x-format-new": "true" };

    const res = await fetch(`${ML_API}/post-purchase/v1/claims/search?sort=date_created,desc&limit=5`, { headers, cache: "no-store" });
    const body = await res.json().catch(() => null);

    return NextResponse.json({ status: res.status, body });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "debug_claims_failed", details: msg }, { status: 500 });
  }
}
