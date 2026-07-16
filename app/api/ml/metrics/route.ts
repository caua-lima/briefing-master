import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { getAdsSpendByItem, probeAds } from "@/lib/ml/ads";
import { fetchOrdersLive, loadOrders, readShippingCosts } from "@/lib/ml/orders";
import { getMlAccessToken } from "../token";

export const maxDuration = 30;

// Cache curto por lambda quente (evita bater no ML a cada abertura / 15 min)
const metricsCache = new Map<string, { at: number; body: Record<string, unknown> }>();
const CACHE_TTL = 60 * 1000;

type ProdutoData = {
  custo: number;
  imposto: number; // % sobre a venda
  mlb: string;
  name: string;
  sku: string;
};

type OrderItem = {
  sku?: string;
  item_id?: string;
  quantity?: number;
  unit_price?: number;
  sale_fee?: number;
  title?: string;
};

type AnuncioResult = {
  item_id: string;
  title: string;
  retorno: number;
  custoProduto: number;
  envioFull: number;
  imposto: number;
  taxaML: number;
  ads: number;
  lucroBruto: number;
  lucro: number;
  margem: number;
  qty: number;
  semVenda?: boolean;
};

type Aggregates = {
  faturamentoBruto: number;      // TUDO (inclui cancelados e devolvidos)
  vendasCanceladas: number;      // valor dos pedidos cancelados (não venda)
  vendasDevolvidas: number;      // valor dos pedidos devolvidos (venda revertida, 0 a 0)
  totalRetorno: number;
  totalCMV: number;
  totalEnvio: number;
  totalImposto: number;
  totalTaxasML: number;
  totalAds: number;
  adsNaoVinculado: number;
  anuncios: AnuncioResult[];
  pedidosSemVinculo: number;
  ordersCount: number;
};

function parseDateParam(p: string | null) {
  return p?.trim() || undefined;
}

function normalizeSku(s: string) {
  return s.trim().toLowerCase();
}

// Pedido que NÃO é venda de verdade (cancelado antes de enviar / inválido).
// Sai do faturamento e do lucro — não é prejuízo, é "não venda".
function isNaoVenda(status: unknown): boolean {
  const s = String(status ?? "").toLowerCase();
  return s === "cancelled" || s === "invalid";
}

// Remove prefixo "MLB" e retorna apenas o número, em maiúsculas
function normalizeItemId(s: string): string {
  return s.trim().toUpperCase().replace(/^MLB/, "");
}

// Dia civil no fuso BR (-03:00), deslocado por offsetDays (ex.: -1 = ontem).
function brDayISO(offsetDays = 0): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000 + offsetDays * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function buildRange(from?: string, to?: string, month?: string) {
  if (from && to) {
    return {
      start: `${from}T00:00:00.000Z`,
      end: `${to}T23:59:59.999Z`,
      startBR: `${from}T00:00:00.000-03:00`,
      endBR: `${to}T23:59:59.999-03:00`,
      fromStr: from,
      toStr: to,
    };
  }
  let year: number, mon: number;
  if (month) {
    [year, mon] = month.split("-").map(Number);
  } else {
    const br = new Date(Date.now() - 3 * 3600 * 1000);
    year = br.getUTCFullYear();
    mon = br.getUTCMonth() + 1;
  }
  const mm = String(mon).padStart(2, "0");
  const ld = String(new Date(Date.UTC(year, mon, 0)).getUTCDate()).padStart(2, "0");
  return {
    start: `${year}-${mm}-01T00:00:00.000Z`,
    end: `${year}-${mm}-${ld}T23:59:59.999Z`,
    startBR: `${year}-${mm}-01T00:00:00.000-03:00`,
    endBR: `${year}-${mm}-${ld}T23:59:59.999-03:00`,
    fromStr: `${year}-${mm}-01`,
    toStr: `${year}-${mm}-${ld}`,
  };
}

/**
 * Agrega pedidos: faturamento, CMV, Full (frete do pedido distribuído por
 * unidade), taxas ML, imposto e ADS por anúncio. Só itens vinculados a um
 * produto entram no cálculo de lucro.
 */
function computeAggregates(
  orders: FirebaseFirestore.DocumentData[],
  porMlb: Map<string, ProdutoData>,
  porSku: Map<string, ProdutoData>,
  adsByItem: Record<string, number>,
  cancelIds: Set<string> = new Set(),
  devolIds: Set<string> = new Set(),
): Aggregates {
  let faturamentoBruto = 0;
  let vendasCanceladas = 0;
  let vendasDevolvidas = 0;
  let totalRetorno = 0;
  let totalCMV = 0;
  let totalEnvio = 0;
  let totalImposto = 0;
  let totalTaxasML = 0;
  let pedidosSemVinculo = 0;

  const anunciosMap = new Map<string, AnuncioResult>();
  let ordersCount = 0;

  for (const o of orders) {
    const oid = String(o.order_id ?? "");
    const totalAmt = Number(o.total_amount ?? 0);
    // Faturamento BRUTO inclui tudo (inclusive cancelado/devolvido).
    faturamentoBruto += totalAmt;

    // Cancelado = "não venda" (estoque nem saiu). Fica só no bruto; sai do
    // faturamento líquido e do lucro. Status vem do próprio pedido (robusto).
    if (isNaoVenda(o.status) || cancelIds.has(oid)) { vendasCanceladas += totalAmt; continue; }
    // Devolvido = venda revertida, produto volta ao estoque → 0 a 0. Idem: só no bruto.
    if (devolIds.has(oid)) { vendasDevolvidas += totalAmt; continue; }

    ordersCount++;
    const items = (o.items as OrderItem[]) ?? [];

    // Frete Full do pedido distribuído por unidade (envio é por pedido)
    const totalUnits = items.reduce((s, it) => s + Number(it.quantity ?? 1), 0);
    const orderShipping = Number(o.shipping_cost ?? 0);
    const envioPerUnit = totalUnits > 0 ? orderShipping / totalUnits : 0;

    let vinculado = false;

    for (const item of items) {
      const qty = Number(item.quantity ?? 1);
      const skuRaw = String(item.sku ?? "").trim();
      const itemId = String(item.item_id ?? "").trim();
      const title = String(item.title ?? skuRaw);
      const retorno = Number(item.unit_price ?? 0) * qty;
      const taxaML = Number(item.sale_fee ?? 0) * qty; // sale_fee é por unidade
      const envio = envioPerUnit * qty;

      const mlbNumPedido = normalizeItemId(itemId);
      const produto = porMlb.get(mlbNumPedido) ?? porSku.get(normalizeSku(skuRaw));

      if (produto) {
        vinculado = true;
        const cmv = produto.custo * qty;
        const imposto = retorno * (produto.imposto / 100);
        totalRetorno += retorno;
        totalCMV += cmv;
        totalEnvio += envio;
        totalImposto += imposto;
        totalTaxasML += taxaML;

        const chave = mlbNumPedido || skuRaw;
        const prev = anunciosMap.get(chave);
        if (prev) {
          prev.retorno += retorno;
          prev.custoProduto += cmv;
          prev.envioFull += envio;
          prev.imposto += imposto;
          prev.taxaML += taxaML;
          prev.qty += qty;
        } else {
          anunciosMap.set(chave, {
            item_id: itemId || skuRaw,
            title: produto.name || title,
            retorno,
            custoProduto: cmv,
            envioFull: envio,
            imposto,
            taxaML,
            ads: 0,
            lucroBruto: 0,
            lucro: 0,
            margem: 0,
            qty,
          });
        }
      }
    }
    if (!vinculado && items.length > 0) pedidosSemVinculo++;
  }

  const usedAdKeys = new Set<string>();
  for (const [chave, a] of anunciosMap) {
    // adsByItem tem chaves em MLB uppercase (ex.: "MLB6577305336")
    const candidates = [chave, `MLB${chave}`, a.item_id.toUpperCase()];
    let ads = 0;
    for (const c of candidates) {
      if (adsByItem[c] != null) { ads = adsByItem[c]; usedAdKeys.add(c); break; }
    }
    a.ads = ads;
    a.lucroBruto = a.retorno - a.custoProduto - a.envioFull;
    a.lucro = a.lucroBruto - a.ads - a.imposto - a.taxaML;
    a.margem = a.retorno > 0 ? (a.lucro / a.retorno) * 100 : 0;
  }

  // Anúncios com gasto de ADS mas SEM venda no período → viram linhas próprias
  for (const [key, cost] of Object.entries(adsByItem)) {
    if (cost <= 0 || usedAdKeys.has(key)) continue;
    const prod = porMlb.get(normalizeItemId(key));
    anunciosMap.set(`__semvenda_${key}`, {
      item_id: key,
      title: prod?.name || `Anúncio ${key}`,
      retorno: 0, custoProduto: 0, envioFull: 0, imposto: 0, taxaML: 0,
      ads: cost, lucroBruto: 0, lucro: -cost, margem: 0, qty: 0,
      semVenda: true,
    });
  }

  // ADS total = TODO o investimento do período (agora todo representado em linhas)
  const totalAdsFull = Object.values(adsByItem).reduce((s, v) => s + v, 0);
  const adsNaoVinculado = 0;

  // vendidos primeiro (por retorno), depois os "sem venda" (por ADS)
  const anuncios = Array.from(anunciosMap.values()).sort(
    (a, b) => (b.retorno - a.retorno) || (b.ads - a.ads),
  );

  return {
    faturamentoBruto,
    vendasCanceladas,
    vendasDevolvidas,
    totalRetorno,
    totalCMV,
    totalEnvio,
    totalImposto,
    totalTaxasML,
    totalAds: totalAdsFull,
    adsNaoVinculado,
    anuncios,
    pedidosSemVinculo,
    ordersCount,
  };
}

export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  try {
    const url = new URL(req.url);
    const from = parseDateParam(url.searchParams.get("from"));
    const to = parseDateParam(url.searchParams.get("to"));
    const month = parseDateParam(url.searchParams.get("month"));
    const { start, end, startBR, endBR, fromStr, toStr } = buildRange(from, to, month);

    // ── Cache curto (bypass com ?fresh=1, usado no "Atualizar ML") ──
    const cacheKey = `${fromStr}|${toStr}`;
    const bust = url.searchParams.get("fresh") === "1";
    if (!bust) {
      const cached = metricsCache.get(cacheKey);
      if (cached && Date.now() - cached.at < CACHE_TTL) {
        return NextResponse.json({ ...cached.body, cached: true });
      }
    }

    const db = getAdminDb();

    // ── 1. Estoque: indexar por MLB (sem prefixo) e por SKU ───
    const prodSnap = await db.collection("estoque").get();
    const porMlb = new Map<string, ProdutoData>();
    const porSku = new Map<string, ProdutoData>();
    for (const doc of prodSnap.docs) {
      const d = doc.data();
      const entry: ProdutoData = {
        // Custo médio (livro de movimentações) tem prioridade; cai pro manual se ainda não houver entradas.
        custo: Number(d.custoMedio ?? d.custo ?? d.cost ?? 0),
        imposto: Number(d.imposto ?? d.tax ?? 0),
        mlb: String(d.mlb ?? "").trim(),
        name: String(d.name ?? ""),
        sku: String(d.sku ?? "").trim(),
      };
      const mlbList: string[] = Array.isArray(d.mlbs) && d.mlbs.length ? d.mlbs : entry.mlb ? [entry.mlb] : [];
      for (const m of mlbList) {
        const n = normalizeItemId(String(m));
        if (n) porMlb.set(n, entry);
      }
      if (entry.sku) porSku.set(normalizeSku(entry.sku), entry);
    }

    // ── 2. Data de hoje (BR) para o breakdown do dia ──────────
    const brNow = new Date(Date.now() - 3 * 3600 * 1000);
    const hj = `${brNow.getUTCFullYear()}-${String(brNow.getUTCMonth() + 1).padStart(2, "0")}-${String(brNow.getUTCDate()).padStart(2, "0")}`;

    // ── 3. ADS por item_id (período + hoje) ───────────────────
    // A API de ADS rejeita datas futuras → limita o fim ao dia de hoje.
    // Chamadas SEQUENCIAIS: a 1ª aquece o cache do advertiser e evita o burst
    // paralelo que causava rate limit (ADS zerado).
    const adsTo = toStr > hj ? hj : toStr;
    // O ML devolve 404 quando o período termina no dia corrente (dados de hoje
    // ainda não fecharam). Antes de desistir e zerar o ADS — o que inflava a
    // margem —, refaz a busca terminando ontem.
    const ontem = brDayISO(-1);
    const adsByItem: Record<string, number> =
      fromStr <= adsTo
        ? await getAdsSpendByItem(fromStr, adsTo).catch(() =>
            fromStr <= ontem ? getAdsSpendByItem(fromStr, ontem).catch(() => ({})) : {},
          )
        : {};
    const adsHoje: Record<string, number> = await getAdsSpendByItem(hj, hj).catch(() => ({}));

    // ── 4. Pedidos do período + de hoje (AO VIVO, com fallback) ─
    const token = await getMlAccessToken();
    const fromISO = `${fromStr}T00:00:00.000-03:00`;
    const toISO = `${toStr}T23:59:59.999-03:00`;
    const hjFromISO = `${hj}T00:00:00.000-03:00`;
    const hjToISO = `${hj}T23:59:59.999-03:00`;

    let orders = token ? await fetchOrdersLive(token, fromISO, toISO) : null;
    let ordersHoje = token ? await fetchOrdersLive(token, hjFromISO, hjToISO) : null;

    // fallback para o Firestore se o fetch ao vivo falhar
    if (!orders) orders = await loadOrders(db, start, end, startBR, endBR);
    if (!ordersHoje) ordersHoje = await loadOrders(db, `${hj}T00:00:00.000Z`, `${hj}T23:59:59.999Z`, hjFromISO, hjToISO);

    // enriquece o frete (shipping_cost) a partir do cache do Firestore
    const allIds = [...orders, ...ordersHoje].map((o) => String(o.order_id ?? "")).filter(Boolean);
    const shipMap = await readShippingCosts(db, allIds);
    for (const o of orders) if (o.shipping_cost == null) o.shipping_cost = shipMap.get(String(o.order_id)) ?? 0;
    for (const o of ordersHoje) if (o.shipping_cost == null) o.shipping_cost = shipMap.get(String(o.order_id)) ?? 0;

    // ── Devoluções + cancelamentos: separa por tipo ───────────
    // Cancelamento = venda que não aconteceu (estoque não saiu/voltou).
    // Devolução = venda revertida, produto volta ao estoque → 0 a 0.
    // Os dois entram no faturamento BRUTO, mas saem do líquido e do lucro.
    const [retUTC, retBR] = await Promise.all([
      db.collection("ml_returns").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_returns").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
    ]);
    const retMap = new Map<string, FirebaseFirestore.DocumentData>();
    for (const snap of [retUTC, retBR]) for (const doc of snap.docs) retMap.set(doc.id, doc.data());
    const cancelIds = new Set<string>();
    const devolIds = new Set<string>();
    for (const [id, r] of retMap) {
      if (String(r.tipo ?? "") === "devolucao") devolIds.add(id);
      else cancelIds.add(id); // cancelamento (ou sem tipo definido)
    }

    const agg = computeAggregates(orders, porMlb, porSku, adsByItem, cancelIds, devolIds);
    const aggHoje = computeAggregates(ordersHoje, porMlb, porSku, adsHoje, cancelIds, devolIds);

    // Série diária de faturamento líquido (para o gráfico de metas): sem
    // cancelados/devolvidos, pois representa a venda que de fato valeu.
    const serieMap = new Map<string, number>();
    for (const o of orders) {
      const oid = String(o.order_id ?? "");
      if (isNaoVenda(o.status) || cancelIds.has(oid) || devolIds.has(oid)) continue;
      const dia = String(o.date_created ?? "").slice(0, 10);
      if (dia) serieMap.set(dia, (serieMap.get(dia) ?? 0) + Number(o.total_amount ?? 0));
    }
    const serieDiaria = Array.from(serieMap.entries())
      .map(([data, faturamento]) => ({ data, faturamento }))
      .sort((a, b) => a.data.localeCompare(b.data));

    // Diagnóstico de ADS quando o total do período vem 0 (identifica a causa)
    const adsDiag = agg.totalAds === 0 && fromStr <= adsTo ? await probeAds(fromStr, adsTo) : null;

    // ── 5. Devoluções (informativo — já excluídas do faturamento/lucro acima) ──
    const devolucoes = Array.from(retMap.values()).reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
    const devolucoesDetalhe = Array.from(retMap.values())
      .map((r) => ({
        order_id: String(r.order_id ?? ""),
        valor: Number(r.total_amount ?? 0),
        data: String(r.date_created ?? "").slice(0, 10),
        motivo: String(r.reason ?? r.motivo ?? ""),
        produto: String(r.produto ?? r.title ?? ""),
        tipo: String(r.tipo ?? r.status ?? ""),
      }))
      .sort((a, b) => b.valor - a.valor);

    // ── 6. Custos operacionais ────────────────────────────────
    // Dias e meses cobertos pelo período selecionado
    const dFrom = new Date(`${fromStr}T00:00:00Z`).getTime();
    const dTo = new Date(`${toStr}T00:00:00Z`).getTime();
    const daysInPeriod = Math.max(1, Math.round((dTo - dFrom) / 86400000) + 1);
    const [fy, fm, fd] = fromStr.split("-").map(Number);
    const [ty, tm, td] = toStr.split("-").map(Number);
    // Custo MENSAL só entra em períodos que cobrem mês(es) completo(s).
    // Assim ele NÃO polui o lucro de "Hoje"/dias avulsos (é um custo do mês).
    const lastDayFrom = new Date(Date.UTC(fy, fm, 0)).getUTCDate();
    const isFullMonth = fy === ty && fm === tm && fd === 1 && td === lastDayFrom;
    const monthsInPeriod = Math.max(1, (ty - fy) * 12 + (tm - fm) + 1);

    const custosSnap = await db.collection("custos").get();
    let custosOp = 0;
    for (const doc of custosSnap.docs) {
      const d = doc.data();
      const valor = Number(d.valor ?? d.amount ?? 0);
      const data = String(d.data ?? d.date ?? "");
      const freq = String(d.freq ?? d.frequency ?? "avulso");
      if (freq === "diario" || freq === "daily") {
        custosOp += valor * daysInPeriod;                 // desconta todo dia
      } else if (freq === "mensal" || freq === "monthly") {
        if (isFullMonth) custosOp += valor * monthsInPeriod; // só no mês completo
      } else if (data >= fromStr && data <= toStr) {
        custosOp += valor;                                 // avulso: só na data
      }
    }

    // ── 7. Lucro líquido do dia (retorno − cmv − full − ads − taxas − imposto) ──
    const lucroLiquidoHoje =
      aggHoje.totalRetorno - aggHoje.totalCMV - aggHoje.totalEnvio - aggHoje.totalAds - aggHoje.totalTaxasML - aggHoje.totalImposto;

    // ── 8. Totais finais do período ───────────────────────────
    // Devoluções/cancelamentos NÃO entram aqui: o pedido já foi removido do
    // faturamento e dos custos no agregado, resultando em 0 a 0 (não é descontado cheio).
    const lucroSemCustos =
      agg.totalRetorno - agg.totalCMV - agg.totalEnvio - agg.totalAds - agg.totalImposto - agg.totalTaxasML;
    const lucroComCustos = lucroSemCustos - custosOp;
    const margemSemCustos = agg.totalRetorno > 0 ? (lucroSemCustos / agg.totalRetorno) * 100 : 0;
    const margemComCustos = agg.totalRetorno > 0 ? (lucroComCustos / agg.totalRetorno) * 100 : 0;

    // Faturamento líquido = bruto − vendas canceladas − vendas devolvidas.
    const faturamentoLiquido = agg.faturamentoBruto - agg.vendasCanceladas - agg.vendasDevolvidas;
    const faturamentoLiquidoHoje = aggHoje.faturamentoBruto - aggHoje.vendasCanceladas - aggHoje.vendasDevolvidas;

    const responseBody: Record<string, unknown> = {
      faturamentoBruto: agg.faturamentoBruto,
      faturamentoLiquido,
      vendasCanceladas: agg.vendasCanceladas,
      vendasDevolvidas: agg.vendasDevolvidas,
      totalRetorno: agg.totalRetorno,
      faturamentoHoje: faturamentoLiquidoHoje,
      pedidosHoje: aggHoje.ordersCount,
      ordersCount: agg.ordersCount,
      devolucoes,
      devolucoesDetalhe,
      totalCMV: agg.totalCMV,
      totalAds: agg.totalAds,
      adsNaoVinculado: agg.adsNaoVinculado,
      totalEnvio: agg.totalEnvio,
      totalImposto: agg.totalImposto,
      totalTaxasML: agg.totalTaxasML,
      custosOperacionais: custosOp,
      lucroSemCustos,
      lucroComCustos,
      margemSemCustos,
      margemComCustos,
      anuncios: agg.anuncios,
      pedidosSemVinculo: agg.pedidosSemVinculo,
      // Breakdown do dia para o card "Vendas do Dia"
      hoje: {
        faturamentoBruto: aggHoje.faturamentoBruto,
        faturamentoLiquido: faturamentoLiquidoHoje,
        vendasCanceladas: aggHoje.vendasCanceladas,
        vendasDevolvidas: aggHoje.vendasDevolvidas,
        totalCMV: aggHoje.totalCMV,
        totalAds: aggHoje.totalAds,
        totalEnvio: aggHoje.totalEnvio,
        totalTaxasML: aggHoje.totalTaxasML,
        totalImposto: aggHoje.totalImposto,
        lucroLiquido: lucroLiquidoHoje,
        pedidos: aggHoje.ordersCount,
      },
      serieDiaria,
      adsDiag,
      from: fromStr,
      to: toStr,
    };
    metricsCache.set(cacheKey, { at: Date.now(), body: responseBody });
    return NextResponse.json(responseBody);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "metrics_failed", details: msg }, { status: 500 });
  }
}
