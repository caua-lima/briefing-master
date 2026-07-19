import { NextResponse } from "next/server";
import { tenantCol } from "@/lib/ml/tenant";
import { getAdminDb } from "../../../../lib/firebase/admin";
import { getMlAccessToken, getSellerId } from "@/lib/ml/tenant";
import { requireAccess } from "@/lib/api-auth";

export async function GET(req: Request) {
  const gate = await requireAccess(req, { allowCron: true });
  if (gate instanceof NextResponse) return gate;

  try {
    const token = await getMlAccessToken(gate.uid);

    if (!token) {
      return NextResponse.json(
        { error: "No Mercado Livre token found" },
        { status: 401 }
      );
    }

    const sellerId = await getSellerId(gate.uid);

    if (!sellerId) {
      return NextResponse.json(
        { error: "ML_SELLER_ID not configured" },
        { status: 500 }
      );
    }

    const response = await fetch(
      `https://api.mercadolibre.com/orders/search?seller=${sellerId}&order.status=cancelled`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: "Failed to fetch returns", details: text },
        { status: 500 }
      );
    }

    const data = await response.json();
    const orders = data.results ?? [];
    const db = getAdminDb();

    const returns = orders.map((order: any) => ({
      id: String(order.id),
      date_created: order.date_created ?? null,
      status: order.status ?? null,
      total_amount: order.total_amount ?? 0,
      currency_id: order.currency_id ?? "BRL",
      buyer: order.buyer ?? null,
      shipping: order.shipping ?? null,
      raw: order,
      updatedAt: new Date().toISOString(),
    }));

    const batch = db.batch();

    returns.forEach((item: any) => {
      const ref = tenantCol(gate.uid, "ml_returns").doc(item.id);
      batch.set(ref, item, { merge: true });
    });

    await batch.commit();

    return NextResponse.json({
      success: true,
      count: returns.length,
      data: returns,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: "Unexpected error syncing returns",
        details: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}