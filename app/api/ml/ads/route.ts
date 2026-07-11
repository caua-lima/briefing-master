import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdsFullByItem, probeAds } from "@/lib/ml/ads";
import { getMlAccessToken } from "../token";

export const maxDuration = 30;
const ML_API = "https://api.mercadolibre.com";
const SELLER_ID = process.env.ML_SELLER_ID || "2420261535";

function todayISO(offsetDays = 0): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000 - offsetDays * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Vendas totais (todos os canais) por item MLB no período — base da análise "Geral". */
async function vendasTotaisPorItem(token: string, from: string, to: string): Promise<Map<string, { receita: number; unidades: number }>> {
  const map = new Map<string, { receita: number; unidades: number }>();
  const fromISO = `${from}T00:00:00.000-03:00`;
  const toISO = `${to}T23:59:59.999-03:00`;
  let offset = 0;
  while (offset < 4000) {
    const url =
      `${ML_API}/orders/search?seller=${SELLER_ID}` +
      `&order.date_created.from=${encodeURIComponent(fromISO)}&order.date_created.to=${encodeURIComponent(toISO)}` +
      `&limit=50&offset=${offset}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" });
    if (!r.ok) break;
    const j = (await r.json()) as { results?: Record<string, unknown>[]; paging?: { total?: number } };
    const results = j.results ?? [];
    for (const o of results) {
      const st = String(o.status ?? "").toLowerCase();
      if (st === "cancelled" || st === "invalid") continue;
      for (const it of (o.order_items as Record<string, unknown>[]) ?? []) {
        const item = (it.item as Record<string, unknown>) ?? {};
        const id = String(item.id ?? "").trim().toUpperCase();
        if (!id) continue;
        const qty = Number(it.quantity ?? 0) || 0;
        const cur = map.get(id) ?? { receita: 0, unidades: 0 };
        cur.receita += Number(it.unit_price ?? 0) * qty;
        cur.unidades += qty;
        map.set(id, cur);
      }
    }
    const total = j.paging?.total ?? 0;
    offset += results.length;
    if (results.length === 0 || offset >= total) break;
  }
  return map;
}

export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  try {
    const url = new URL(req.url);
    const from = url.searchParams.get("from") || todayISO(29);
    const to = url.searchParams.get("to") || todayISO(0);

    let ads;
    try {
      ads = await getAdsFullByItem(from, to);
    } catch {
      const diag = await probeAds(from, to);
      return NextResponse.json({ error: "ads_failed", diag, from, to, items: [] });
    }

    const token = await getMlAccessToken();
    const vendas = token ? await vendasTotaisPorItem(token, from, to).catch(() => new Map()) : new Map();

    const items = ads.map((a) => {
      const v = vendas.get(a.itemId) ?? { receita: 0, unidades: 0 };
      return {
        itemId: a.itemId,
        title: a.title,
        clicks: a.clicks,
        prints: a.prints,
        cost: a.cost,
        directSales: a.directSales,
        directUnits: a.directUnits,
        adSales: a.sales,           // atribuída (direto+indireto)
        adUnits: a.units,
        totalSales: v.receita,      // GERAL: todos os canais (inclui sem tráfego)
        totalUnits: v.unidades,
      };
    }).sort((x, y) => y.cost - x.cost);

    return NextResponse.json({ items, from, to });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "unexpected", details: msg, items: [] }, { status: 500 });
  }
}
