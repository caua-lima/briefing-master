// app/api/ml/sync-orders/route.ts
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { getMlAccessToken } from "../token";

function currentMonthRange() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
  return {
    from: `${year}-${month}-01T00:00:00.000-03:00`,
    to:   `${year}-${month}-${lastDay}T23:59:59.999-03:00`,
  };
}

export async function POST() {
  try {
    const adminDb = getAdminDb();
    const accessToken = await getMlAccessToken();

    if (!accessToken) {
      return NextResponse.json(
        { error: "Token do Mercado Livre não encontrado ou expirado" },
        { status: 400 }
      );
    }

    const { from, to } = currentMonthRange();

    let allResults: any[] = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      const url = `https://api.mercadolibre.com/orders/search?seller=me&order.date_created.from=${encodeURIComponent(from)}&order.date_created.to=${encodeURIComponent(to)}&order.status=paid&limit=${limit}&offset=${offset}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
        cache: "no-store",
      });

      if (!response.ok) {
        const text = await response.text();
        return NextResponse.json(
          { error: "Erro ao buscar pedidos", details: text },
          { status: response.status }
        );
      }

      const data = await response.json();
      const results = data.results ?? [];
      allResults = allResults.concat(results);

      const total = data.paging?.total ?? 0;
      offset += results.length;

      if (offset >= total || results.length === 0) break;
    }

    const batch = adminDb.batch();

    for (const order of allResults) {
      const orderId = String(order.id);
      batch.set(
        adminDb.collection("ml_orders").doc(orderId),
        {
          order_id: orderId,
          status: order.status ?? null,
          date_created: order.date_created ?? null,
          total_amount: order.total_amount ?? 0,
          currency: order.currency_id ?? "BRL",
          buyer_id: order.buyer?.id ? String(order.buyer.id) : null,
          shipping_status: order.shipping?.status ?? null,
          items: (order.order_items ?? []).map((item: any) => ({
            sku: item.item?.seller_sku ?? item.item?.id ?? null,
            title: item.item?.title ?? null,
            quantity: item.quantity ?? 0,
            unit_price: item.unit_price ?? 0,
          })),
          raw: order,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }

    await batch.commit();

    return NextResponse.json({ ok: true, saved: allResults.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Falha ao sincronizar pedidos", details: msg },
      { status: 500 }
    );
  }
}