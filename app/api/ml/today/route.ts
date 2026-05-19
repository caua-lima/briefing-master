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
    const url = `https://api.mercadolibre.com/orders/search?seller=me&order.date_created.from=${encodeURIComponent(from)}&order.date_created.to=${encodeURIComponent(to)}&order.status=paid&limit=200`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${access}` }, cache: "no-store" });
    if (!res.ok) {
      const txt = await res.text();
      return NextResponse.json({ error: "ml_fetch_failed", details: txt }, { status: 502 });
    }

    const json = await res.json();
    const results = json.results ?? [];

    let faturamento = 0;
    const perListing: Record<string, { title: string; vendas: number; faturamento: number }> = {};

    for (const o of results) {
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

    return NextResponse.json({ connected: true, faturamento, ordersCount: results.length, items });
  } catch (err: any) {
    return NextResponse.json({ error: "unexpected", details: err?.message || String(err) }, { status: 500 });
  }
}
