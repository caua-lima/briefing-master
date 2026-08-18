import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getMlAccessToken, getSellerId, resolverTenantDaRequisicao } from "@/lib/tenant";
import {
  currentMonthRangeBR,
  lastNDaysRangeBR,
  syncOrdersRange,
  syncReturnsRange,
  syncClaimsRange,
  type SyncRange,
} from "@/lib/ml/sync";

export const maxDuration = 60;

function rangeFromRequest(req: Request): SyncRange {
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const days = url.searchParams.get("days");

  if (from && to) {
    return { from: `${from}T00:00:00.000-03:00`, to: `${to}T23:59:59.999-03:00` };
  }
  if (days) {
    const n = Number(days);
    if (Number.isFinite(n) && n > 0) return lastNDaysRangeBR(n);
  }
  return currentMonthRangeBR();
}

export async function POST(req: Request) {
  const gate = await requireAccess(req, { allowCron: true });
  if (gate instanceof NextResponse) return gate;

  const tenant = await resolverTenantDaRequisicao(gate);
  if (!tenant) return NextResponse.json({ error: "sem_tenant" }, { status: 403 });

  try {
    const accessToken = await getMlAccessToken(tenant.tenantId);
    if (!accessToken) {
      return NextResponse.json({ error: "Token não encontrado" }, { status: 400 });
    }
    const sellerId = await getSellerId(tenant.tenantId);

    const range = rangeFromRequest(req);
    const [savedOrders, savedReturns, savedClaims] = await Promise.all([
      syncOrdersRange(tenant.tenantId, accessToken, sellerId, range),
      syncReturnsRange(tenant.tenantId, accessToken, sellerId, range),
      syncClaimsRange(tenant.tenantId, accessToken, range).catch(() => 0), // best-effort
    ]);

    return NextResponse.json({ ok: true, savedOrders, savedReturns, savedClaims, range });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "sync_failed", details: msg }, { status: 500 });
  }
}
