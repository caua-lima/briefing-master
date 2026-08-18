import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { desconectarML, resolverTenantDaRequisicao } from "@/lib/tenant";

export async function POST(req: Request) {
  const gate = await requireAccess(req, { adminOnly: true });
  if (gate instanceof NextResponse) return gate;

  const tenant = await resolverTenantDaRequisicao(gate);
  if (!tenant) return NextResponse.json({ error: "sem_tenant" }, { status: 403 });

  try {
    await desconectarML(tenant.tenantId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: "disconnect_failed", details: error?.message || String(error) }, { status: 500 });
  }
}
