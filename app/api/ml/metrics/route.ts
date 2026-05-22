import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";

function monthRangeBR(monthStr?: string) {
  let year: number, month: number;
  if (!monthStr) {
    const now = new Date();
    const brTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    year = brTime.getUTCFullYear();
    month = brTime.getUTCMonth() + 1;
  } else {
    const [y, m] = monthStr.split("-").map(Number);
    year = y; month = m;
  }
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const ld = String(lastDay).padStart(2, "0");
  return {
    start:   `${year}-${mm}-01T00:00:00.000Z`,
    end:     `${year}-${mm}-${ld}T23:59:59.999Z`,
    startBR: `${year}-${mm}-01T00:00:00.000-03:00`,
    endBR:   `${year}-${mm}-${ld}T23:59:59.999-03:00`,
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const month = url.searchParams.get("month") || undefined;
    const { start, end, startBR, endBR } = monthRangeBR(month);
    const db = getAdminDb();

    // 1. Buscar pedidos do mês
    const [snapUTC, snapBR] = await Promise.all([
      db.collection("ml_orders").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_orders").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
    ]);
    const ordersMap = new Map<string, FirebaseFirestore.DocumentData>();
    for (const snap of [snapUTC, snapBR]) {
      for (const doc of snap.docs) {
        const d = doc.data();
        ordersMap.set(d.order_id ?? doc.id, d);
      }
    }
    const orders = Array.from(ordersMap.values());

    // 2. Buscar produtos vinculados (para custo e ads por SKU)
    const produtosSnap = await db.collection("produtos").get();
    const produtosMap = new Map<string, { custo: number; ads: number }>();
    for (const doc of produtosSnap.docs) {
      const d = doc.data();
      // vincula por sku ou por ml_item_id
      const chaves = [d.sku, d.ml_item_id, doc.id].filter(Boolean) as string[];
      for (const chave of chaves) {
        produtosMap.set(chave, {
          custo: Number(d.custo ?? d.custo_produto ?? 0),
          ads: Number(d.ads ?? d.custo_ads ?? 0),
        });
      }
    }

    // 3. Calcular faturamento, custo produto, ads, envio por pedido
    let faturamento = 0;
    let totalCustoProduto = 0;
    let totalAds = 0;
    let totalEnvio = 0;

    for (const o of orders) {
      faturamento += Number(o.total_amount ?? 0);
      const envio = Number(o.shipping_cost ?? o.base_shipping_cost ?? 0);
      totalEnvio += envio;

      const items = (o.items as { sku?: string; quantity?: number; unit_price?: number }[]) ?? [];
      for (const item of items) {
        const qty = Number(item.quantity ?? 1);
        const sku = item.sku ?? "";
        const produto = produtosMap.get(sku);
        if (produto) {
          totalCustoProduto += produto.custo * qty;
          totalAds += produto.ads * qty;
        }
      }
    }

    // 4. Custos operacionais manuais (coleção "custos")
    const custosSnap = await db.collection("custos").get();
    let custosOperacionais = 0;
    for (const doc of custosSnap.docs) {
      custosOperacionais += Number(doc.data().valor ?? 0);
    }

    // 5. Devoluções
    const [retUTC, retBR] = await Promise.all([
      db.collection("ml_returns").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_returns").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
    ]);
    const retMap = new Map<string, FirebaseFirestore.DocumentData>();
    for (const snap of [retUTC, retBR]) for (const doc of snap.docs) retMap.set(doc.id, doc.data());
    const devolucoes = Array.from(retMap.values()).reduce((s, r) => s + Number(r.total_amount ?? 0), 0);

    // 6. Cálculo dos lucros
    // Lucro Bruto = faturamento - ads - custo_produto - envio_full
    const lucroBruto = faturamento - totalAds - totalCustoProduto - totalEnvio - devolucoes;

    // Lucro Líquido = lucroBruto - custos operacionais (fitas, impressora, extras)
    const lucroLiquido = lucroBruto - custosOperacionais;

    return NextResponse.json({
      faturamento,
      ordersCount: orders.length,
      devolucoes,
      totalCustoProduto,
      totalAds,
      totalEnvio,
      custosOperacionais,
      lucroBruto,
      lucroLiquido,
      start,
      end,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "metrics_failed", details: msg }, { status: 500 });
  }
}