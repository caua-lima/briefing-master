import { NextResponse } from "next/server";
import { getMlAccessToken } from "../token";
import { isCronRequest } from "@/lib/api-auth";
import { currentMonthRangeBR, syncOrdersRange, syncReturnsRange } from "@/lib/ml/sync";

export const maxDuration = 60;

/**
 * Endpoint de sincronização automática, chamado pelo Vercel Cron.
 * O Vercel injeta `Authorization: Bearer <CRON_SECRET>` quando a env
 * CRON_SECRET está configurada — validamos isso via isCronRequest.
 *
 * Sincroniza o mês atual (pedidos + devoluções) para manter o dashboard
 * sempre atualizado sem depender do botão manual.
 */
export async function GET(req: Request) {
  if (!isCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const accessToken = await getMlAccessToken();
    if (!accessToken) {
      return NextResponse.json({ error: "Token ML não encontrado" }, { status: 400 });
    }

    const range = currentMonthRangeBR();
    const [savedOrders, savedReturns] = await Promise.all([
      syncOrdersRange(accessToken, range),
      syncReturnsRange(accessToken, range),
    ]);

    return NextResponse.json({ ok: true, savedOrders, savedReturns, at: new Date().toISOString() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "cron_sync_failed", details: msg }, { status: 500 });
  }
}
