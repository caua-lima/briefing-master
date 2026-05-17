import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebase/admin";

async function getAuthToken() {
  const db = getAdminDb();
  const doc = await db.collection("ml_tokens").doc("main").get();

  if (!doc.exists) return null;

  return doc.data()?.access_token || null;
}

export async function GET() {
  try {
    const token = await getAuthToken();

    if (!token) {
      return NextResponse.json(
        { error: "No Mercado Livre token found" },
        { status: 401 }
      );
    }

    const sellerId = process.env.ML_SELLER_ID;

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
      const ref = db.collection("ml_returns").doc(item.id);
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