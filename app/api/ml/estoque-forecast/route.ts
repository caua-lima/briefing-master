import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getMlAccessToken, getSellerId, resolverTenantDaRequisicao, tenantCol } from "@/lib/tenant";

const ML_API = "https://api.mercadolibre.com";

export const maxDuration = 30;

/**
 * Cache curto por lambda quente (evita bater no ML a cada abertura da aba),
 * indexado por TENANT — antes era uma única variável de módulo, sem chave:
 * a resposta de um cliente vazaria pro outro na próxima chamada.
 */
const cache = new Map<string, { at: number; dias: number; body: Record<string, unknown> }>();
const CACHE_TTL = 60 * 1000;

function normalizeItemId(s: string): string {
  return s.trim().toUpperCase().replace(/^MLB/, "");
}
function normalizeSku(s: string): string {
  return s.trim().toLowerCase();
}

/** Vendas (unidades) por produto nos últimos N dias → média diária p/ previsão. */
export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  const tenant = await resolverTenantDaRequisicao(gate);
  if (!tenant) return NextResponse.json({ error: "sem_tenant" }, { status: 403 });

  try {
    const url = new URL(req.url);
    const dias = Math.max(1, Math.min(180, Number(url.searchParams.get("dias") ?? 30) || 30));

    const hit = cache.get(tenant.tenantId);
    if (hit && hit.dias === dias && Date.now() - hit.at < CACHE_TTL) {
      return NextResponse.json({ ...hit.body, cached: true });
    }

    const token = await getMlAccessToken(tenant.tenantId);
    if (!token) return NextResponse.json({ error: "sem token", vendas: {}, dias }, { status: 200 });
    const SELLER_ID = await getSellerId(tenant.tenantId);

    // Mapa MLB/SKU → productId
    const prodSnap = await tenantCol(tenant.tenantId, "estoque").get();
    const porMlb = new Map<string, string>();
    const porSku = new Map<string, string>();
    for (const doc of prodSnap.docs) {
      const d = doc.data();
      const id = String(d.id ?? doc.id);
      const mlbs: string[] = Array.isArray(d.mlbs) && d.mlbs.length ? d.mlbs : d.mlb ? [String(d.mlb)] : [];
      for (const m of mlbs) { const n = normalizeItemId(String(m)); if (n) porMlb.set(n, id); }
      if (d.sku) porSku.set(normalizeSku(String(d.sku)), id);
    }

    // Janela em horário de Brasília
    const brNow = new Date(Date.now() - 3 * 3600 * 1000);
    const to = new Date(Date.UTC(brNow.getUTCFullYear(), brNow.getUTCMonth(), brNow.getUTCDate()));
    const from = new Date(to.getTime() - (dias - 1) * 86400000);
    const iso = (d: Date, end = false) =>
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}T${end ? "23:59:59.999" : "00:00:00.000"}-03:00`;
    const fromISO = iso(from);
    const toISO = iso(to, true);

    // Pedidos do período (paginado). Cancelados/inválidos não contam como venda.
    const vendas: Record<string, number> = {};
    let offset = 0;
    while (true) {
      const u =
        `${ML_API}/orders/search?seller=${SELLER_ID}` +
        `&order.date_created.from=${encodeURIComponent(fromISO)}` +
        `&order.date_created.to=${encodeURIComponent(toISO)}` +
        `&limit=50&offset=${offset}`;
      const res = await fetch(u, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" });
      if (!res.ok) break;
      const data = (await res.json()) as { results?: Record<string, unknown>[]; paging?: { total?: number } };
      const results = data.results ?? [];
      for (const o of results) {
        const status = String(o.status ?? "").toLowerCase();
        if (status === "cancelled" || status === "invalid") continue;
        const items = (o.order_items as Record<string, unknown>[]) ?? [];
        for (const it of items) {
          const item = (it.item as Record<string, unknown>) ?? {};
          const mlbNum = normalizeItemId(String(item.id ?? ""));
          const sku = normalizeSku(String(item.seller_sku ?? ""));
          const pid = porMlb.get(mlbNum) ?? porSku.get(sku);
          if (!pid) continue;
          vendas[pid] = (vendas[pid] ?? 0) + (Number(it.quantity ?? 0) || 0);
        }
      }
      const totalPag = data.paging?.total ?? 0;
      offset += results.length;
      if (offset >= totalPag || results.length === 0) break;
    }

    const body = { vendas, dias, from: fromISO.slice(0, 10), to: toISO.slice(0, 10) };
    cache.set(tenant.tenantId, { at: Date.now(), dias, body });
    return NextResponse.json(body);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "forecast_failed", details: msg, vendas: {}, dias: 30 }, { status: 500 });
  }
}
