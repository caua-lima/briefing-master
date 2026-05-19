import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";

function monthRange(monthStr?: string) {
  const now = new Date();
  let year: number, month: number;
  if (!monthStr) {
    year = now.getFullYear();
    month = now.getMonth();
  } else {
    const [y, m] = monthStr.split("-").map(Number);
    year = y; month = (m - 1) || 0;
  }
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59));
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const month = url.searchParams.get("month") || undefined;
    const { start, end } = monthRange(month);

    const db = getAdminDb();

    // Orders
    const ordersSnap = await db.collection("ml_orders").where("date_created", ">=", start).where("date_created", "<=", end).get();
    const orders = ordersSnap.docs.map((d: any) => d.data());

    // Returns
    const returnsSnap = await db.collection("ml_returns").where("date_created", ">=", start).where("date_created", "<=", end).get();
    const returns = returnsSnap.docs.map((d: any) => d.data());

    // Manual costs (shared custos)
    const custosSnap = await db.collection("custos").get();
    const custos = custosSnap.docs.map((d: any) => d.data());

    // Products map to fetch cost per product
    const productsSnap = await db.collection("estoque").get();
    const products = productsSnap.docs.map((d: any) => d.data());
    const byProductId: Record<string, any> = {};
    for (const p of products) {
      byProductId[p.id] = p;
      if (p.mlb) byProductId[String(p.mlb)] = p;
    }

    let faturamento = 0;
    let cmv = 0; // cost of goods
    for (const o of orders) {
      faturamento += Number(o.total_amount || 0);
      for (const it of o.items ?? []) {
        const qty = Number(it.quantity || 0);
        const unit = Number(it.unit_price || 0);
        // try find product by sku or item id
        const sku = it.sku || it.item?.id || it.item?.seller_sku;
        const prod = sku ? byProductId[String(sku)] : null;
        const custoUnit = prod ? Number(prod.custo || 0) : 0;
        cmv += custoUnit * qty;
      }
    }

    const devolucoes = returns.reduce((s: number, r: any) => s + Number(r.total_amount || 0), 0);

    const custosOperacionais = custos.reduce((s: number, c: any) => s + Number(c.valor || 0), 0);

    // Ads - if present in ml_ads collection
    let adsTotal = 0;
    const adsSnap = await db.collection("ml_ads").where("date", ">=", start).where("date", "<=", end).get().catch(() => null);
    if (adsSnap) adsTotal = adsSnap.docs.reduce((s: number, d: any) => s + Number(d.data()?.cost || 0), 0);

    const bruto = faturamento - devolucoes - cmv;
    const liquido = bruto - custosOperacionais - adsTotal;

    return NextResponse.json({
      month: month || null,
      start,
      end,
      faturamento,
      cmv,
      devolucoes,
      custosOperacionais,
      adsTotal,
      bruto,
      liquido,
      ordersCount: orders.length,
      returnsCount: returns.length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: "metrics_failed", details: err?.message || String(err) }, { status: 500 });
  }
}
