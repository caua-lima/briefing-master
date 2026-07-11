import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdsFullByItem, probeAds, type AdItemFull } from "@/lib/ml/ads";

export const maxDuration = 30;

function todayISO(offsetDays = 0): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000 - offsetDays * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  try {
    const url = new URL(req.url);
    const from = url.searchParams.get("from") || todayISO(29);
    const to = url.searchParams.get("to") || todayISO(0);

    let items: AdItemFull[] = [];
    try {
      items = await getAdsFullByItem(from, to);
    } catch {
      const diag = await probeAds(from, to);
      return NextResponse.json({ error: "ads_failed", diag, from, to, items: [], totals: null });
    }

    // Totais + métricas derivadas
    const t = items.reduce(
      (a, i) => {
        a.cost += i.cost; a.clicks += i.clicks; a.prints += i.prints; a.sales += i.sales; a.units += i.units;
        return a;
      },
      { cost: 0, clicks: 0, prints: 0, sales: 0, units: 0 },
    );
    const totals = {
      ...t,
      ctr: t.prints > 0 ? (t.clicks / t.prints) * 100 : 0,
      cpc: t.clicks > 0 ? t.cost / t.clicks : 0,
      acos: t.sales > 0 ? (t.cost / t.sales) * 100 : 0,
      roas: t.cost > 0 ? t.sales / t.cost : 0,
      cvr: t.clicks > 0 ? (t.units / t.clicks) * 100 : 0,
      anuncios: items.length,
    };

    // ROAS por item pra ordenar e colorir
    const enriched = items
      .map((i) => ({ ...i, roas: i.cost > 0 ? i.sales / i.cost : 0 }))
      .sort((a, b) => b.cost - a.cost);

    return NextResponse.json({ items: enriched, totals, from, to });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "unexpected", details: msg, items: [], totals: null }, { status: 500 });
  }
}
