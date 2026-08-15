import { NextResponse } from "next/server";
import { getMlAccessToken } from "../token";
import { isCronRequest } from "@/lib/api-auth";
import { currentMonthRangeBR, previousMonthRangeBR, syncOrdersRange, syncReturnsRange, syncClaimsRange } from "@/lib/ml/sync";

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

    /**
     * Mes corrente + MES ANTERIOR.
     *
     * So o mes corrente deixava um buraco real: no dia 1o, tudo que ainda ia
     * mudar no mes que acabou parava de ser atualizado pra sempre — repasse do
     * Mercado Pago (money_release_date/net_received costumam cair dias depois
     * da venda), devolucao concluida em disputa, status de envio finalizando.
     * O fechamento do mes ficava congelado num estado que ainda ia mudar.
     */
    const atual = currentMonthRangeBR();
    const anterior = previousMonthRangeBR();

    const resultados = await Promise.all([
      syncOrdersRange(accessToken, atual),
      syncReturnsRange(accessToken, atual),
      // Reclamacoes/devolucoes ja rodavam no sync-all (botao manual) mas NAO
      // no cron: sem alguem abrir o app, devolucao nunca era atualizada
      // sozinha. Best-effort, igual la — nao pode derrubar o resto.
      syncClaimsRange(accessToken, atual).catch(() => 0),
      syncOrdersRange(accessToken, anterior),
      syncReturnsRange(accessToken, anterior),
      syncClaimsRange(accessToken, anterior).catch(() => 0),
    ]);
    const [ordensAtual, devAtual, claimsAtual, ordensAnterior, devAnterior, claimsAnterior] = resultados;

    return NextResponse.json({
      ok: true,
      atual: { orders: ordensAtual, returns: devAtual, claims: claimsAtual, range: atual },
      anterior: { orders: ordensAnterior, returns: devAnterior, claims: claimsAnterior, range: anterior },
      at: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "cron_sync_failed", details: msg }, { status: 500 });
  }
}
