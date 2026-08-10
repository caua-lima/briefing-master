import { NextResponse } from "next/server";
import { getMlAccessToken } from "../token";
import { isCronRequest } from "@/lib/api-auth";
import { currentMonthRangeBR, syncOrdersRange, syncReturnsRange } from "@/lib/ml/sync";
import { acquireSyncLock, releaseSyncLock } from "@/lib/sync-lock";
import { recordSyncAttempt, recordSyncFailure, recordSyncSuccess } from "@/lib/sync-runs";
import { sanitizeErrorForStorage } from "@/lib/domain/freshness";

export const maxDuration = 60;

/**
 * Endpoint de sincronização automática, chamado pelo Vercel Cron
 * (vercel.json: "0 6 * * *" — 06:00 UTC = 03:00 no fuso BR, todo dia). O
 * Vercel injeta `Authorization: Bearer <CRON_SECRET>` quando a env
 * CRON_SECRET está configurada — validamos isso via isCronRequest.
 *
 * Sincroniza o mês atual (pedidos + devoluções) para manter o dashboard
 * sempre atualizado sem depender do botão manual.
 *
 * Fase 4 (auditoria): antes disto, o resultado (savedOrders/savedReturns)
 * só existia na resposta HTTP — nada era persistido, então "quando rodou o
 * cron pela última vez" era literalmente impossível de responder (achado
 * A3/A4). Agora cada execução:
 *   1. adquire um lock por fonte (orders/claims) — impede que uma sync
 *      manual e o cron rodem ao mesmo tempo pra mesma fonte, brigando pelos
 *      mesmos documentos;
 *   2. registra tentativa ANTES de chamar o ML (existe rastro mesmo se
 *      travar/der timeout no meio);
 *   3. registra sucesso/falha no final, sempre liberando o lock no finally.
 *
 * Idempotência contra retry: syncOrdersRange/syncReturnsRange já gravam por
 * upsert (doc id = order_id, merge:true) — rodar duas vezes pro mesmo pedido
 * converge pro mesmo estado, nunca duplica. O lock aqui existe pra evitar
 * DESPERDÍCIO de chamada à API do ML concorrente, não pra evitar dado
 * duplicado (que já não acontecia).
 */
export async function GET(req: Request) {
  if (!isCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Dry-run só fora de produção: mostra o que SERIA sincronizado sem gravar
  // nada — útil pra testar o range/token sem gastar chamada de escrita real.
  const url = new URL(req.url);
  const dryRun = process.env.NODE_ENV !== "production" && url.searchParams.get("dryRun") === "1";

  const lockOrders = await acquireSyncLock("orders");
  const lockClaims = await acquireSyncLock("claims");
  if (!lockOrders.acquired || !lockClaims.acquired) {
    return NextResponse.json({
      ok: false,
      error: "sync_in_progress",
      details: "Já existe uma sincronização em andamento pra pedidos e/ou devoluções — provavelmente uma sync manual rodando ao mesmo tempo.",
      heldUntilOrders: lockOrders.heldUntil,
      heldUntilClaims: lockClaims.heldUntil,
    }, { status: 409 });
  }

  await Promise.all([recordSyncAttempt("orders"), recordSyncAttempt("claims")]);

  try {
    const accessToken = await getMlAccessToken();
    if (!accessToken) {
      const msg = "Token ML não encontrado";
      await Promise.all([recordSyncFailure("orders", msg), recordSyncFailure("claims", msg)]);
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const range = currentMonthRangeBR();

    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, range, note: "Nada foi sincronizado — dry-run." });
    }

    const [savedOrders, savedReturns] = await Promise.all([
      syncOrdersRange(accessToken, range),
      syncReturnsRange(accessToken, range),
    ]);

    await Promise.all([
      recordSyncSuccess("orders", savedOrders),
      recordSyncSuccess("claims", savedReturns),
    ]);

    return NextResponse.json({ ok: true, savedOrders, savedReturns, at: new Date().toISOString() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const sanitizado = sanitizeErrorForStorage(msg);
    await Promise.all([recordSyncFailure("orders", sanitizado), recordSyncFailure("claims", sanitizado)]);
    return NextResponse.json({ error: "cron_sync_failed", details: msg }, { status: 500 });
  } finally {
    await Promise.all([releaseSyncLock("orders"), releaseSyncLock("claims")]);
  }
}
