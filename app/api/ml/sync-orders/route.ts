import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { getMlAccessToken } from "../token";

function currentMonthRangeBR() {
  // Força fuso Brasília (UTC-3) no servidor Vercel que roda UTC
  const now = new Date();
  const brTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const year = brTime.getUTCFullYear();
  const month = brTime.getUTCMonth(); // 0-indexed
  const mm = String(month + 1).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const ld = String(lastDay).padStart(2, "0");
  return {
    from: `${year}-${mm}-01T00:00:00.000-03:00`,
    to:   `${year}-${mm}-${ld}T23:59:59.999-03:00`,
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

    const { from, to } = currentMonthRangeBR();

    let allResults: Record<string, unknown>[] = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      // Sem filtro de status — igual ao painel do ML
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
        return NextResponse.json({ error: "Erro ao buscar pedidos", details: text }, { status: response.status });
      }

      const data = await response.json() as { results: Record<string, unknown>[]; paging: { total: number } };
      const results = data.results ?? [];
      allResults = allResults.concat(results);

      const total = data.paging?.total ?? 0;
      offset += results.length;
      if (offset >= total || results.length === 0) break;
    }

    // Salva em lotes de 500 (limite do Firestore batch)
    const BATCH_SIZE = 500;
    for (let i = 0; i < allResults.length; i += BATCH_SIZE) {
      const batch = adminDb.batch();
      for (const order of allResults.slice(i, i + BATCH_SIZE)) {
        const o = order as Record<string, unknown>;
        const orderId = String(o.id);
        // Normaliza date_created para ISO UTC para facilitar queries
        const dateRaw = String(o.date_created ?? "");
        batch.set(
          adminDb.collection("ml_orders").doc(orderId),
          {
            order_id: orderId,
            status: o.status ?? null,
            date_created: dateRaw,
            total_amount: Number(o.total_amount ?? 0),
            currency: o.currency_id ?? "BRL",
            buyer_id: (o.buyer as Record<string, unknown>)?.id
              ? String((o.buyer as Record<string, unknown>).id)
              : null,
            items: ((o.order_items as Record<string, unknown>[]) ?? []).map((item) => ({
              sku: (item.item as Record<string, unknown>)?.seller_sku ?? (item.item as Record<string, unknown>)?.id ?? null,
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

    return NextResponse.json({ ok: true, saved: allResults.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Falha ao sincronizar pedidos", details: msg }, { status: 500 });
  }
}