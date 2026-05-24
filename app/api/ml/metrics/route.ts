import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";

type ProdutoData = {
  custo:     number;
  envioFull: number;
  mlb:       string;
  name:      string;
  sku:       string;
};

type OrderItem = {
  sku?:        string;
  item_id?:    string;
  quantity?:   number;
  unit_price?: number;
  title?:      string;
};

type AnuncioResult = {
  item_id:      string;
  title:        string;
  retorno:      number;
  custoProduto: number;
  envioFull:    number;
  ads:          number;
  lucro:        number;
  margem:       number;
  qty:          number;
};

function parseDateParam(p: string | null) {
  return p?.trim() || undefined;
}

function normalizeSku(s: string) {
  return s.trim().toLowerCase();
}

// Remove prefixo "MLB" e retorna apenas o número, em maiúsculas
function normalizeItemId(s: string): string {
  return s.trim().toUpperCase().replace(/^MLB/, "");
}

function buildRange(from?: string, to?: string, month?: string) {
  if (from && to) {
    return {
      start:   `${from}T00:00:00.000Z`,
      end:     `${to}T23:59:59.999Z`,
      startBR: `${from}T00:00:00.000-03:00`,
      endBR:   `${to}T23:59:59.999-03:00`,
      fromStr: from,
      toStr:   to,
    };
  }
  let year: number, mon: number;
  if (month) {
    [year, mon] = month.split("-").map(Number);
  } else {
    const br = new Date(Date.now() - 3 * 3600 * 1000);
    year = br.getUTCFullYear();
    mon  = br.getUTCMonth() + 1;
  }
  const mm = String(mon).padStart(2, "0");
  const ld = String(new Date(Date.UTC(year, mon, 0)).getUTCDate()).padStart(2, "0");
  return {
    start:   `${year}-${mm}-01T00:00:00.000Z`,
    end:     `${year}-${mm}-${ld}T23:59:59.999Z`,
    startBR: `${year}-${mm}-01T00:00:00.000-03:00`,
    endBR:   `${year}-${mm}-${ld}T23:59:59.999-03:00`,
    fromStr: `${year}-${mm}-01`,
    toStr:   `${year}-${mm}-${ld}`,
  };
}

export async function GET(req: Request) {
  try {
    const url   = new URL(req.url);
    const from  = parseDateParam(url.searchParams.get("from"));
    const to    = parseDateParam(url.searchParams.get("to"));
    const month = parseDateParam(url.searchParams.get("month"));
    const { start, end, startBR, endBR, fromStr, toStr } = buildRange(from, to, month);
    const db = getAdminDb();

    // ── 1. Pedidos ────────────────────────────────────────────
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

    // ── 2. Estoque: indexar por MLB (sem prefixo) e por SKU ───
    const prodSnap = await db.collection("estoque").get();
    const porMlb = new Map<string, ProdutoData>(); // chave: "6577305336"
    const porSku = new Map<string, ProdutoData>(); // chave: sku normalizado

    for (const doc of prodSnap.docs) {
      const d = doc.data();
      const entry: ProdutoData = {
        custo:     Number(d.custo ?? d.cost ?? 0),
        envioFull: Number(d.custo_envio_full ?? d.shipping_cost ?? 0),
        mlb:       String(d.mlb ?? "").trim(),
        name:      String(d.name ?? ""),
        sku:       String(d.sku ?? "").trim(),
      };
      // Indexar pelo MLB sem prefixo (ex: "6577305336")
      const mlbNum = normalizeItemId(entry.mlb);
      if (mlbNum) porMlb.set(mlbNum, entry);
      // Indexar pelo SKU como fallback
      if (entry.sku) porSku.set(normalizeSku(entry.sku), entry);
    }

    // ── 3. ADS por item_id ────────────────────────────────────
    let adsByItem: Record<string, number> = {};
    try {
      const base   = process.env.NEXT_PUBLIC_APP_URL ?? "https://briefing-master.vercel.app";
      const adsRes = await fetch(`${base}/api/ml/ads-spend?from=${fromStr}&to=${toStr}`, { cache: "no-store" });
      if (adsRes.ok) adsByItem = (await adsRes.json()).adsByItem ?? {};
    } catch { /* ADS falhou, segue sem */ }

    // ── 4. Loop de pedidos ────────────────────────────────────
    let faturamentoBruto  = 0;
    let totalRetorno      = 0;
    let totalCMV          = 0;
    let totalEnvio        = 0;
    let pedidosSemVinculo = 0;

    const anunciosMap = new Map<string, AnuncioResult>();

    for (const o of orders) {
      faturamentoBruto += Number(o.total_amount ?? 0);
      const items = (o.items as OrderItem[]) ?? [];
      let vinculado = false;

      for (const item of items) {
        const qty    = Number(item.quantity ?? 1);
        const skuRaw = String(item.sku     ?? "").trim();
        const itemId = String(item.item_id ?? "").trim(); // ex: "MLB6577305336"
        const title  = String(item.title   ?? skuRaw);
        const retorno = Number(item.unit_price ?? 0) * qty;

        // Vínculo 1: MLB sem prefixo (mais confiável, independe do SKU)
        const mlbNumPedido = normalizeItemId(itemId);
        const produto = porMlb.get(mlbNumPedido)
                     // Vínculo 2: SKU do pedido bate com SKU do estoque
                     ?? porSku.get(normalizeSku(skuRaw));

        if (produto) {
          vinculado = true;
          const cmv   = produto.custo * qty;
          const envio = produto.envioFull * qty;
          totalRetorno += retorno;
          totalCMV     += cmv;
          totalEnvio   += envio;

          // Chave de agrupamento: MLB sem prefixo (estável)
          const chave = mlbNumPedido || skuRaw;
          const prev  = anunciosMap.get(chave);
          if (prev) {
            prev.retorno      += retorno;
            prev.custoProduto += cmv;
            prev.envioFull    += envio;
            prev.qty          += qty;
          } else {
            anunciosMap.set(chave, {
              item_id:      itemId || skuRaw,
              title:        produto.name || title,
              retorno,
              custoProduto: cmv,
              envioFull:    envio,
              ads:          0,
              lucro:        0,
              margem:       0,
              qty,
            });
          }
        }
      }
      if (!vinculado && items.length > 0) pedidosSemVinculo++;
    }

    // ── 5. ADS e lucro por anúncio ────────────────────────────
    let totalAds = 0;
    for (const [chave, a] of anunciosMap) {
      // ADS pode vir como "6577305336" ou "MLB6577305336"
      a.ads    = adsByItem[chave]
              ?? adsByItem[`MLB${chave}`]
              ?? adsByItem[a.item_id]
              ?? 0;
      totalAds += a.ads;
      a.lucro  = a.retorno - a.custoProduto - a.envioFull - a.ads;
      a.margem = a.retorno > 0 ? (a.lucro / a.retorno) * 100 : 0;
    }

    const anuncios = Array.from(anunciosMap.values())
      .sort((a, b) => b.retorno - a.retorno);

    // ── 6. Devoluções ─────────────────────────────────────────
    const [retUTC, retBR] = await Promise.all([
      db.collection("ml_returns").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_returns").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
    ]);
    const retMap = new Map<string, FirebaseFirestore.DocumentData>();
    for (const snap of [retUTC, retBR])
      for (const doc of snap.docs) retMap.set(doc.id, doc.data());
    const devolucoes = Array.from(retMap.values())
      .reduce((s, r) => s + Number(r.total_amount ?? 0), 0);

    // ── 7. Custos operacionais ────────────────────────────────
    const custosSnap = await db.collection("custos").get();
    let custosOp = 0;
    for (const doc of custosSnap.docs) {
      const d    = doc.data();
      const data = String(d.data ?? d.date ?? "");
      const freq = String(d.freq ?? d.frequency ?? "avulso");
      if (freq === "mensal" || freq === "monthly") {
        if (data.slice(0, 7) >= fromStr.slice(0, 7) && data.slice(0, 7) <= toStr.slice(0, 7))
          custosOp += Number(d.valor ?? d.amount ?? 0);
      } else {
        if (data >= fromStr && data <= toStr)
          custosOp += Number(d.valor ?? d.amount ?? 0);
      }
    }

    // ── 8. Faturamento de hoje ────────────────────────────────
    const brNow = new Date(Date.now() - 3 * 3600 * 1000);
    const hj = `${brNow.getUTCFullYear()}-${String(brNow.getUTCMonth() + 1).padStart(2, "0")}-${String(brNow.getUTCDate()).padStart(2, "0")}`;
    const [snapHjUTC, snapHjBR] = await Promise.all([
      db.collection("ml_orders").where("date_created", ">=", `${hj}T00:00:00.000Z`).where("date_created", "<=", `${hj}T23:59:59.999Z`).get(),
      db.collection("ml_orders").where("date_created", ">=", `${hj}T00:00:00.000-03:00`).where("date_created", "<=", `${hj}T23:59:59.999-03:00`).get(),
    ]);
    const hjMap = new Map<string, FirebaseFirestore.DocumentData>();
    for (const snap of [snapHjUTC, snapHjBR])
      for (const doc of snap.docs) {
        const d = doc.data();
        hjMap.set(d.order_id ?? doc.id, d);
      }
    const faturamentoHoje = Array.from(hjMap.values()).reduce((s, o) => s + Number(o.total_amount ?? 0), 0);
    const pedidosHoje     = hjMap.size;

    // ── 9. Totais finais ──────────────────────────────────────
    const lucroSemCustos  = totalRetorno - totalCMV - totalEnvio - totalAds - devolucoes;
    const lucroComCustos  = lucroSemCustos - custosOp;
    const margemSemCustos = totalRetorno > 0 ? (lucroSemCustos / totalRetorno) * 100 : 0;
    const margemComCustos = totalRetorno > 0 ? (lucroComCustos / totalRetorno) * 100 : 0;

    return NextResponse.json({
      faturamentoBruto,
      totalRetorno,
      faturamentoHoje,
      pedidosHoje,
      ordersCount: orders.length,
      devolucoes,
      totalCMV,
      totalAds,
      totalEnvio,
      custosOperacionais: custosOp,
      lucroSemCustos,
      lucroComCustos,
      margemSemCustos,
      margemComCustos,
      anuncios,
      pedidosSemVinculo,
      from: fromStr,
      to:   toStr,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "metrics_failed", details: msg }, { status: 500 });
  }
}
