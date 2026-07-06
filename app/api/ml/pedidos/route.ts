import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";

type ProdutoData = { custo: number; imposto: number; name: string };
type OrderItem = { sku?: string; item_id?: string; quantity?: number; unit_price?: number; sale_fee?: number; title?: string };

function normalizeSku(s: string) {
  return s.trim().toLowerCase();
}
function normalizeItemId(s: string) {
  return s.trim().toUpperCase().replace(/^MLB/, "");
}

function buildRange(from?: string | null, to?: string | null) {
  if (from && to) {
    return {
      start: `${from}T00:00:00.000Z`, end: `${to}T23:59:59.999Z`,
      startBR: `${from}T00:00:00.000-03:00`, endBR: `${to}T23:59:59.999-03:00`,
    };
  }
  const br = new Date(Date.now() - 3 * 3600 * 1000);
  const y = br.getUTCFullYear();
  const m = br.getUTCMonth() + 1;
  const mm = String(m).padStart(2, "0");
  const ld = String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0");
  return {
    start: `${y}-${mm}-01T00:00:00.000Z`, end: `${y}-${mm}-${ld}T23:59:59.999Z`,
    startBR: `${y}-${mm}-01T00:00:00.000-03:00`, endBR: `${y}-${mm}-${ld}T23:59:59.999-03:00`,
  };
}

export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  try {
    const url = new URL(req.url);
    const { start, end, startBR, endBR } = buildRange(url.searchParams.get("from"), url.searchParams.get("to"));
    const db = getAdminDb();

    // Pedidos do período (dedupe UTC/BR)
    const [snapUTC, snapBR] = await Promise.all([
      db.collection("ml_orders").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_orders").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
    ]);
    const ordersMap = new Map<string, FirebaseFirestore.DocumentData>();
    for (const snap of [snapUTC, snapBR])
      for (const doc of snap.docs) {
        const d = doc.data();
        ordersMap.set(d.order_id ?? doc.id, d);
      }
    const orders = Array.from(ordersMap.values());

    // Índice de produtos
    const prodSnap = await db.collection("estoque").get();
    const porMlb = new Map<string, ProdutoData>();
    const porSku = new Map<string, ProdutoData>();
    for (const doc of prodSnap.docs) {
      const d = doc.data();
      const entry: ProdutoData = { custo: Number(d.custo ?? 0), imposto: Number(d.imposto ?? 0), name: String(d.name ?? "") };
      const mlbList: string[] = Array.isArray(d.mlbs) && d.mlbs.length ? d.mlbs : d.mlb ? [String(d.mlb)] : [];
      for (const m of mlbList) {
        const n = normalizeItemId(String(m));
        if (n) porMlb.set(n, entry);
      }
      const sku = String(d.sku ?? "").trim();
      if (sku) porSku.set(normalizeSku(sku), entry);
    }

    const pedidos = orders.map((o) => {
      const items = (o.items as OrderItem[]) ?? [];
      const totalUnits = items.reduce((s, it) => s + Number(it.quantity ?? 1), 0);
      const orderShipping = Number(o.shipping_cost ?? 0);
      const envioPerUnit = totalUnits > 0 ? orderShipping / totalUnits : 0;

      let retorno = 0, cmv = 0, envio = 0, taxaML = 0, imposto = 0;
      let vinculado = true;
      const nomes: string[] = [];

      for (const item of items) {
        const qty = Number(item.quantity ?? 1);
        const skuRaw = String(item.sku ?? "").trim();
        const itemId = String(item.item_id ?? "").trim();
        const ret = Number(item.unit_price ?? 0) * qty;
        retorno += ret;
        taxaML += Number(item.sale_fee ?? 0) * qty;
        envio += envioPerUnit * qty;

        const prod = porMlb.get(normalizeItemId(itemId)) ?? porSku.get(normalizeSku(skuRaw));
        if (prod) {
          cmv += prod.custo * qty;
          imposto += ret * (prod.imposto / 100);
          nomes.push(prod.name || String(item.title ?? skuRaw));
        } else {
          vinculado = false;
          nomes.push(String(item.title ?? skuRaw));
        }
      }

      const lucro = retorno - cmv - envio - taxaML - imposto;
      const margem = retorno > 0 ? (lucro / retorno) * 100 : 0;

      return {
        order_id: String(o.order_id ?? ""),
        data: String(o.date_created ?? "").slice(0, 10),
        hora: String(o.date_created ?? "").slice(11, 16),
        status: String(o.status ?? ""),
        produto: nomes.join(", "),
        qtd: totalUnits,
        valor: Number(o.total_amount ?? 0),
        retorno, cmv, envio, taxaML, imposto,
        lucro, margem, vinculado,
      };
    });

    pedidos.sort((a, b) => (b.data + b.hora).localeCompare(a.data + a.hora));

    return NextResponse.json({ pedidos, count: pedidos.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "pedidos_failed", details: msg }, { status: 500 });
  }
}
