"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtBRL } from "@/lib/domain/calc";
import { authedFetch } from "@/lib/api/authed-fetch";
import DateRangePicker from "@/components/dashboard/DateRangePicker";
import { calculateBreakEvenRoas, getAdRecommendation } from "@/lib/domain/ads";
import type { Product } from "@/lib/domain/types";
import AdsChangelogPanel from "@/components/tabs/ads/AdsChangelogPanel";

// Status da CAMPANHA (não do anúncio no catálogo) — é o que decide se o
// investimento está de fato rodando agora.
type StatusAnuncio = "ativo" | "pausado" | "sem_campanha" | "config_indisponivel";

type AdItem = {
  itemId: string; title: string;
  status: StatusAnuncio; campaignId: string; campaignName: string; mlStatus: string;
  clicks: number; prints: number; cost: number;
  directSales: number; directUnits: number;
  adSales: number; adUnits: number;
  totalSales: number; totalUnits: number;
  lucroAntesAds: number; lucroLiquido: number;
  lucroDiretoAntesAds: number; lucroDiretoLiquido: number;
  /** false = sem venda vinculada no período pra calcular a margem do "direto"
   *  — não é prejuízo real, é falta de dado (ver route.ts). */
  diretoDisponivel: boolean;
  dailyBudget: number; roasTarget: number; acosTarget: number;
};

const STATUS_META: Record<StatusAnuncio, { label: string; cor: string; bg: string }> = {
  ativo: { label: "Ativa", cor: "var(--green)", bg: "rgba(54,179,126,.12)" },
  pausado: { label: "Pausada", cor: "#F4B942", bg: "rgba(244,185,66,.12)" },
  sem_campanha: { label: "Sem campanha", cor: "var(--muted)", bg: "rgba(185,181,166,.14)" },
  // Sabemos o id da campanha, mas o ML não devolveu a configuração dela.
  config_indisponivel: { label: "Campanha ?", cor: "#F4B942", bg: "rgba(244,185,66,.12)" },
};

function StatusTag({ item }: { item: AdItem }) {
  const m = STATUS_META[item.status];
  const tooltip = item.status === "config_indisponivel"
    ? `Este anúncio está na campanha ${item.campaignId}, mas o Mercado Ads não devolveu a configuração dela (nem na lista de campanhas, nem na busca por id). Orçamento/ROAS alvo ficam vazios por isso — o gasto e as vendas continuam corretos.`
    : item.campaignId
      ? `Campanha: ${item.campaignName || item.campaignId}${item.mlStatus ? ` · catálogo: ${item.mlStatus}` : ""}`
      : "Não achamos a campanha deste anúncio na busca do Mercado Ads.";
  return (
    <span
      title={tooltip}
      style={{
        fontSize: ".62rem", fontWeight: 700, color: m.cor, background: m.bg,
        padding: "1px 7px", borderRadius: 5, whiteSpace: "nowrap", cursor: "help",
      }}
    >
      {m.label}
    </span>
  );
}

const DIAG_TONE_COLOR: Record<"pos" | "neg" | "warn" | "muted", string> = {
  pos: "var(--success,var(--green))", neg: "var(--danger,var(--red))", warn: "var(--warning,#F4B942)", muted: "var(--text-muted,var(--muted))",
};

function DiagCard({ label, nome, valor, tone }: { label: string; nome: string; valor: string; tone: "pos" | "neg" | "warn" | "muted" }) {
  return (
    <div style={{ background: "var(--surface-raised,var(--surface2))", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: ".68rem", textTransform: "uppercase", letterSpacing: ".04em", color: "var(--text-muted,var(--muted))", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: ".84rem", fontWeight: 700, color: DIAG_TONE_COLOR[tone], marginBottom: 2 }}>{valor}</div>
      <div style={{ fontSize: ".72rem", color: "var(--text-secondary,var(--muted))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={nome}>{nome}</div>
    </div>
  );
}

type Modo = "pub" | "geral" | "log";

function isoOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// Mês atual até hoje (igual ao painel do Mercado Ads) — do dia 1º até agora.
function mesAteHoje() {
  const d = new Date();
  return { from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`, to: isoOf(d) };
}
const num = (n: number, d = 0) => n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const corRoas = (r: number) => (r >= 3 ? "var(--green)" : r >= 1.5 ? "var(--yellow)" : "var(--red)");
const corAcos = (a: number, tem: boolean) => (!tem ? "var(--muted)" : a <= 25 ? "var(--green)" : a <= 45 ? "var(--yellow)" : "var(--red)");
// Margem de lucro líquido final: verde a partir de 15% (bom pra e-commerce
// com ADS no meio), amarelo entre 0-15% (positivo mas apertado), vermelho
// negativo — mesmos limiares usados no resto do dashboard.
const corMargem = (m: number) => (m >= 15 ? "var(--green)" : m >= 0 ? "var(--yellow)" : "var(--red)");

export default function AdsTab({ metaMargem = 10, products = [] }: { metaMargem?: number; products?: Product[] }) {
  const [range, setRange] = useState(() => mesAteHoje());
  const [modo, setModo] = useState<Modo>("pub");
  const [items, setItems] = useState<AdItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<StatusAnuncio | "">("");
  const [lucroFiltro, setLucroFiltro] = useState<"" | "lucro" | "prejuizo">("");
  const [roasMin, setRoasMin] = useState("");
  const [roasMax, setRoasMax] = useState("");
  const [acosMin, setAcosMin] = useState("");
  const [acosMax, setAcosMax] = useState("");
  const [investMin, setInvestMin] = useState("");
  const [investMax, setInvestMax] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  type Tentativa = { tentativa: string; status?: number; body?: string; erro?: string };
  const [diag, setDiag] = useState<{
    advertisersStatus?: number; itemsStatus?: number; itemsStatusV1?: number; itemsStatusV2?: number;
    advertiserId?: number | string; conta?: { tokenNickname?: string; mesmaConta?: boolean };
    tentativas?: Tentativa[]; periodo?: { from?: string; to?: string };
  } | null>(null);
  // Diagnóstico de orçamento/ROAS/última alteração — para quando essas colunas
  // vierem vazias sem o pedido inteiro ter falhado (ver getAdsSettingsByItem).
  const [cfgDiag, setCfgDiag] = useState<{ url: string; status: number }[]>([]);
  const [cfgAmostra, setCfgAmostra] = useState<{ campanha?: unknown; campanhaOrfa?: unknown } | null>(null);
  const [campanhasEncontradas, setCampanhasEncontradas] = useState(0);
  const [semGastoNoPeriodo, setSemGastoNoPeriodo] = useState(0);
  // Roster completo de campanhas da conta (mesmo as sem gasto no período) —
  // pra conferir que nenhuma campanha real sumiu da tela, já que a tabela
  // principal só mostra quem gastou.
  const [campanhasTotal, setCampanhasTotal] = useState(0);
  const [campanhasResumo, setCampanhasResumo] = useState<{ id: string; name: string; status: string; gasto: number; totalAds: number }[]>([]);
  // anunciosTotal = anúncios cadastrados nas campanhas da conta (sem filtro de
  // data); anunciosNoPeriodo = quantos tiveram alguma atividade no período —
  // só esses últimos entram na tabela (com ou sem gasto).
  const [anunciosTotal, setAnunciosTotal] = useState(0);
  const [anunciosNoPeriodo, setAnunciosNoPeriodo] = useState(0);
  const [anunciosContagemFalhou, setAnunciosContagemFalhou] = useState(false);
  // Investimento que não caiu em nenhuma campanha conhecida — precisa ficar
  // visível, senão a soma das campanhas fica menor que o investimento do topo
  // sem nenhuma explicação.
  const [gastoOrfao, setGastoOrfao] = useState(0);
  const [gastoSemVinculo, setGastoSemVinculo] = useState(0);
  const [campanhasOrfas, setCampanhasOrfas] = useState<string[]>([]);
  // Totais da conta inteira no período (todos os itens, anunciados ou não) —
  // serve pra dizer quanto do faturamento os itens anunciados representam.
  const [conta, setConta] = useState<{ receita: number; unidades: number; lucroAntesAds: number; itens: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErro(null); setDiag(null);
    try {
      const r = await authedFetch(`/api/ml/ads?from=${range.from}&to=${range.to}`, { cache: "no-store" });
      const j = await r.json();
      if (j.error) {
        setDiag(j.diag ?? null);
        setErro(j.diag ? JSON.stringify(j.diag, null, 2) : (j.details ?? j.error));
        setItems([]);
      } else {
        setItems(j.items ?? []);
        setCfgDiag(j.cfgDiag ?? []);
        setCfgAmostra(j.cfgAmostra ?? null);
        setCampanhasEncontradas(j.campanhasEncontradas ?? 0);
        setSemGastoNoPeriodo(j.semGastoNoPeriodo ?? 0);
        setCampanhasTotal(j.campanhasTotal ?? 0);
        setCampanhasResumo(j.campanhasResumo ?? []);
        setAnunciosTotal(j.anunciosTotal ?? 0);
        setAnunciosNoPeriodo(j.anunciosNoPeriodo ?? 0);
        setAnunciosContagemFalhou(!!j.anunciosContagemFalhou);
        setGastoOrfao(j.gastoOrfao ?? 0);
        setGastoSemVinculo(j.gastoSemVinculo ?? 0);
        setCampanhasOrfas(j.campanhasOrfas ?? []);
        setConta(j.conta ?? null);
      }
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const t = useMemo(() => items.reduce((a, i) => {
    a.cost += i.cost; a.clicks += i.clicks; a.prints += i.prints;
    a.direct += i.directSales; a.directUn += i.directUnits;
    a.adSales += i.adSales; a.total += i.totalSales; a.totalUn += i.totalUnits;
    a.lucroAntes += i.lucroAntesAds; a.lucroLiq += i.lucroLiquido;
    // Só soma o "direto" de quem tem dado — incluir os sem dado (valor 0,
    // custo cheio) puxava a soma pra negativo mesmo com ROAS bom.
    if (i.diretoDisponivel) a.lucroLiqDireto += i.lucroDiretoLiquido;
    else a.semDadoDireto += 1;
    return a;
  }, { cost: 0, clicks: 0, prints: 0, direct: 0, directUn: 0, adSales: 0, total: 0, totalUn: 0, lucroAntes: 0, lucroLiq: 0, lucroLiqDireto: 0, semDadoDireto: 0 }), [items]);

  const pub = modo === "pub";

  // Uma passada só com tudo derivado por anúncio — tabela e diagnóstico usam
  // o mesmo resultado, evita calcular break-even/recomendação duas vezes.
  const linhas = useMemo(() => items.map((i) => {
    const v = pub ? i.directSales : i.totalSales;
    const un = pub ? i.directUnits : i.totalUnits;
    const r = i.cost > 0 ? v / i.cost : 0;
    const a = v > 0 ? (i.cost / v) * 100 : 0;
    const ctr = i.prints > 0 ? (i.clicks / i.prints) * 100 : 0;
    const cpc = i.clicks > 0 ? i.cost / i.clicks : 0;
    const pctAds = i.totalSales > 0 ? (i.adSales / i.totalSales) * 100 : 0;
    const breakEven = calculateBreakEvenRoas(v, pub ? i.lucroDiretoAntesAds : i.lucroAntesAds);
    const abaixoDoBreakEven = breakEven != null && i.cost > 0 && r < breakEven;
    const lucroAtual = pub ? (i.diretoDisponivel ? i.lucroDiretoLiquido : null) : i.lucroLiquido;
    const margemAtual = v > 0 && lucroAtual != null ? (lucroAtual / v) * 100 : null;
    const reco = getAdRecommendation({
      clicks: i.clicks, vendas: v, cost: i.cost, lucro: lucroAtual, roas: r,
      roasTarget: i.roasTarget, breakEvenRoas: breakEven, margem: margemAtual,
      metaMargem,
    });
    return { i, v, un, r, a, ctr, cpc, pctAds, breakEven, abaixoDoBreakEven, lucroAtual, margemAtual, reco };
  }), [items, pub, metaMargem]);

  // Diagnóstico de Ads: melhores/piores casos do período, pra achar o que
  // precisa de atenção sem ler a tabela inteira.
  const diagnostico = useMemo(() => {
    const comCusto = linhas.filter((l) => l.i.cost > 0);
    const maisLucrativo = linhas.filter((l) => l.lucroAtual != null).sort((a, b) => (b.lucroAtual ?? 0) - (a.lucroAtual ?? 0))[0] ?? null;
    const maiorDesperdicio = linhas.filter((l) => l.lucroAtual != null && l.lucroAtual < 0).sort((a, b) => (a.lucroAtual ?? 0) - (b.lucroAtual ?? 0))[0] ?? null;
    const maiorRoas = comCusto.length ? comCusto.reduce((m, l) => (l.r > m.r ? l : m)) : null;
    const menorRoas = comCusto.length ? comCusto.reduce((m, l) => (l.r < m.r ? l : m)) : null;
    const semRetorno = linhas.filter((l) => l.i.cost > 0 && l.v === 0);
    const investimentoSemRetorno = semRetorno.reduce((s, l) => s + l.i.cost, 0);
    const paraRevisao = linhas.filter((l) => l.reco.acao === "pausar" || l.reco.acao === "reduzir");
    return { maisLucrativo, maiorDesperdicio, maiorRoas, menorRoas, semRetorno, investimentoSemRetorno, paraRevisao };
  }, [linhas]);

  // Filtros da tabela — o Diagnóstico acima continua olhando o período
  // inteiro (linhas), só a tabela reage a esses filtros.
  const linhasFiltradas = useMemo(() => {
    const rMin = roasMin.trim() ? Number(roasMin.replace(",", ".")) : null;
    const rMax = roasMax.trim() ? Number(roasMax.replace(",", ".")) : null;
    const acMin = acosMin.trim() ? Number(acosMin.replace(",", ".")) : null;
    const acMax = acosMax.trim() ? Number(acosMax.replace(",", ".")) : null;
    const invMin = investMin.trim() ? Number(investMin.replace(",", ".")) : null;
    const invMax = investMax.trim() ? Number(investMax.replace(",", ".")) : null;
    const q = busca.trim().toLowerCase();
    return linhas.filter((l) => {
      if (q && !(l.i.title.toLowerCase().includes(q) || l.i.itemId.toLowerCase().includes(q))) return false;
      if (statusFiltro && l.i.status !== statusFiltro) return false;
      if (lucroFiltro === "lucro" && (l.lucroAtual == null || l.lucroAtual <= 0)) return false;
      if (lucroFiltro === "prejuizo" && (l.lucroAtual == null || l.lucroAtual >= 0)) return false;
      if (rMin != null && !Number.isNaN(rMin) && l.r < rMin) return false;
      if (rMax != null && !Number.isNaN(rMax) && l.r > rMax) return false;
      if (acMin != null && !Number.isNaN(acMin) && l.a < acMin) return false;
      if (acMax != null && !Number.isNaN(acMax) && l.a > acMax) return false;
      if (invMin != null && !Number.isNaN(invMin) && l.i.cost < invMin) return false;
      if (invMax != null && !Number.isNaN(invMax) && l.i.cost > invMax) return false;
      return true;
    });
  }, [linhas, busca, statusFiltro, lucroFiltro, roasMin, roasMax, acosMin, acosMax, investMin, investMax]);

  // Valores do modo: vendas/unidades/roas/acos conforme "só ads" ou "geral"
  const vendasTot = pub ? t.direct : t.total;
  const unTot = pub ? t.directUn : t.totalUn;
  const roas = t.cost > 0 ? vendasTot / t.cost : 0;
  const acos = vendasTot > 0 ? (t.cost / vendasTot) * 100 : 0;
  const pctViaAds = t.total > 0 ? (t.adSales / t.total) * 100 : 0;

  const kpis = pub ? [
    { lbl: "Investimento", val: fmtBRL(t.cost), tone: "neg", sub: `${items.length} anúncio(s)` },
    { lbl: "Vendas diretas", val: fmtBRL(t.direct), tone: "pos", sub: `${num(t.directUn)} un via clique no ad` },
    { lbl: "ROAS direto", val: `${num(roas, 2)}x`, tone: "acc", sub: "vendas diretas ÷ investido", cor: corRoas(roas) },
    { lbl: "ACOS direto", val: `${num(acos, 1)}%`, tone: "warn", sub: "investido ÷ vendas diretas", cor: corAcos(acos, t.direct > 0) },
    { lbl: "Impressões", val: num(t.prints), tone: "acc", sub: `CTR ${num(t.prints > 0 ? (t.clicks / t.prints) * 100 : 0, 2)}%` },
    { lbl: "Cliques", val: num(t.clicks), tone: "acc", sub: `CPC ${fmtBRL(t.clicks > 0 ? t.cost / t.clicks : 0)}` },
    { lbl: "Lucro após ads (direto)", val: fmtBRL(t.lucroLiqDireto), tone: t.lucroLiqDireto >= 0 ? "pos" : "neg", sub: `geral: ${fmtBRL(t.lucroLiq)}${t.semDadoDireto ? ` · ${t.semDadoDireto} sem dado p/ direto` : ""}`, cor: t.lucroLiqDireto >= 0 ? "var(--green)" : "var(--red)" },
  ] : [
    { lbl: "Investimento", val: fmtBRL(t.cost), tone: "neg", sub: `${items.length} anúncio(s)` },
    { lbl: "Vendas totais", val: fmtBRL(t.total), tone: "pos", sub: `${num(t.totalUn)} un · só os itens anunciados${conta && conta.receita > 0 ? ` (conta toda: ${fmtBRL(conta.receita)})` : ""}` },
    { lbl: "ROAS geral", val: `${num(roas, 2)}x`, tone: "acc", sub: "vendas totais ÷ investido", cor: corRoas(roas) },
    { lbl: "TACOS", val: `${num(acos, 1)}%`, tone: "warn", sub: "investido ÷ vendas totais", cor: corAcos(acos, t.total > 0) },
    { lbl: "Vendas via ads", val: `${num(pctViaAds, 0)}%`, tone: "acc", sub: `${fmtBRL(t.adSales)} vieram do ad` },
    { lbl: "Orgânico", val: `${num(100 - pctViaAds, 0)}%`, tone: "pos", sub: "vendas sem tráfego pago" },
    { lbl: "Lucro após ads (geral)", val: fmtBRL(t.lucroLiq), tone: t.lucroLiq >= 0 ? "pos" : "neg", sub: `direto: ${fmtBRL(t.lucroLiqDireto)}`, cor: t.lucroLiq >= 0 ? "var(--green)" : "var(--red)" },
  ];

  // CSV da tabela FILTRADA (linhasFiltradas), gerado no cliente — sem rota
  // nova. ";" como separador porque num() já usa vírgula decimal (pt-BR);
  // com "," como separador o Excel quebraria o número ao abrir.
  function exportarCsv() {
    const header = pub
      ? ["Anúncio", "MLB", "Orç/dia", "ROAS alvo", "Impressões", "Cliques", "CTR %", "CPC", "Investido", "Vendas diretas", "Unidades", "ACOS %", "ROAS", "Break-even ROAS", "Lucro", "Margem %"]
      : ["Anúncio", "MLB", "Orç/dia", "ROAS alvo", "Investido", "Vendas totais", "Unidades", "% via ads", "TACOS %", "ROAS", "Break-even ROAS", "Lucro", "Margem %"];

    const linhasCsv = linhasFiltradas.map(({ i, v, un, r, a, ctr, cpc, pctAds, breakEven, lucroAtual, margemAtual }) => {
      const comuns = [i.title || i.itemId, i.itemId, i.dailyBudget > 0 ? num(i.dailyBudget, 2) : "", i.roasTarget > 0 ? num(i.roasTarget, 1) : ""];
      const fim = [
        i.cost > 0 ? num(r, 2) : "", breakEven != null ? num(breakEven, 2) : "",
        lucroAtual != null ? num(lucroAtual, 2) : "", margemAtual != null ? num(margemAtual, 1) : "",
      ];
      return pub
        ? [...comuns, num(i.prints), num(i.clicks), num(ctr, 2), num(cpc, 2), num(i.cost, 2), num(v, 2), num(un), num(a, 1), ...fim]
        : [...comuns, num(i.cost, 2), num(v, 2), num(un), num(pctAds, 0), num(a, 1), ...fim];
    });

    const linhas2 = [header, ...linhasCsv]
      .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))
      .join("\r\n");
    const blob = new Blob([String.fromCharCode(0xfeff) + linhas2], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a2 = document.createElement("a");
    a2.href = url;
    a2.download = `ads-${pub ? "publicidade" : "geral"}-${range.from}_a_${range.to}.csv`;
    a2.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="dash">
      <div className="tab-head">
        <div className="tab-head-left">
          <h2 className="tab-title">Ads</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={load} disabled={loading}>
            {loading ? "..." : "⟳ Atualizar"}
          </button>
        </div>
        <DateRangePicker from={range.from} to={range.to} onApply={(from, to) => setRange({ from, to })} />
      </div>

      {/* Toggle de análise */}
      <div className="seg" style={{ alignSelf: "flex-start" }}>
        <button type="button" className={`seg-btn ${modo === "pub" ? "active" : ""}`} onClick={() => setModo("pub")}>Publicidade (ads direto)</button>
        <button type="button" className={`seg-btn ${modo === "geral" ? "active" : ""}`} onClick={() => setModo("geral")}>Geral (todas as vendas)</button>
        <button type="button" className={`seg-btn ${modo === "log" ? "active" : ""}`} onClick={() => setModo("log")}>Últimas alterações</button>
      </div>

      {modo === "log" ? (
        <AdsChangelogPanel campanhas={campanhasResumo} products={products} itemCampaigns={items} />
      ) : (
      <>
      <div style={{ fontSize: ".78rem", color: "var(--muted)", marginTop: -6 }}>
        {pub
          ? "Só o que saiu direto do anúncio — mede a eficiência do ad em si."
          : "Gasto de ads vs TUDO que os itens anunciados venderam (ads + orgânico) — o impacto real no faturamento deles."}
      </div>
      {/* Sem isso, "Vendas totais" aqui parece brigar com o faturamento do
          dashboard: são recortes diferentes (itens anunciados vs conta toda). */}
      {!pub && conta && conta.receita > 0 && (
        <div style={{ fontSize: ".72rem", color: "var(--muted)", marginTop: -2 }}>
          Esta aba cobre <b>só os {items.length} item(ns) anunciados</b>: {fmtBRL(t.total)} dos {fmtBRL(conta.receita)} que a
          conta faturou no período ({num((t.total / conta.receita) * 100, 0)}% do total, {conta.itens} item(ns) vendidos ao todo).
          Por isso o número aqui é menor que o faturamento do dashboard — não é divergência, é recorte.
        </div>
      )}

      {erro ? (
        <div style={{ padding: "12px 14px", background: "rgba(214,90,74,.08)", border: "1px solid rgba(214,90,74,.3)", borderRadius: 8, fontSize: ".8rem", color: "var(--red)" }}>
          {(() => {
            const adv = diag?.advertisersStatus;
            const it = diag?.itemsStatus;
            if (adv === 401 || adv === 403) return (<>O token do Mercado Livre <b>não tem permissão de Publicidade / Mercado Ads</b>. Reconecte a conta concedendo esse acesso.</>);
            if (it === 404) return (<>O Mercado Ads recusou a busca dos anúncios (404) em <b>{range.from.split("-").reverse().join("/")} a {range.to.split("-").reverse().join("/")}</b>. Conta e permissão estão OK ({diag?.conta?.tokenNickname ?? "—"}, anunciante {String(diag?.advertiserId ?? "—")}). Abaixo, o que cada recurso do ML respondeu:</>);
            return (<>Não consegui puxar os Ads agora. O token está autorizado (anunciante {String(diag?.advertisersStatus ?? "—")}), então deve ser instabilidade do Mercado Ads — tente <b>Atualizar</b> em instantes.</>);
          })()}

          {/* Sonda por recurso — o dado que importa, visível sem rolar JSON */}
          {diag?.tentativas?.length ? (
            <div className="table-wrapper" style={{ marginTop: 10, border: "1px solid rgba(214,90,74,.25)" }}>
              <table className="tbl-modern tbl-cards">
                <thead><tr>
                  <th style={{ textAlign: "left" }}>Recurso do ML</th>
                  <th>Status</th>
                  <th style={{ textAlign: "left" }}>Resposta do ML</th>
                </tr></thead>
                <tbody>
                  {diag.tentativas.map((t) => (
                    <tr key={t.tentativa}>
                      <td style={{ textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }}>{t.tentativa}</td>
                      <td data-label="Status" style={{ fontWeight: 800, color: t.status && t.status < 300 ? "var(--green)" : "var(--red)" }}>{t.status ?? "erro"}</td>
                      <td data-label="Resposta do ML" style={{ textAlign: "left", fontFamily: "monospace", fontSize: ".66rem", color: "var(--muted)", wordBreak: "break-all" }}>{t.body || t.erro || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", fontSize: ".72rem", color: "var(--muted)" }}>Diagnóstico completo (JSON)</summary>
            <pre style={{ marginTop: 6, whiteSpace: "pre-wrap", color: "var(--muted)", fontSize: ".7rem", maxHeight: 300, overflow: "auto" }}>{erro}</pre>
          </details>
        </div>
      ) : (
        <>
          <div className="kpi-grid">
            {kpis.map((k) => (
              <div key={k.lbl} className={`kpi k-${k.tone}`}>
                <div className="k-lbl">{k.lbl}</div>
                <div className="k-val" style={{ color: k.cor }}>{k.val}</div>
                <div className="k-sub">{k.sub}</div>
              </div>
            ))}
          </div>

          {items.length > 0 && (
            <div className="panel">
              <div className="panel-title" style={{ marginBottom: 12 }}>Diagnóstico de Ads</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
                {diagnostico.maisLucrativo && (
                  <DiagCard label="Mais lucrativo" nome={diagnostico.maisLucrativo.i.title || diagnostico.maisLucrativo.i.itemId} valor={fmtBRL(diagnostico.maisLucrativo.lucroAtual ?? 0)} tone="pos" />
                )}
                {diagnostico.maiorDesperdicio && (
                  <DiagCard label="Maior desperdício" nome={diagnostico.maiorDesperdicio.i.title || diagnostico.maiorDesperdicio.i.itemId} valor={fmtBRL(diagnostico.maiorDesperdicio.lucroAtual ?? 0)} tone="neg" />
                )}
                {diagnostico.maiorRoas && diagnostico.maiorRoas.r > 0 && (
                  <DiagCard label="Maior ROAS" nome={diagnostico.maiorRoas.i.title || diagnostico.maiorRoas.i.itemId} valor={`${num(diagnostico.maiorRoas.r, 2)}x`} tone="pos" />
                )}
                {diagnostico.menorRoas && diagnostico.menorRoas.r > 0 && (
                  <DiagCard label="Menor ROAS" nome={diagnostico.menorRoas.i.title || diagnostico.menorRoas.i.itemId} valor={`${num(diagnostico.menorRoas.r, 2)}x`} tone="neg" />
                )}
                <DiagCard label="Investimento sem retorno" nome={`${diagnostico.semRetorno.length} anúncio(s) sem nenhuma venda no período`} valor={fmtBRL(diagnostico.investimentoSemRetorno)} tone={diagnostico.investimentoSemRetorno > 0 ? "neg" : "muted"} />
                <DiagCard label="Anúncios pra revisar" nome="lucro negativo ou ROAS abaixo do alvo e do break-even" valor={String(diagnostico.paraRevisao.length)} tone={diagnostico.paraRevisao.length > 0 ? "warn" : "muted"} />
              </div>
            </div>
          )}

          <div className="panel">
            <div className="panel-head" style={{ marginBottom: 8 }}>
              <span className="panel-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                Por anúncio — {pub ? "publicidade" : "geral"}
                {linhasFiltradas.length > 0 && (
                  <button type="button" className="btn btn-xs btn-ghost" onClick={exportarCsv} title="Exporta as linhas visíveis (respeitando os filtros ativos) em CSV">
                    ⬇ Exportar CSV
                  </button>
                )}
              </span>
              <span className="panel-sub" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                ordenado por investimento
                {semGastoNoPeriodo > 0 && (
                  <span
                    title="Anúncios sem nenhum investimento no período — ocultados de propósito pra não poluir a tela"
                    style={{ fontSize: ".68rem", color: "var(--muted)", cursor: "help" }}
                  >
                    ({semGastoNoPeriodo} sem gasto ocultado{semGastoNoPeriodo === 1 ? "" : "s"})
                  </span>
                )}
                {items.length > 0 && (
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(["ativo", "pausado", "config_indisponivel", "sem_campanha"] as const).map((s) => {
                      const n = items.filter((i) => i.status === s).length;
                      if (!n) return null;
                      const m = STATUS_META[s];
                      const ativo = statusFiltro === s;
                      return (
                        <button
                          key={s} type="button" title={`Filtrar: só ${m.label.toLowerCase()}`}
                          onClick={() => setStatusFiltro(ativo ? "" : s)}
                          style={{
                            fontSize: ".68rem", fontWeight: 700, color: m.cor, background: m.bg, padding: "1px 7px",
                            borderRadius: 5, border: ativo ? `1px solid ${m.cor}` : "1px solid transparent", cursor: "pointer",
                          }}
                        >
                          {n} {m.label.toLowerCase()}
                        </button>
                      );
                    })}
                    {(["lucro", "prejuizo"] as const).map((f) => {
                      const ativo = lucroFiltro === f;
                      const cor = f === "lucro" ? "var(--success,var(--green))" : "var(--danger,var(--red))";
                      return (
                        <button
                          key={f} type="button" onClick={() => setLucroFiltro(ativo ? "" : f)}
                          style={{
                            fontSize: ".68rem", fontWeight: 700, color: cor, background: "transparent", padding: "1px 7px",
                            borderRadius: 5, border: `1px solid ${ativo ? cor : "var(--border)"}`, cursor: "pointer",
                          }}
                        >
                          {f === "lucro" ? "lucrativos" : "prejuízo"}
                        </button>
                      );
                    })}
                    {(statusFiltro || lucroFiltro) && (
                      <button type="button" onClick={() => { setStatusFiltro(""); setLucroFiltro(""); }} style={{ fontSize: ".68rem", color: "var(--text-muted,var(--muted))", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                        limpar filtro
                      </button>
                    )}
                  </span>
                )}
              </span>
            </div>

            {items.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                <input
                  type="text" placeholder="Buscar produto…" value={busca} onChange={(e) => setBusca(e.target.value)}
                  style={{ minWidth: 160, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 10px", color: "var(--text)", fontSize: ".78rem", outline: "none" }}
                />
                <span style={{ fontSize: ".72rem", color: "var(--text-muted,var(--muted))", fontWeight: 600 }}>ROAS:</span>
                <input type="number" inputMode="decimal" placeholder="mín." value={roasMin} onChange={(e) => setRoasMin(e.target.value)} style={{ width: 64, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 8px", color: "var(--text)", fontSize: ".78rem", outline: "none" }} />
                <span style={{ color: "var(--text-muted,var(--muted))" }}>–</span>
                <input type="number" inputMode="decimal" placeholder="máx." value={roasMax} onChange={(e) => setRoasMax(e.target.value)} style={{ width: 64, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 8px", color: "var(--text)", fontSize: ".78rem", outline: "none" }} />

                <span style={{ fontSize: ".72rem", color: "var(--text-muted,var(--muted))", fontWeight: 600, marginLeft: 6 }}>{pub ? "ACOS" : "TACOS"} %:</span>
                <input type="number" inputMode="decimal" placeholder="mín." value={acosMin} onChange={(e) => setAcosMin(e.target.value)} style={{ width: 64, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 8px", color: "var(--text)", fontSize: ".78rem", outline: "none" }} />
                <span style={{ color: "var(--text-muted,var(--muted))" }}>–</span>
                <input type="number" inputMode="decimal" placeholder="máx." value={acosMax} onChange={(e) => setAcosMax(e.target.value)} style={{ width: 64, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 8px", color: "var(--text)", fontSize: ".78rem", outline: "none" }} />

                <span style={{ fontSize: ".72rem", color: "var(--text-muted,var(--muted))", fontWeight: 600, marginLeft: 6 }}>Investido R$:</span>
                <input type="number" inputMode="decimal" placeholder="mín." value={investMin} onChange={(e) => setInvestMin(e.target.value)} style={{ width: 74, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 8px", color: "var(--text)", fontSize: ".78rem", outline: "none" }} />
                <span style={{ color: "var(--text-muted,var(--muted))" }}>–</span>
                <input type="number" inputMode="decimal" placeholder="máx." value={investMax} onChange={(e) => setInvestMax(e.target.value)} style={{ width: 74, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 8px", color: "var(--text)", fontSize: ".78rem", outline: "none" }} />

                {(roasMin || roasMax || acosMin || acosMax || investMin || investMax) && (
                  <button type="button" className="btn btn-xs btn-ghost" onClick={() => { setRoasMin(""); setRoasMax(""); setAcosMin(""); setAcosMax(""); setInvestMin(""); setInvestMax(""); }}>
                    Limpar faixas
                  </button>
                )}
              </div>
            )}

            {loading ? (
              <div className="empty-state">Carregando…</div>
            ) : items.length === 0 ? (
              <div className="empty-state"><span className="empty-ico">📣</span>Sem dados de Ads no período.</div>
            ) : linhasFiltradas.length === 0 ? (
              <div className="empty-state"><span className="empty-ico">📣</span>Nenhum anúncio bate com esse filtro.</div>
            ) : (
              <div className="table-wrapper" style={{ border: "none" }}>
                <table className="tbl-modern tbl-cards">
                  <thead>
                    {pub ? (
                      <tr>
                        <th style={{ textAlign: "left" }}>Anúncio</th>
                        <th style={{ textAlign: "right" }}>Orç/dia</th>
                        <th style={{ textAlign: "right" }}>ROAS alvo</th>
                        <th style={{ textAlign: "right" }}>Impr.</th>
                        <th style={{ textAlign: "right" }}>Cliques</th>
                        <th style={{ textAlign: "right" }}>CTR</th>
                        <th style={{ textAlign: "right" }}>CPC</th>
                        <th style={{ textAlign: "right" }}>Investido</th>
                        <th style={{ textAlign: "right" }}>Vendas diretas</th>
                        <th style={{ textAlign: "right" }}>Un</th>
                        <th style={{ textAlign: "right" }}>ACOS</th>
                        <th style={{ textAlign: "right" }}>ROAS</th>
                        <th style={{ textAlign: "right" }} title="ROAS mínimo pra não perder dinheiro com o ad — abaixo dele, o gasto consome mais que o lucro que sobra antes do ads.">Break-even</th>
                        <th style={{ textAlign: "right" }}>Lucro</th>
                        <th style={{ textAlign: "right" }}>Margem</th>
                      </tr>
                    ) : (
                      <tr>
                        <th style={{ textAlign: "left" }}>Anúncio</th>
                        <th style={{ textAlign: "right" }}>Orç/dia</th>
                        <th style={{ textAlign: "right" }}>ROAS alvo</th>
                        <th style={{ textAlign: "right" }}>Investido</th>
                        <th style={{ textAlign: "right" }}>Vendas totais</th>
                        <th style={{ textAlign: "right" }}>Un</th>
                        <th style={{ textAlign: "right" }}>% via ads</th>
                        <th style={{ textAlign: "right" }}>TACOS</th>
                        <th style={{ textAlign: "right" }}>ROAS</th>
                        <th style={{ textAlign: "right" }} title="ROAS mínimo pra não perder dinheiro com o ad — abaixo dele, o gasto consome mais que o lucro que sobra antes do ads.">Break-even</th>
                        <th style={{ textAlign: "right" }}>Lucro</th>
                        <th style={{ textAlign: "right" }}>Margem</th>
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {linhasFiltradas.map(({ i, v, un, r, a, ctr, cpc, pctAds, breakEven, abaixoDoBreakEven }) => {
                      return (
                        <tr key={i.itemId}>
                          <td className="ads-name" style={{ textAlign: "left", fontWeight: 600, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={i.title || i.itemId}>
                            <span style={{ marginRight: 6 }}><StatusTag item={i} /></span>
                            {i.title || i.itemId}
                            <span style={{ display: "block", fontSize: ".66rem", color: "var(--muted)" }}>{i.itemId}</span>
                          </td>
                          <td data-label="Orç/dia" style={{ textAlign: "right", color: "var(--muted)", whiteSpace: "nowrap" }}>{i.dailyBudget > 0 ? fmtBRL(i.dailyBudget) : "—"}</td>
                          <td data-label="ROAS alvo" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{i.roasTarget > 0 ? `${num(i.roasTarget, 1)}x` : "—"}</td>
                          {pub && <>
                            <td data-label="Impressões" style={{ textAlign: "right", color: "var(--muted)", whiteSpace: "nowrap" }}>{num(i.prints)}</td>
                            <td data-label="Cliques" style={{ textAlign: "right", color: "var(--muted)", whiteSpace: "nowrap" }}>{num(i.clicks)}</td>
                            <td data-label="CTR" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{num(ctr, 2)}%</td>
                            <td data-label="CPC" style={{ textAlign: "right", color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtBRL(cpc)}</td>
                          </>}
                          <td data-label="Investido" style={{ textAlign: "right", color: "var(--red)", fontWeight: 600, whiteSpace: "nowrap" }}>{fmtBRL(i.cost)}</td>
                          <td data-label={pub ? "Vendas diretas" : "Vendas totais"} style={{ textAlign: "right", color: "var(--green)", whiteSpace: "nowrap" }}>{fmtBRL(v)}</td>
                          <td data-label="Unidades" style={{ textAlign: "right", color: "var(--muted)", whiteSpace: "nowrap" }}>{num(un)}</td>
                          {!pub && <td data-label="% via ads" style={{ textAlign: "right", color: "var(--muted)", whiteSpace: "nowrap" }}>{num(pctAds, 0)}%</td>}
                          <td data-label={pub ? "ACOS" : "TACOS"} style={{ textAlign: "right", color: corAcos(a, v > 0), fontWeight: 700, whiteSpace: "nowrap" }}>{v > 0 ? `${num(a, 1)}%` : "—"}</td>
                          <td data-label="ROAS" style={{ textAlign: "right", color: corRoas(r), fontWeight: 700, whiteSpace: "nowrap" }}>{i.cost > 0 ? `${num(r, 2)}x` : "—"}</td>
                          <td
                            data-label="Break-even"
                            style={{ textAlign: "right", whiteSpace: "nowrap", color: abaixoDoBreakEven ? "var(--red)" : "var(--muted)", fontWeight: abaixoDoBreakEven ? 700 : 400 }}
                            title={breakEven == null ? "Sem lucro antes do ads pra calcular — nenhum ROAS cobriria o custo do produto neste volume." : abaixoDoBreakEven ? "ROAS atual está abaixo do break-even — o ad está consumindo mais do que o lucro que sobraria sem ele." : undefined}
                          >
                            {breakEven != null ? `${num(breakEven, 2)}x` : "—"}
                            {abaixoDoBreakEven ? " ⚠" : ""}
                          </td>
                          {pub && !i.diretoDisponivel ? (
                            <>
                              <td data-label="Lucro" style={{ textAlign: "right", color: "var(--muted)", whiteSpace: "nowrap" }} title="Sem venda vinculada no período pra calcular a margem do lucro direto — não é prejuízo, é falta de dado.">—</td>
                              <td data-label="Margem" style={{ textAlign: "right", color: "var(--muted)", whiteSpace: "nowrap" }}>—</td>
                            </>
                          ) : (
                            <>
                              <td data-label="Lucro" style={{ textAlign: "right", color: (pub ? i.lucroDiretoLiquido : i.lucroLiquido) >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700, whiteSpace: "nowrap" }}>
                                {fmtBRL(pub ? i.lucroDiretoLiquido : i.lucroLiquido)}
                              </td>
                              <td data-label="Margem" style={{ textAlign: "right", color: v > 0 ? corMargem(((pub ? i.lucroDiretoLiquido : i.lucroLiquido) / v) * 100) : "var(--muted)", fontWeight: 700, whiteSpace: "nowrap" }}>
                                {v > 0 ? `${num(((pub ? i.lucroDiretoLiquido : i.lucroLiquido) / v) * 100, 1)}%` : "—"}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ marginTop: 10, fontSize: ".72rem", color: "var(--muted)", lineHeight: 1.6 }}>
              {pub
                ? <>Vendas diretas = compras logo após clicar no anúncio · ACOS/ROAS medem só o ad. <b>Lucro</b> com &quot;—&quot; =
                    sem venda vinculada no período pra calcular a margem — não conta como prejuízo na soma do topo.</>
                : "Vendas totais = tudo que o item vendeu (ads + orgânico) · TACOS = investido ÷ vendas totais (quanto menor, mais o ads se paga no geral)."}
              <div style={{ marginTop: 4 }}>
                <b>Orç/dia</b> e <b>ROAS alvo</b> vêm da configuração da campanha no ML.
              </div>
              <div style={{ marginTop: 4 }}>
                <b>Ativa</b>/<b>Pausada</b> é o status da CAMPANHA (não do anúncio no catálogo) — campanha pausada não gasta
                nem gira, mesmo com o anúncio ativo. <b>Sem campanha</b> = não achamos campanha ligada a este anúncio, ou a
                campanha dele não teve investimento neste período (campanhas zeradas no período são ignoradas de propósito).
                Passe o mouse na etiqueta pra ver o nome da campanha.
              </div>
              {items.length > 0 && items.every((i) => i.dailyBudget === 0 && i.roasTarget === 0) && (
                <div style={{ marginTop: 8, color: "#F4B942" }}>
                  <b>Orç/dia e ROAS alvo vieram vazios em todos os anúncios</b>
                  {campanhasEncontradas === 0 ? " — nenhuma campanha com investimento neste período foi encontrada" : ` (${campanhasEncontradas} campanha(s) com investimento encontrada(s), mas sem cruzar com os anúncios)`}.
                  Abra &quot;Diagnóstico de configuração&quot; abaixo — se nenhuma URL responder 200, é o endpoint que mudou, não o nome do campo.
                </div>
              )}
              {(cfgDiag.length > 0 || !!cfgAmostra) && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: "pointer", color: "var(--muted)" }}>Diagnóstico de configuração (orçamento/ROAS/alterado/campanha) — {campanhasEncontradas} campanha(s) com investimento neste período</summary>
                  {cfgDiag.length > 0 && (
                    <div className="table-wrapper" style={{ marginTop: 6, border: "1px solid var(--border)" }}>
                      <table className="tbl-modern tbl-cards">
                        <thead><tr><th style={{ textAlign: "left" }}>URL tentada</th><th style={{ textAlign: "right" }}>Status</th></tr></thead>
                        <tbody>
                          {cfgDiag.map((t, idx) => (
                            <tr key={`${t.url}-${idx}`}>
                              <td style={{ textAlign: "left", fontFamily: "monospace", fontSize: ".72rem", wordBreak: "break-all" }}>{t.url}</td>
                              <td data-label="Status" style={{ textAlign: "right", color: t.status === 200 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>{t.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {!!cfgAmostra?.campanhaOrfa && (
                    <div style={{ marginTop: 8, fontSize: ".7rem", color: "#F4B942" }}>
                      Campanha que faltava na lista, recuperada pelo id — compare com a campanha normal abaixo pra ver qual
                      campo (status, channel…) explica ela não vir na busca:
                      <pre style={{ marginTop: 4, whiteSpace: "pre-wrap", color: "var(--muted)", fontSize: ".7rem", maxHeight: 240, overflow: "auto" }}>
                        {JSON.stringify(cfgAmostra.campanhaOrfa, null, 2)}
                      </pre>
                    </div>
                  )}
                  {!!cfgAmostra && (
                    <pre style={{ marginTop: 6, whiteSpace: "pre-wrap", color: "var(--muted)", fontSize: ".7rem", maxHeight: 240, overflow: "auto" }}>
                      {JSON.stringify(cfgAmostra.campanha ?? cfgAmostra, null, 2)}
                    </pre>
                  )}
                </details>
              )}
              {campanhasResumo.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: "pointer", color: "var(--muted)" }}>
                    Todas as campanhas da conta ({campanhasTotal}{anunciosContagemFalhou ? "" : `, ${anunciosTotal} anúncio(s) cadastrado(s)`}) — conferir se nada sumiu da tabela
                  </summary>
                  {anunciosContagemFalhou ? (
                    <div style={{ marginTop: 6, fontSize: ".7rem", color: "#F4B942" }}>
                      Não conseguimos contar os anúncios cadastrados por campanha — nenhuma das URLs de listagem respondeu
                      com dados (veja os status &quot;[contagem]&quot; no diagnóstico acima). A coluna &quot;Anúncios cadastrados&quot;
                      abaixo está vazia de propósito, pra não mostrar 0 como se fosse um fato — o gasto por campanha continua
                      confiável, só a contagem total de anúncios que falhou.
                    </div>
                  ) : (
                    <div style={{ marginTop: 6, fontSize: ".7rem", color: "var(--muted)" }}>
                      A tabela acima só mostra anúncio com atividade (impressão/clique/gasto) neste período — é o próprio
                      Mercado Ads que já filtra por data nesse recurso. Neste período, <b>{anunciosNoPeriodo}</b> anúncio(s) tiveram
                      atividade (de {anunciosTotal} cadastrados no total); os outros ficaram fora porque estiveram 100% zerados o
                      tempo todo, não porque foram escondidos por um filtro nosso.
                    </div>
                  )}
                  <div className="table-wrapper" style={{ marginTop: 6, border: "1px solid var(--border)" }}>
                    <table className="tbl-modern tbl-cards">
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left" }}>Campanha</th>
                          <th style={{ textAlign: "left" }}>Status ML</th>
                          <th style={{ textAlign: "right" }}>Anúncios cadastrados</th>
                          <th style={{ textAlign: "right" }}>Gasto no período</th>
                        </tr>
                      </thead>
                      <tbody>
                        {campanhasResumo.map((c) => (
                          <tr key={c.id}>
                            <td style={{ textAlign: "left", fontWeight: 600 }} title={c.id}>{c.name}</td>
                            <td data-label="Status ML" style={{ textAlign: "left", color: "var(--muted)" }}>{c.status || "—"}</td>
                            <td data-label="Anúncios cadastrados" style={{ textAlign: "right", color: "var(--muted)" }}>{anunciosContagemFalhou ? "—" : c.totalAds}</td>
                            <td data-label="Gasto no período" style={{ textAlign: "right", color: c.gasto > 0 ? "var(--green)" : "var(--muted)", fontWeight: c.gasto > 0 ? 700 : 400 }}>
                              {c.gasto > 0 ? fmtBRL(c.gasto) : "sem gasto no período"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {(gastoOrfao > 0 || gastoSemVinculo > 0) && (
                    <div style={{ marginTop: 6, fontSize: ".7rem", color: "#F4B942" }}>
                      <b>{fmtBRL(gastoOrfao + gastoSemVinculo)} de investimento não caiu em nenhuma campanha desta lista</b> —
                      por isso a soma da coluna &quot;Gasto no período&quot; fica menor que o Investimento do topo ({fmtBRL(t.cost)}).
                      {gastoOrfao > 0 && <> {fmtBRL(gastoOrfao)} são de anúncios que declaram uma campanha que o ML não devolveu
                        na lista{campanhasOrfas.length > 0 ? ` (id ${campanhasOrfas.join(", ")})` : ""} — provavelmente campanha de
                        outro anunciante da mesma conta.</>}
                      {gastoSemVinculo > 0 && <> {fmtBRL(gastoSemVinculo)} são de anúncios sem nenhuma campanha resolvida.</>}
                    </div>
                  )}
                  <div style={{ marginTop: 6, fontSize: ".7rem" }}>
                    Campanhas com &quot;sem gasto no período&quot; não aparecem na tabela principal (poluição visual), mas estão
                    listadas aqui pra você confirmar que existem e foram encontradas — se faltar alguma campanha real desta lista,
                    é a busca de campanhas do ML que não retornou, não um filtro nosso escondendo ela.
                  </div>
                </details>
              )}
            </div>
          </div>
        </>
      )}
      </>
      )}
    </div>
  );
}
