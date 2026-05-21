import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { getMlAccessToken } from "../token";

function currentMonthRangeBR() {
  const now = new Date();
  const brTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const year = brTime.getUTCFullYear();
  const month = brTime.getUTCMonth(); // 0-indexed
  const mm = String(month + 1).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const ld = String(lastDay).padStart(2, "0");
  return {
    from: `${year}-${mm}-01T00:00:00.000-03:00`,
    to: `${year}-${mm}-${ld}T23:59:59.999-03:00`,
  };
}

async function syncOrders(accessToken: string) {
  const { from, to } = currentMonthRangeBR();
  const adminDb = getAdminDb();

  let allResults: Record<string, unknown>[] = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const url =
      `https://api.mercadolibre.com/orders/search?seller=me` +
      `&order.date_created.from=${encodeURIComponent(from)}` +
      `&order.date_created.to=${encodeURIComponent(to)}` +
      `&limit=${limit}&offset=${offset}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ML orders fetch failed: ${text}`);
    }

    const data = await response.json() as {
      results: Record<string, unknown>[];
      paging: { total: number };
    };

    const results = data.results ?? [];
    allResults = allResults.concat(results);

    const total = data.paging?.total ?? 0;
    offset += results.length;
    if (offset >= total || results.length === 0) break;
  }

  const BATCH_SIZE = 400;
  for (let i = 0; i < allResults.length; i += BATCH_SIZE) {
    const batch = adminDb.batch();
    for (const order of allResults.slice(i, i + BATCH_SIZE)) {
      const o = order as Record<string, unknown>;
      const orderId = String(o.id);
      batch.set(
        adminDb.collection("ml_orders").doc(orderId),
        {
          order_id: orderId,
          status: o.status ?? null,
          date_created: String(o.date_created ?? ""),
          total_amount: Number(o.total_amount ?? 0),
          currency: o.currency_id ?? "BRL",
          buyer_id: (o.buyer as Record<string, unknown>)?.id
            ? String((o.buyer as Record<string, unknown>).id)
            : null,
          items: ((o.order_items as Record<string, unknown>[]) ?? []).map((item) => ({
            sku:
              (item.item as Record<string, unknown>)?.seller_sku ??
              (item.item as Record<string, unknown>)?.id ??
              null,
            title: (item.item as Record<string, unknown>)?.title ?? null,
            quantity: Number(item.quantity ?? 0),
            unit_price: Number(item.unit_price ?? 0),
          })),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }
    await batch.commit();
  }

  return allResults.length;
}

async function syncReturns(accessToken: string) {
  const adminDb = getAdminDb();

  const url = `https://api.mercadolibre.com/orders/search?seller=me&order.status=cancelled&limit=50`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) return 0;

  const data = await response.json() as { results: Record<string, unknown>[] };
  const results = data.results ?? [];

  if (results.length === 0) return 0;

  const batch = adminDb.batch();
  for (const r of results) {
    const o = r as Record<string, unknown>;
    const id = String(o.id);
    batch.set(
      adminDb.collection("ml_returns").doc(id),
      {
        order_id: id,
        status: o.status ?? null,
        date_created: String(o.date_created ?? ""),
        total_amount: Number(o.total_amount ?? 0),
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  }
  await batch.commit();

  return results.length;
}

export async function POST() {
  try {
    const accessToken = await getMlAccessToken();

    if (!accessToken) {
      return NextResponse.json(
        { error: "Token do Mercado Livre não encontrado ou expirado" },
        { status: 400 }
      );
    }

    const [savedOrders, savedReturns] = await Promise.all([
      syncOrders(accessToken),
      syncReturns(accessToken),
    ]);

    return NextResponse.json({ ok: true, savedOrders, savedReturns });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "sync_failed", details: msg }, { status: 500 });
  }
}