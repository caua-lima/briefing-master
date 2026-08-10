import { NextResponse } from "next/server";
import { getMlAccessToken } from "../token";
import { requireAccess } from "@/lib/api-auth";
import {
  currentMonthRangeBR,
  lastNDaysRangeBR,
  syncOrdersRange,
  syncReturnsRange,
  syncClaimsRange,
  type SyncRange,
} from "@/lib/ml/sync";
import { acquireSyncLock, releaseSyncLock } from "@/lib/sync-lock";
import { recordSyncAttempt, recordSyncFailure, recordSyncSuccess } from "@/lib/sync-runs";
import { sanitizeErrorForStorage } from "@/lib/domain/freshness";

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

/**
 * Sincronização manual (botão "Atualizar ML" do Dashboard) — mesma fonte
 * (orders/claims) que o cron automático usa, então precisa do MESMO lock:
 * sem isso, um clique duplo no botão (ou o cron disparando no meio de uma
 * sync manual) faria duas chamadas concorrentes à API do ML gastando cota
 * à toa, mesmo o resultado final sendo idempotente (upsert por order_id).
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req, { allowCron: true });
  if (gate instanceof NextResponse) return gate;

  const lockOrders = await acquireSyncLock("orders");
  const lockClaims = await acquireSyncLock("claims");
  if (!lockOrders.acquired || !lockClaims.acquired) {
    return NextResponse.json({
      ok: false,
      error: "sync_in_progress",
      details: "Já existe uma sincronização em andamento — aguarde terminar antes de tentar de novo.",
      heldUntilOrders: lockOrders.heldUntil,
      heldUntilClaims: lockClaims.heldUntil,
    }, { status: 409 });
  }

  await Promise.all([recordSyncAttempt("orders"), recordSyncAttempt("claims")]);

  try {
    const accessToken = await getMlAccessToken();
    if (!accessToken) {
      const msg = "Token não encontrado";
      await Promise.all([recordSyncFailure("orders", msg), recordSyncFailure("claims", msg)]);
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const range = rangeFromRequest(req);
    const [savedOrders, savedReturns, savedClaims] = await Promise.all([
      syncOrdersRange(accessToken, range),
      syncReturnsRange(accessToken, range),
      syncClaimsRange(accessToken, range).catch(() => 0), // best-effort
    ]);

    await Promise.all([
      recordSyncSuccess("orders", savedOrders),
      recordSyncSuccess("claims", savedReturns + savedClaims),
    ]);

    return NextResponse.json({ ok: true, savedOrders, savedReturns, savedClaims, range });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const sanitizado = sanitizeErrorForStorage(msg);
    await Promise.all([recordSyncFailure("orders", sanitizado), recordSyncFailure("claims", sanitizado)]);
    return NextResponse.json({ error: "sync_failed", details: msg }, { status: 500 });
  } finally {
    await Promise.all([releaseSyncLock("orders"), releaseSyncLock("claims")]);
  }
}
