import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { getAdsFullByItem, getAdsSettingsByItem, getItemStatusByItem, probeAds, type AdSettings } from "@/lib/ml/ads";
import { recordSyncAttempt, recordSyncFailure, recordSyncSuccess } from "@/lib/sync-runs";
import { sanitizeErrorForStorage } from "@/lib/domain/freshness";
import { buildAdItem, normId, normSku, reconciliarConta, sortAdItems, vendasPorItem, type ProdutoData } from "@/lib/domain/ads";
import { getValidMlAccessToken } from "@/lib/ml/getToken";
import { fetchOrdersLive, loadOrders, readShippingCosts } from "@/lib/ml/orders";

export const maxDuration = 30;

function todayISO(offsetDays = 0): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000 - offsetDays * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  // Fase 4: registra que uma coleta de Ads foi tentada, mesmo sem lock (não
  // há risco de escrita concorrente aqui — é leitura, sem upsert em disputa).
  // Serve só pra Saúde da operação saber "quando foi a última vez que a aba
  // Ads foi aberta com sucesso" — hoje isso não era rastreado em lugar nenhum.
  await recordSyncAttempt("ads");
  try {
    const url = new URL(req.url);
    const from = url.searchParams.get("from") || todayISO(29);
    const to = url.searchParams.get("to") || todayISO(0);

    // A API de ADS do ML rejeita datas futuras (404) → limita o fim ao dia de
    // hoje no fuso BR. Mesma trava que o dashboard já usa.
    const hj = todayISO(0);
    const adsTo = to > hj ? hj : to;

    let ads;
    try {
      ads = from <= adsTo ? await getAdsFullByItem(from, adsTo) : [];
    } catch {
      // Pode ser o período terminando no dia corrente (dados de hoje ainda não
      // fecharam do lado do ML). Tenta de novo terminando ontem.
      const ontem = todayISO(1);
      try {
        ads = from <= ontem ? await getAdsFullByItem(from, ontem) : [];
      } catch (e2) {
        const diag = await probeAds(from, adsTo);
        await recordSyncFailure("ads", sanitizeErrorForStorage(String(e2)));
        return NextResponse.json({ error: "ads_failed", details: String(e2).slice(0, 200), diag, from, to: adsTo, items: [] });
      }
    }

    // Só o que teve investimento no período — anúncio parado é poluição
    // visual aqui, e cortar cedo também poupa chamada de config (campanha)
    // pra quem nem entraria na tela.
    const totalAntesDoFiltro = ads.length;
    ads = ads.filter((a) => a.cost > 0);
    const semGastoNoPeriodo = totalAntesDoFiltro - ads.length;

    const db = getAdminDb();

    // ── Produtos (custo médio + imposto) indexados por MLB e SKU ──
    const prodSnap = await db.collection("estoque").get();
    const porMlb = new Map<string, ProdutoData>();
    const porSku = new Map<string, ProdutoData>();
    for (const doc of prodSnap.docs) {
      const d = doc.data();
      const entry: ProdutoData = { custo: Number(d.custoMedio ?? d.custo ?? 0), imposto: Number(d.imposto ?? 0) };
      const mlbs: string[] = Array.isArray(d.mlbs) && d.mlbs.length ? d.mlbs : d.mlb ? [String(d.mlb)] : [];
      for (const m of mlbs) { const n = normId(String(m)); if (n) porMlb.set(n, entry); }
      const sku = String(d.sku ?? "").trim();
      if (sku) porSku.set(normSku(sku), entry);
    }

    // ── Pedidos AO VIVO (mesma fonte do dashboard) com fallback ao Firestore ──
    const fromISO = `${from}T00:00:00.000-03:00`;
    const toISO = `${to}T23:59:59.999-03:00`;
    const start = `${from}T00:00:00.000Z`, end = `${to}T23:59:59.999Z`;
    const token = await getValidMlAccessToken().catch(() => "");
    let orders = token ? await fetchOrdersLive(token, fromISO, toISO) : null;
    if (!orders) orders = await loadOrders(db, start, end, fromISO, toISO);

    // enriquece frete do cache do Firestore
    const ids = orders.map((o) => String(o.order_id ?? "")).filter(Boolean);
    const shipMap = await readShippingCosts(db, ids);
    for (const o of orders) if (o.shipping_cost == null) o.shipping_cost = shipMap.get(String(o.order_id)) ?? 0;

    // ── Devoluções + cancelamentos (excluídos do lucro, igual ao dashboard) ──
    const [retUTC, retBR] = await Promise.all([
      db.collection("ml_returns").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_returns").where("date_created", ">=", fromISO).where("date_created", "<=", toISO).get(),
    ]);
    const cancelIds = new Set<string>();
    const devolIds = new Set<string>();
    for (const snap of [retUTC, retBR]) for (const doc of snap.docs) {
      const r = doc.data();
      if (String(r.tipo ?? "") === "devolucao") devolIds.add(doc.id);
      else cancelIds.add(doc.id);
    }

    const vendas = vendasPorItem(orders, porMlb, porSku, cancelIds, devolIds);

    // Configuração de cada anúncio (orçamento, meta de ROAS, última alteração).
    // Best-effort: se falhar, os anúncios ainda saem, só sem esses campos.
    // O campaign_id que já veio junto das métricas poupa uma chamada por item.
    const mlbsAds = ads.map((a) => a.itemId).filter((s) => /^MLB\d+$/i.test(s));
    const campaignIdByItem: Record<string, string> = {};
    const costByItem: Record<string, number> = {};
    for (const a of ads) {
      const id = a.itemId.toUpperCase();
      if (a.campaignId) campaignIdByItem[id] = a.campaignId;
      costByItem[id] = a.cost;
    }
    const cfg = await getAdsSettingsByItem(mlbsAds, campaignIdByItem, costByItem).catch(
      () => ({
        porItem: {} as Record<string, AdSettings>, amostraCampanha: null,
        tentativas: [] as { url: string; status: number }[], campanhasEncontradas: 0,
        campanhasTotal: 0,
        campanhasResumo: [] as { id: string; name: string; status: string; gasto: number; totalAds: number }[],
        anunciosTotal: 0, anunciosNoPeriodo: 0, anunciosContagemFalhou: false,
        campanhasOrfas: [] as string[], gastoOrfao: 0, gastoSemVinculo: 0,
        amostraCampanhaOrfa: null,
      }),
    );
    // Status do catálogo (se o anúncio em si está ativo/pausado/encerrado) —
    // vira só um dado extra no tooltip agora; a etiqueta principal é da campanha.
    const statusPorItem = await getItemStatusByItem(mlbsAds).catch(() => ({} as Record<string, string>));

    const items = sortAdItems(ads.map((a) => {
      const v = vendas.get(a.itemId) ?? { receita: 0, unidades: 0, cmv: 0, imposto: 0, taxaML: 0, envio: 0 };
      const c = cfg.porItem[a.itemId.toUpperCase()];
      const mlStatus = statusPorItem[a.itemId.toUpperCase()] ?? ""; // status do catálogo — só informativo
      return buildAdItem(
        { itemId: a.itemId, title: a.title, clicks: a.clicks, prints: a.prints, cost: a.cost, directSales: a.directSales, directUnits: a.directUnits, sales: a.sales, units: a.units },
        v, c, mlStatus,
      );
    }));

    /**
     * Reconciliação com o dashboard (lib/domain/ads.ts::reconciliarConta). A
     * tabela cobre SÓ os itens anunciados, mas o rótulo "Geral (todas as
     * vendas)" dava a entender que o total era o faturamento inteiro do
     * período — e não é: R$ 9.465 dos itens anunciados contra R$ 12.040 de
     * faturamento líquido do dashboard. Os dois estão certos e medem coisas
     * diferentes; devolvendo o total da conta, a tela consegue dizer quanto
     * do faturamento esses anúncios representam em vez de deixar o vendedor
     * achar que um dos números está quebrado. Ver docs/ADS_RECONCILIATION.md.
     */
    const contaReconciliada = reconciliarConta(vendas);

    // amostraCampanha: primeira campanha crua devolvida pelo ML — se
    // orçamento/ROAS vierem 0, mostra o objeto para achar o campo certo sem
    // chutar. cfgDiag: status HTTP das URLs de campanhas tentadas — se
    // nenhuma respondeu 200, o problema é o endpoint, não o nome do campo.
    await recordSyncSuccess("ads", items.length, { expected: totalAntesDoFiltro, processed: items.length });
    return NextResponse.json({
      items, from, to,
      atualizadoEm: new Date().toISOString(),
      semGastoNoPeriodo, // quantos anúncios ficaram de fora por não ter investido
      cfgAmostra: { campanha: cfg.amostraCampanha, campanhaOrfa: cfg.amostraCampanhaOrfa },
      cfgDiag: cfg.tentativas,
      campanhasEncontradas: cfg.campanhasEncontradas,
      campanhasTotal: cfg.campanhasTotal,
      campanhasResumo: cfg.campanhasResumo,
      anunciosTotal: cfg.anunciosTotal,
      anunciosNoPeriodo: cfg.anunciosNoPeriodo,
      anunciosContagemFalhou: cfg.anunciosContagemFalhou,
      campanhasOrfas: cfg.campanhasOrfas,
      gastoOrfao: cfg.gastoOrfao,
      gastoSemVinculo: cfg.gastoSemVinculo,
      conta: contaReconciliada,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordSyncFailure("ads", sanitizeErrorForStorage(msg));
    return NextResponse.json({ error: "unexpected", details: msg, items: [] }, { status: 500 });
  }
}
