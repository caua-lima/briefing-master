import { NextResponse } from "next/server";
import { getMlAccessToken } from "../token";
import { requireAccess } from "@/lib/api-auth";
import {
  currentMonthRangeBR,
  lastNDaysRangeBR,
  syncOrdersRange,
  syncReturnsRange,
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

  try {
    const accessToken = await getMlAccessToken();
    if (!accessToken) {
      return NextResponse.json({ error: "Token não encontrado" }, { status: 400 });
    }

    const range = rangeFromRequest(req);
    const [savedOrders, savedReturns] = await Promise.all([
      syncOrdersRange(accessToken, range),
      syncReturnsRange(accessToken, range),
    ]);

    return NextResponse.json({ ok: true, savedOrders, savedReturns, range });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "sync_failed", details: msg }, { status: 500 });
  }
}
