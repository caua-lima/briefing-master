import { NextResponse } from "next/server";
import { isCronRequest } from "@/lib/api-auth";
import { getMlAccessToken, getSellerId, listarTenantsConectados } from "@/lib/ml/tenant";
import { currentMonthRangeBR, syncOrdersRange, syncReturnsRange } from "@/lib/ml/sync";

export const maxDuration = 60;

/**
 * Sincronização automática (Vercel Cron).
 *
 * Roda SEM usuário logado, então percorre todos os clientes com o ML conectado
 * e sincroniza a conta de cada um separadamente — cada tenant tem token,
 * vendedor e coleções próprios.
 *
 * Um cliente que falhe (token revogado, conta suspensa) não pode derrubar a
 * sincronização dos outros: cada um é tratado isoladamente e o erro é reportado
 * no resultado.
 */
export async function GET(req: Request) {
  if (!isCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const range = currentMonthRangeBR();
  const tenants = await listarTenantsConectados();
  const resultados: { uid: string; ok: boolean; orders?: number; returns?: number; erro?: string }[] = [];

  for (const t of tenants) {
    try {
      const token = await getMlAccessToken(t.uid);
      if (!token) {
        resultados.push({ uid: t.uid, ok: false, erro: "sem token" });
        continue;
      }
      const sellerId = t.sellerId ?? (await getSellerId(t.uid));
      const [orders, returns] = await Promise.all([
        syncOrdersRange(t.uid, sellerId, token, range),
        syncReturnsRange(t.uid, sellerId, token, range),
      ]);
      resultados.push({ uid: t.uid, ok: true, orders, returns });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      resultados.push({ uid: t.uid, ok: false, erro: msg.slice(0, 160) });
    }
  }

  return NextResponse.json({
    ok: true,
    tenants: tenants.length,
    sincronizados: resultados.filter((r) => r.ok).length,
    falhas: resultados.filter((r) => !r.ok).length,
    resultados,
    at: new Date().toISOString(),
  });
}
