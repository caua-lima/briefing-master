import "server-only";
import { getAdminDb } from "@/lib/firebase/admin";

const ML_API = "https://api.mercadolibre.com";
const SELLER_ID = process.env.ML_SELLER_ID || "2420261535";

export type SyncRange = { from: string; to: string };

/** Intervalo do mês atual (fuso BR, -03:00) em ISO. */
export function currentMonthRangeBR(): SyncRange {
  const brTime = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const year = brTime.getUTCFullYear();
  const month = brTime.getUTCMonth();
  const mm = String(month + 1).padStart(2, "0");
  const ld = String(new Date(Date.UTC(year, month + 1, 0)).getUTCDate()).padStart(2, "0");
  return {
    from: `${year}-${mm}-01T00:00:00.000-03:00`,
    to: `${year}-${mm}-${ld}T23:59:59.999-03:00`,
  };
}

/** Intervalo dos últimos N dias (fuso BR) em ISO, incluindo hoje. */
export function lastNDaysRangeBR(days: number): SyncRange {
  const brNow = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const to = brNow.toISOString().slice(0, 10);
  const brStart = new Date(brNow.getTime() - Math.max(0, days - 1) * 24 * 60 * 60 * 1000);
  const from = brStart.toISOString().slice(0, 10);
  return {
    from: `${from}T00:00:00.000-03:00`,
    to: `${to}T23:59:59.999-03:00`,
  };
}

type RawItem = Record<string, unknown>;

/** Normaliza os itens de um pedido do ML para o formato armazenado no Firestore. */
export function mapOrderItems(order: Record<string, unknown>) {
  const rawItems = (order.order_items as RawItem[]) ?? [];
  return rawItems.map((item) => {
    const itemObj = (item.item as Record<string, unknown>) ?? {};
    const itemId = String(itemObj.id ?? "").trim(); // MLB...
    const sellerSku = String(itemObj.seller_sku ?? "").trim();
    return {
      item_id: itemId, // vínculo por MLB
      sku: sellerSku || itemId, // vínculo por SKU do vendedor (fallback MLB)
      title: String(itemObj.title ?? ""),
      quantity: Number(item.quantity ?? 0),
      unit_price: Number(item.unit_price ?? 0),
      // Taxa de venda cobrada pelo ML nesta linha (por unidade — ver metrics)
      sale_fee: Number(item.sale_fee ?? 0),
    };
  });
}

async function fetchAllOrders(
  accessToken: string,
  range: SyncRange,
  extraQuery = "",
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const url =
      `${ML_API}/orders/search?seller=${SELLER_ID}` +
      `&order.date_created.from=${encodeURIComponent(range.from)}` +
      `&order.date_created.to=${encodeURIComponent(range.to)}` +
      `${extraQuery}&limit=${limit}&offset=${offset}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`ML orders fetch failed: ${await res.text()}`);

    const data = (await res.json()) as { results: Record<string, unknown>[]; paging: { total: number } };
    const results = data.results ?? [];
    all.push(...results);
    const total = data.paging?.total ?? 0;
    offset += results.length;
    if (offset >= total || results.length === 0) break;
  }
  return all;
}

/** Busca pedidos do período no ML e grava/atualiza em `ml_orders`. */
export async function syncOrdersRange(accessToken: string, range: SyncRange): Promise<number> {
  const db = getAdminDb();
  const all = await fetchAllOrders(accessToken, range);

  const BATCH_SIZE = 400;
  for (let i = 0; i < all.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const order of all.slice(i, i + BATCH_SIZE)) {
      const o = order as Record<string, unknown>;
      const orderId = String(o.id);
      batch.set(
        db.collection("ml_orders").doc(orderId),
        {
          order_id: orderId,
          status: o.status ?? null,
          date_created: String(o.date_created ?? ""),
          total_amount: Number(o.total_amount ?? 0),
          currency: o.currency_id ?? "BRL",
          buyer_id: (o.buyer as Record<string, unknown>)?.id
            ? String((o.buyer as Record<string, unknown>).id)
            : null,
          items: mapOrderItems(o),
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
    }
    await batch.commit();
  }
  return all.length;
}

/** Busca pedidos cancelados do período e grava/atualiza em `ml_returns`. */
export async function syncReturnsRange(accessToken: string, range: SyncRange): Promise<number> {
  const db = getAdminDb();
  const all = await fetchAllOrders(accessToken, range, "&order.status=cancelled");
  if (all.length === 0) return 0;

  const BATCH_SIZE = 400;
  for (let i = 0; i < all.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const order of all.slice(i, i + BATCH_SIZE)) {
      const o = order as Record<string, unknown>;
      const id = String(o.id);
      batch.set(
        db.collection("ml_returns").doc(id),
        {
          order_id: id,
          status: o.status ?? null,
          date_created: String(o.date_created ?? ""),
          total_amount: Number(o.total_amount ?? 0),
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
    }
    await batch.commit();
  }
  return all.length;
}
