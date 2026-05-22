import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";

type ProdutoData = {
  custo: number;
  envioFull: number;
  mlb: string;
  name: string;
  preco: number;
};

type OrderItem = {
  sku?: string;
  item_id?: string;
  quantity?: number;
  unit_price?: number;
  title?: string;
};

type AnuncioResult = {
  item_id: string;
  title: string;
  faturamento: number;
  custoProduto: number;
  envioFull: number;
  ads: number;
  lucroBruto: number;  // faturamento - custo - envio - ads
  qty: number;
};

function parseDateParam(param: string | null): string | undefined {
  return param && param.trim() ? param.trim() : undefined;
}

function buildRange(from?: string, to?: string, month?: string) {
  // Modo 1: from + to livres (YYYY-MM-DD)
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
  // Modo 2: mês (YYYY-MM)
  let year: number, mon: number;
  if (month) {
    const [y, m] = month.split("-").map(Number);
    year = y; mon = m;
  } else {
    const now    = new Date();
    const brTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    year = brTime.getUTCFullYear();
    mon  = brTime.getUTCMonth() + 1;
  }
  const mm      = String(mon).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const ld      = String(lastDay).padStart(2, "0");
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

    // ── 1. Pedidos do período ──────────────────────────────────
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

    // ── 2. Produtos cadastrados (por SKU e por MLB) ────────────
    const produtosSnap = await db.collectionGroup("produtos").get();
    const porSku = new Map<string, ProdutoData>();
    const porMlb = new Map<string, ProdutoData>();

    for (const doc of produtosSnap.docs) {
      const d = doc.data();
      const entry: ProdutoData = {
        custo:     Number(d.custo ?? 0),
        envioFull: Number(d.custo_envio_full ?? 0),
        mlb:       String(d.mlb ?? "").trim(),
        name:      String(d.name ?? ""),
        preco:     Number(d.preco ?? 0),
      };
      const sku = String(d.sku ?? "").trim();
      const mlb = String(d.mlb ?? "").trim();
      if (sku) porSku.set(sku, entry);
      if (mlb) porMlb.set(mlb, entry);
    }

    // ── 3. ADS por anúncio (buscado direto da API ML) ─────────
    //    Chamamos nossa própria rota /api/ml/ads-spend para encapsular o token
    const adsRes = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL ?? "https://briefing-master.vercel.app"}/api/ml/ads-spend?from=${fromStr}&to=${toStr}`,
      { cache: "no-store" }
    );
    const adsJson    = adsRes.ok ? await adsRes.json() : {};
    const adsByItem: Record<string, number> = adsJson.adsByItem ?? {};

    // ── 4. Loop de pedidos ────────────────────────────────────
    let faturamento       = 0;
    let totalCustoProduto = 0;
    let totalEnvio        = 0;
    let pedidosSemVinculo = 0;

    // Agregador por anúncio
    const anunciosMap = new Map<string, AnuncioResult>();

    for (const o of orders) {
      faturamento += Number(o.total_amount ?? 0);
      const items = (o.items as OrderItem[]) ?? [];
      let vinculado = false;

      for (const item of items) {
        const qty    = Number(item.quantity ?? 1);
        const sku    = String(item.sku ?? "").trim();
        const itemId = String(item.item_id ?? "").trim();
        const title  = String(item.title ?? sku ?? itemId);

        // Busca produto por SKU primeiro, depois por MLB/item_id
        const produto = porSku.get(sku) ?? porMlb.get(itemId);
        // ADS deste anúncio: vem da API ML, distribuído por unidade
        const adsTotal  = adsByItem[itemId] ?? 0;
        const adsPorQty = adsTotal; // spend já é total do período, não por unidade

        if (produto) {
          vinculado = true;
          const custoProd = produto.custo * qty;
          const envio     = produto.envioFull * qty;
          totalCustoProduto += custoProd;
          totalEnvio        += envio;

          const chave = itemId || sku;
          const prev  = anunciosMap.get(chave);
          if (prev) {
            prev.faturamento  += Number(o.total_amount ?? item.unit_price ?? 0);
            prev.custoProduto += custoProd;
            prev.envioFull    += envio;
            prev.qty          += qty;
          } else {
            anunciosMap.set(chave, {
              item_id:      chave,
              title,
              faturamento:  Number(o.total_amount ?? item.unit_price ?? 0),
              custoProduto: custoProd,
              envioFull:    envio,
              ads:          adsPorQty,
              lucroBruto:   0,
              qty,
            });
          }
        }
      }
      if (!vinculado && items.length > 0) pedidosSemVinculo++;
    }

    // Preenche ads e calcula lucroBruto por anúncio
    let totalAds = 0;
    for (const [itemId, anuncio] of anunciosMap) {
      anuncio.ads       = adsByItem[itemId] ?? 0;
      totalAds         += anuncio.ads;
      anuncio.lucroBruto = anuncio.faturamento - anuncio.custoProduto - anuncio.envioFull - anuncio.ads;
    }

    const anuncios = Array.from(anunciosMap.values())
      .sort((a, b) => b.faturamento - a.faturamento);

    // ── 5. Devoluções ─────────────────────────────────────────
    const [retUTC, retBR] = await Promise.all([
      db.collection("ml_returns").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_returns").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
    ]);
    const retMap = new Map<string, FirebaseFirestore.DocumentData>();
    for (const snap of [retUTC, retBR]) {
      for (const doc of snap.docs) retMap.set(doc.id, doc.data());
    }
    const devolucoes = Array.from(retMap.values())
      .reduce((s, r) => s + Number(r.total_amount ?? 0), 0);

    // ── 6. Custos operacionais manuais (filtrados pelo período) ─
    const custosSnap = await db.collectionGroup("custos").get();
    let custosOperacionais = 0;
    for (const doc of custosSnap.docs) {
      const d    = doc.data();
      const data = String(d.data ?? "");
      const freq = String(d.freq ?? "avulso");
      // mensal: conta se está no mesmo mês do from
      // diario/avulso: conta se a data está dentro do range
      if (freq === "mensal") {
        if (data >= fromStr.slice(0, 7) && data <= toStr.slice(0, 7)) {
          custosOperacionais += Number(d.valor ?? 0);
        }
      } else {
        if (data >= fromStr && data <= toStr) {
          custosOperacionais += Number(d.valor ?? 0);
        }
      }
    }

    // ── 7. Cálculo final ──────────────────────────────────────
    // Lucro sem custos op. = Faturamento - Custo Produto - Envio Full - Ads - Devoluções
    const lucroSemCustos = faturamento - totalCustoProduto - totalEnvio - totalAds - devolucoes;
    // Lucro com custos op.
    const lucroComCustos = lucroSemCustos - custosOperacionais;

    const margemSemCustos = faturamento > 0 ? (lucroSemCustos / faturamento) * 100 : 0;
    const margemComCustos = faturamento > 0 ? (lucroComCustos / faturamento) * 100 : 0;

    return NextResponse.json({
      faturamento,
      ordersCount: orders.length,
      devolucoes,
      totalCustoProduto,
      totalAds,
      totalEnvio,
      custosOperacionais,
      lucroSemCustos,  // Lucro Líquido SEM custos operacionais
      lucroComCustos,  // Lucro Líquido COM custos operacionais
      margemSemCustos,
      margemComCustos,
      anuncios,        // breakdown por anúncio com ads automático
      pedidosSemVinculo,
      from: fromStr,
      to: toStr,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "metrics_failed", details: msg }, { status: 500 });
  }
}