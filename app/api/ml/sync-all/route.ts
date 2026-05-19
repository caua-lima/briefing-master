import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const origin = url.origin;

    const syncOrders = fetch(origin + "/api/ml/sync-orders", { method: "POST" });
    const syncReturns = fetch(origin + "/api/ml/returns");

    const [ordersRes, returnsRes] = await Promise.all([syncOrders, syncReturns]);

    const ordersJson = await ordersRes.json().catch(() => ({ error: "orders_failed" }));
    const returnsJson = await returnsRes.json().catch(() => ({ error: "returns_failed" }));

    return NextResponse.json({ ok: true, orders: ordersJson, returns: returnsJson });
  } catch (err: any) {
    return NextResponse.json({ error: "sync_failed", details: err?.message || String(err) }, { status: 500 });
  }
}
