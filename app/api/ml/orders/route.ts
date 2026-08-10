import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { getMlAccessToken } from "../token";
import { requireAccess } from "@/lib/api-auth";

export async function POST(req: Request) {
  const gate = await requireAccess(req, { allowCron: true });
  if (gate instanceof NextResponse) return gate;

  try {
    const adminDb = getAdminDb();
    const accessToken = await getMlAccessToken();

    if (!accessToken) {
      return NextResponse.json(
        { error: "Token do Mercado Livre não encontrado ou expirado" },
        { status: 400 }
      );
    }

    const response = await fetch(
      "https://api.mercadolibre.com/orders/search?seller=me",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: "Erro ao buscar pedidos", details: text },
        { status: response.status }
      );
    }

    const data = (await response.json()) as { results?: Record<string, unknown>[] };
    const results = data.results ?? [];

    const batch = adminDb.batch();

    for (const order of results) {
      const orderId = String(order.id);
      const buyer = order.buyer as Record<string, unknown> | undefined;
      const shipping = order.shipping as Record<string, unknown> | undefined;
      const orderItems = (order.order_items as Record<string, unknown>[] | undefined) ?? [];

      batch.set(
        adminDb.collection("ml_orders").doc(orderId),
        {
          order_id: orderId,
          status: order.status ?? null,
          date_created: order.date_created ?? null,
          total_amount: order.total_amount ?? 0,
          currency: order.currency_id ?? "BRL",
          buyer_id: buyer?.id ? String(buyer.id) : null,
          shipping_status: shipping?.status ?? null,
          items: orderItems.map((item) => {
            const it = item.item as Record<string, unknown> | undefined;
            return {
              sku: it?.seller_sku ?? it?.id ?? null,
              title: it?.title ?? null,
              quantity: item.quantity ?? 0,
              unit_price: item.unit_price ?? 0,
            };
          }),
          raw: order,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }

    await batch.commit();

    return NextResponse.json({
      ok: true,
      saved: results.length,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Falha ao sincronizar pedidos", details: msg },
      { status: 500 }
    );
  }
}