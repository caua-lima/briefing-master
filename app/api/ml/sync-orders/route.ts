import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { currentMonthRangeBR, syncOrdersRange } from "@/lib/ml/sync";
import { getMlAccessToken, getSellerId, resolverTenantDaRequisicao } from "@/lib/tenant";

export const maxDuration = 60;

export async function POST(req: Request) {
  const gate = await requireAccess(req, { allowCron: true });
  if (gate instanceof NextResponse) return gate;

  const tenant = await resolverTenantDaRequisicao(gate);
  if (!tenant) return NextResponse.json({ error: "sem_tenant" }, { status: 403 });

  try {
    const accessToken = await getMlAccessToken(tenant.tenantId);
    if (!accessToken) {
      return NextResponse.json(
        { error: "Token do Mercado Livre não encontrado ou expirado" },
        { status: 400 },
      );
    }
    const sellerId = await getSellerId(tenant.tenantId);

    const saved = await syncOrdersRange(tenant.tenantId, accessToken, sellerId, currentMonthRangeBR());
    return NextResponse.json({ ok: true, saved });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Falha ao sincronizar pedidos", details: msg }, { status: 500 });
  }
}
