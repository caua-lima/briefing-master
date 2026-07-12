import "server-only";

export const ML_API = "https://api.mercadolibre.com";
export const SELLER_ID = process.env.ML_SELLER_ID || "2420261535";

export type OrderItemDoc = {
  sku?: string;
  item_id?: string;
  quantity?: number;
  unit_price?: number;
  sale_fee?: number;
  title?: string;
};

export type OrderDoc = {
  order_id: string;
  status: string;
  date_created: string;
  total_amount: number;
  shipping_id?: string;
  shipping_cost?: number | null;
  items: OrderItemDoc[];
};

/** Lê os pedidos de um intervalo (UTC e BR) do Firestore, deduplicando por order_id. */
export async function loadOrders(
  db: FirebaseFirestore.Firestore,
  start: string,
  end: string,
  startBR: string,
  endBR: string,
): Promise<FirebaseFirestore.DocumentData[]> {
  const [snapUTC, snapBR] = await Promise.all([
    db.collection("ml_orders").where("date_created", ">=", start).where("date_created", "<=", end).get(),
    db.collection("ml_orders").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
  ]);
  const map = new Map<string, FirebaseFirestore.DocumentData>();
  for (const snap of [snapUTC, snapBR])
    for (const doc of snap.docs) {
      const d = doc.data();
      map.set(d.order_id ?? doc.id, d);
    }
  return Array.from(map.values());
}

/**
 * Busca pedidos AO VIVO no ML para o intervalo (evita depender da sincronização
 * para o faturamento/pedidos aparecerem). Retorna null em falha (usa fallback).
 * O frete (shipping_cost) é enriquecido do cache do Firestore depois.
 */
export async function fetchOrdersLive(
  token: string,
  fromISO: string,
  toISO: string,
): Promise<FirebaseFirestore.DocumentData[] | null> {
  try {
    const all: FirebaseFirestore.DocumentData[] = [];
    let offset = 0;
    while (true) {
      const url =
        `${ML_API}/orders/search?seller=${SELLER_ID}` +
        `&order.date_created.from=${encodeURIComponent(fromISO)}` +
        `&order.date_created.to=${encodeURIComponent(toISO)}` +
        `&limit=50&offset=${offset}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" });
      if (!res.ok) return null;
      const data = (await res.json()) as { results?: Record<string, unknown>[]; paging?: { total?: number } };
      const results = data.results ?? [];
      for (const o of results) {
        const rawItems = (o.order_items as Record<string, unknown>[]) ?? [];
        all.push({
          order_id: String(o.id),
          status: String(o.status ?? ""),
          date_created: String(o.date_created ?? ""),
          total_amount: Number(o.total_amount ?? 0),
          shipping_id: String((o.shipping as Record<string, unknown>)?.id ?? ""),
          items: rawItems.map((it) => {
            const itemObj = (it.item as Record<string, unknown>) ?? {};
            const itemId = String(itemObj.id ?? "").trim();
            const sellerSku = String(itemObj.seller_sku ?? "").trim();
            return {
              item_id: itemId,
              sku: sellerSku || itemId,
              title: String(itemObj.title ?? ""),
              quantity: Number(it.quantity ?? 0),
              unit_price: Number(it.unit_price ?? 0),
              sale_fee: Number(it.sale_fee ?? 0),
            };
          }),
        });
      }
      const total = data.paging?.total ?? 0;
      offset += results.length;
      if (offset >= total || results.length === 0) break;
    }
    return all;
  } catch {
    return null;
  }
}

/** Lê shipping_cost já sincronizado do Firestore para os pedidos informados. */
export async function readShippingCosts(
  db: FirebaseFirestore.Firestore,
  ids: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const CHUNK = 300;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const refs = ids.slice(i, i + CHUNK).filter(Boolean).map((id) => db.collection("ml_orders").doc(id));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      const v = snap.get("shipping_cost");
      if (typeof v === "number") map.set(snap.id, v);
    }
  }
  return map;
}
