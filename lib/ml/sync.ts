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

/** Executa `fn` sobre `items` com no máximo `limit` chamadas simultâneas. */
async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

/**
 * Busca o custo de frete que o VENDEDOR paga por um envio (senders[].cost).
 * Retorna null em caso de falha (para permitir nova tentativa no próximo sync).
 */
async function fetchShipmentCost(accessToken: string, shipmentId: string): Promise<number | null> {
  try {
    const res = await fetch(`${ML_API}/shipments/${shipmentId}/costs`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { senders?: { cost?: number }[] };
    const senders = Array.isArray(j?.senders) ? j.senders : [];
    // Custo do vendedor = soma dos custos dos remetentes (já com descontos aplicados)
    return senders.reduce((s, x) => s + Number(x?.cost ?? 0), 0);
  } catch {
    return null;
  }
}

/** Lê `shipping_cost` já salvo dos pedidos informados (evita refetch de envios). */
async function existingShippingCosts(
  db: FirebaseFirestore.Firestore,
  orderIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const CHUNK = 300;
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const refs = orderIds.slice(i, i + CHUNK).map((id) => db.collection("ml_orders").doc(id));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      const v = snap.get("shipping_cost");
      if (typeof v === "number") map.set(snap.id, v);
    }
  }
  return map;
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

/** Busca pedidos do período no ML (com custo de frete real) e grava em `ml_orders`. */
export async function syncOrdersRange(accessToken: string, range: SyncRange): Promise<number> {
  const db = getAdminDb();
  const all = await fetchAllOrders(accessToken, range);

  // ── Custo de frete (Full) por pedido, via API de envios ──
  const orderIds = all.map((o) => String((o as Record<string, unknown>).id));
  const shippingByOrder = await existingShippingCosts(db, orderIds);

  const toFetch: { orderId: string; shipmentId: string }[] = [];
  for (const o of all) {
    const orderId = String((o as Record<string, unknown>).id);
    const shipmentId = String((o.shipping as Record<string, unknown>)?.id ?? "").trim();
    if (shipmentId && !shippingByOrder.has(orderId)) {
      toFetch.push({ orderId, shipmentId });
    }
  }

  await mapPool(toFetch, 8, async ({ orderId, shipmentId }) => {
    const cost = await fetchShipmentCost(accessToken, shipmentId);
    if (cost != null) shippingByOrder.set(orderId, cost);
  });

  // ── Gravação em lote ──
  const BATCH_SIZE = 400;
  for (let i = 0; i < all.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const order of all.slice(i, i + BATCH_SIZE)) {
      const o = order as Record<string, unknown>;
      const orderId = String(o.id);
      const doc: Record<string, unknown> = {
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
      };
      // Só grava shipping_cost quando temos valor (falha na API não zera o existente)
      const ship = shippingByOrder.get(orderId);
      if (typeof ship === "number") doc.shipping_cost = ship;

      batch.set(db.collection("ml_orders").doc(orderId), doc, { merge: true });
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
