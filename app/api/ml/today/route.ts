import { NextResponse } from "next/server";
import { getMlAccessToken } from "../token";

function todayRangeISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const from = `${yyyy}-${mm}-${dd}T00:00:00.000-03:00`;
  const to = `${yyyy}-${mm}-${dd}T23:59:59.999-03:00`;
  return { from, to };
}

export async function GET() {
  try {
    const access = await getMlAccessToken();
    if (!access) return NextResponse.json({ error: "no_token", connected: false }, { status: 401 });

    const { from, to } = todayRangeISO();
    let nextUrl = `https://api.mercadolibre.com/orders/search?seller=me&order.date_created.from=${encodeURIComponent(from)}&order.date_created.to=${encodeURIComponent(to)}&order.status=paid&limit=100`;

    let allResults: any[] = [];
    while (nextUrl) {
      const pageRes = await fetch(nextUrl, { headers: { Authorization: `Bearer ${access}` }, cache: "no-store" });
      if (!pageRes.ok) {
        const txt = await pageRes.text();
        return NextResponse.json({ error: "ml_fetch_failed", details: txt }, { status: 502 });
      }

      const pageJson = await pageRes.json();
      const pageResults = pageJson.results ?? [];
      allResults = allResults.concat(pageResults);

      nextUrl = pageJson.paging?.next ?? null;
    }

    let faturamento = 0;
    const perListing: Record<string, { title: string; vendas: number; faturamento: number }> = {};

    for (const o of allResults) {
      faturamento += Number(o.total_amount || 0);
      for (const it of o.order_items ?? []) {
        const id = String(it.item?.id ?? it.item?.seller_sku ?? "unknown");
        const unit = Number(it.unit_price || 0);
        const qty = Number(it.quantity || 0);
        if (!perListing[id]) perListing[id] = { title: it.item?.title ?? id, vendas: 0, faturamento: 0 };
        perListing[id].vendas += qty;
        perListing[id].faturamento += unit * qty;
      }
    }

    const items = Object.entries(perListing).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.faturamento - a.faturamento);

    return NextResponse.json({ connected: true, faturamento, ordersCount: allResults.length, items });
  } catch (err: any) {
    return NextResponse.json({ error: "unexpected", details: err?.message || String(err) }, { status: 500 });
  }
}
