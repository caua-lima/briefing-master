"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtBRL } from "@/lib/domain/calc";
import { authedFetch } from "@/lib/api/authed-fetch";
import DateRangePicker from "@/components/dashboard/DateRangePicker";

// Status da CAMPANHA (não do anúncio no catálogo) — é o que decide se o
// investimento está de fato rodando agora.
type StatusAnuncio = "ativo" | "pausado" | "sem_campanha";

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
  dailyBudget: number; roasTarget: number; acosTarget: number; lastUpdated: string;
};

const STATUS_META: Record<StatusAnuncio, { label: string; cor: string; bg: string }> = {
  ativo: { label: "Ativa", cor: "var(--green)", bg: "rgba(34,197,94,.12)" },
  pausado: { label: "Pausada", cor: "#f7c948", bg: "rgba(247,201,72,.12)" },
  sem_campanha: { label: "Sem campanha", cor: "var(--muted)", bg: "rgba(100,116,139,.14)" },
};

function StatusTag({ item }: { item: AdItem }) {
  const m = STATUS_META[item.status];
  const tooltip = item.campaignId
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

/**
 * Dias completos desde a última alteração do anúncio. A regra do vendedor: só
 * mexer de novo depois de 3 dias completos performando — antes disso o ML ainda
 * está reaprendendo e o número não é confiável.
 */
function alteracaoInfo(iso: string): { txt: string; dias: number | null; podeAlterar: boolean } {
  if (!iso) return { txt: "—", dias: null, podeAlterar: true };
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return { txt: "—", dias: null, podeAlterar: true };
  const dias = Math.floor((Date.now() - t) / 86400000);
  return { txt: dias <= 0 ? "hoje" : `há ${dias}d`, dias, podeAlterar: dias >= 3 };
}

type Modo = "pub" | "geral";

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

export default function AdsTab() {
  const [range, setRange] = useState(() => mesAteHoje());
  const [modo, setModo] = useState<Modo>("pub");
  const [items, setItems] = useState<AdItem[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [cfgAmostra, setCfgAmostra] = useState<unknown>(null);
  const [campanhasEncontradas, setCampanhasEncontradas] = useState(0);
  const [semGastoNoPeriodo, setSemGastoNoPeriodo] = useState(0);

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
    { lbl: "Vendas totais", val: fmtBRL(t.total), tone: "pos", sub: `${num(t.totalUn)} un (todos os canais)` },
    { lbl: "ROAS geral", val: `${num(roas, 2)}x`, tone: "acc", sub: "vendas totais ÷ investido", cor: corRoas(roas) },
    { lbl: "TACOS", val: `${num(acos, 1)}%`, tone: "warn", sub: "investido ÷ vendas totais", cor: corAcos(acos, t.total > 0) },
    { lbl: "Vendas via ads", val: `${num(pctViaAds, 0)}%`, tone: "acc", sub: `${fmtBRL(t.adSales)} vieram do ad` },
    { lbl: "Orgânico", val: `${num(100 - pctViaAds, 0)}%`, tone: "pos", sub: "vendas sem tráfego pago" },
    { lbl: "Lucro após ads (geral)", val: fmtBRL(t.lucroLiq), tone: t.lucroLiq >= 0 ? "pos" : "neg", sub: `direto: ${fmtBRL(t.lucroLiqDireto)}`, cor: t.lucroLiq >= 0 ? "var(--green)" : "var(--red)" },
  ];

  return (
    <div className="dash">
      <div className="dash-top">
        <div className="dash-top-left">
          <h2 style={{ fontSize: "1.15rem", fontWeight: 800 }}>Ads</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={load} disabled={loading}>
            {loading ? "..." : "⟳ Atualizar"}
          </button>
        </div>
        <DateRangePicker from={range.from} to={range.to} onApply={(from, to) => setRange({ from, to })} />
      </div>

      {/* Toggle de análise */}
      <div className="seg" style={{ alignSelf: "flex-start" }}>
        <button type="button" className={`seg-btn ${pub ? "active" : ""}`} onClick={() => setModo("pub")}>Publicidade (ads direto)</button>
        <button type="button" className={`seg-btn ${!pub ? "active" : ""}`} onClick={() => setModo("geral")}>Geral (todas as vendas)</button>
      </div>
      <div style={{ fontSize: ".78rem", color: "var(--muted)", marginTop: -6 }}>
        {pub
          ? "Só o que saiu direto do anúncio — mede a eficiência do ad em si."
          : "Quanto você gastou de ads vs TUDO que vendeu (inclui vendas sem tráfego pago) — o impacto real no faturamento."}
      </div>

      {erro ? (
        <div style={{ padding: "12px 14px", background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 8, fontSize: ".8rem", color: "var(--red)" }}>
          {(() => {
            const adv = diag?.advertisersStatus;
            const it = diag?.itemsStatus;
            if (adv === 401 || adv === 403) return (<>O token do Mercado Livre <b>não tem permissão de Publicidade / Mercado Ads</b>. Reconecte a conta concedendo esse acesso.</>);
            if (it === 404) return (<>O Mercado Ads recusou a busca dos anúncios (404) em <b>{range.from.split("-").reverse().join("/")} a {range.to.split("-").reverse().join("/")}</b>. Conta e permissão estão OK ({diag?.conta?.tokenNickname ?? "—"}, anunciante {String(diag?.advertiserId ?? "—")}). Abaixo, o que cada recurso do ML respondeu:</>);
            return (<>Não consegui puxar os Ads agora. O token está autorizado (anunciante {String(diag?.advertisersStatus ?? "—")}), então deve ser instabilidade do Mercado Ads — tente <b>Atualizar</b> em instantes.</>);
          })()}

          {/* Sonda por recurso — o dado que importa, visível sem rolar JSON */}
          {diag?.tentativas?.length ? (
            <div className="table-wrapper" style={{ marginTop: 10, border: "1px solid rgba(239,68,68,.25)" }}>
              <table className="tbl-modern">
                <thead><tr>
                  <th style={{ textAlign: "left" }}>Recurso do ML</th>
                  <th>Status</th>
                  <th style={{ textAlign: "left" }}>Resposta do ML</th>
                </tr></thead>
                <tbody>
                  {diag.tentativas.map((t) => (
                    <tr key={t.tentativa}>
                      <td style={{ textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }}>{t.tentativa}</td>
                      <td style={{ fontWeight: 800, color: t.status && t.status < 300 ? "var(--green)" : "var(--red)" }}>{t.status ?? "erro"}</td>
                      <td style={{ textAlign: "left", fontFamily: "monospace", fontSize: ".66rem", color: "var(--muted)", wordBreak: "break-all" }}>{t.body || t.erro || "—"}</td>
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

          <div className="panel">
            <div className="panel-head" style={{ marginBottom: 8 }}>
              <span className="panel-title">Por anúncio — {pub ? "publicidade" : "geral"}</span>
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
                  <span style={{ display: "flex", gap: 6 }}>
                    {(["ativo", "pausado", "sem_campanha"] as const).map((s) => {
                      const n = items.filter((i) => i.status === s).length;
                      if (!n) return null;
                      const m = STATUS_META[s];
                      return (
                        <span key={s} style={{ fontSize: ".68rem", fontWeight: 700, color: m.cor, background: m.bg, padding: "1px 7px", borderRadius: 5 }}>
                          {n} {m.label.toLowerCase()}
                        </span>
                      );
                    })}
                  </span>
                )}
              </span>
            </div>
            {loading ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Carregando…</div>
            ) : items.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Sem dados de Ads no período.</div>
            ) : (
              <div className="table-wrapper" style={{ border: "none" }}>
                <table className="tbl-modern">
                  <thead>
                    {pub ? (
                      <tr>
                        <th style={{ textAlign: "left" }}>Anúncio</th>
                        <th style={{ textAlign: "right" }}>Orç/dia</th>
                        <th style={{ textAlign: "right" }}>ROAS alvo</th>
                        <th style={{ textAlign: "right" }}>Alterado</th>
                        <th style={{ textAlign: "right" }}>Impr.</th>
                        <th style={{ textAlign: "right" }}>Cliques</th>
                        <th style={{ textAlign: "right" }}>CTR</th>
                        <th style={{ textAlign: "right" }}>CPC</th>
                        <th style={{ textAlign: "right" }}>Investido</th>
                        <th style={{ textAlign: "right" }}>Vendas diretas</th>
                        <th style={{ textAlign: "right" }}>Un</th>
                        <th style={{ textAlign: "right" }}>ACOS</th>
                        <th style={{ textAlign: "right" }}>ROAS</th>
                        <th style={{ textAlign: "right" }}>Lucro</th>
                      </tr>
                    ) : (
                      <tr>
                        <th style={{ textAlign: "left" }}>Anúncio</th>
                        <th style={{ textAlign: "right" }}>Orç/dia</th>
                        <th style={{ textAlign: "right" }}>ROAS alvo</th>
                        <th style={{ textAlign: "right" }}>Alterado</th>
                        <th style={{ textAlign: "right" }}>Investido</th>
                        <th style={{ textAlign: "right" }}>Vendas totais</th>
                        <th style={{ textAlign: "right" }}>Un</th>
                        <th style={{ textAlign: "right" }}>% via ads</th>
                        <th style={{ textAlign: "right" }}>TACOS</th>
                        <th style={{ textAlign: "right" }}>ROAS</th>
                        <th style={{ textAlign: "right" }}>Lucro</th>
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {items.map((i) => {
                      const v = pub ? i.directSales : i.totalSales;
                      const un = pub ? i.directUnits : i.totalUnits;
                      const r = i.cost > 0 ? v / i.cost : 0;
                      const a = v > 0 ? (i.cost / v) * 100 : 0;
                      const ctr = i.prints > 0 ? (i.clicks / i.prints) * 100 : 0;
                      const cpc = i.clicks > 0 ? i.cost / i.clicks : 0;
                      const pctAds = i.totalSales > 0 ? (i.adSales / i.totalSales) * 100 : 0;
                      return (
                        <tr key={i.itemId}>
                          <td style={{ textAlign: "left", fontWeight: 600, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={i.title || i.itemId}>
                            <span style={{ marginRight: 6 }}><StatusTag item={i} /></span>
                            {i.title || i.itemId}
                            <span style={{ display: "block", fontSize: ".66rem", color: "var(--muted)" }}>{i.itemId}</span>
                          </td>
                          <td style={{ textAlign: "right", color: "var(--muted)", whiteSpace: "nowrap" }}>{i.dailyBudget > 0 ? fmtBRL(i.dailyBudget) : "—"}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{i.roasTarget > 0 ? `${num(i.roasTarget, 1)}x` : "—"}</td>
                          {(() => {
                            const alt = alteracaoInfo(i.lastUpdated);
                            const cor = alt.dias == null ? "var(--muted)" : alt.podeAlterar ? "var(--green)" : "#f7c948";
                            return (
                              <td style={{ textAlign: "right", whiteSpace: "nowrap", color: cor, fontWeight: alt.dias != null && !alt.podeAlterar ? 700 : 400 }}
                                title={alt.dias == null ? "Data de alteração não informada pelo ML" : alt.podeAlterar ? "Já passou dos 3 dias — pode ajustar" : `Aguarde: só ${alt.dias} dia(s) desde a última alteração (espere 3 completos)`}>
                                {alt.txt}{alt.dias != null && !alt.podeAlterar ? " ⏳" : ""}
                              </td>
                            );
                          })()}
                          {pub && <>
                            <td style={{ textAlign: "right", color: "var(--muted)", whiteSpace: "nowrap" }}>{num(i.prints)}</td>
                            <td style={{ textAlign: "right", color: "var(--muted)", whiteSpace: "nowrap" }}>{num(i.clicks)}</td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{num(ctr, 2)}%</td>
                            <td style={{ textAlign: "right", color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtBRL(cpc)}</td>
                          </>}
                          <td style={{ textAlign: "right", color: "var(--red)", fontWeight: 600, whiteSpace: "nowrap" }}>{fmtBRL(i.cost)}</td>
                          <td style={{ textAlign: "right", color: "var(--green)", whiteSpace: "nowrap" }}>{fmtBRL(v)}</td>
                          <td style={{ textAlign: "right", color: "var(--muted)", whiteSpace: "nowrap" }}>{num(un)}</td>
                          {!pub && <td style={{ textAlign: "right", color: "var(--muted)", whiteSpace: "nowrap" }}>{num(pctAds, 0)}%</td>}
                          <td style={{ textAlign: "right", color: corAcos(a, v > 0), fontWeight: 700, whiteSpace: "nowrap" }}>{v > 0 ? `${num(a, 1)}%` : "—"}</td>
                          <td style={{ textAlign: "right", color: corRoas(r), fontWeight: 700, whiteSpace: "nowrap" }}>{i.cost > 0 ? `${num(r, 2)}x` : "—"}</td>
                          {pub && !i.diretoDisponivel ? (
                            <td style={{ textAlign: "right", color: "var(--muted)", whiteSpace: "nowrap" }} title="Sem venda vinculada no período pra calcular a margem do lucro direto — não é prejuízo, é falta de dado.">—</td>
                          ) : (
                            <td style={{ textAlign: "right", color: (pub ? i.lucroDiretoLiquido : i.lucroLiquido) >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700, whiteSpace: "nowrap" }}>
                              {fmtBRL(pub ? i.lucroDiretoLiquido : i.lucroLiquido)}
                            </td>
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
                <b>Alterado</b> = quando a campanha foi mexida pela última vez. <span style={{ color: "#f7c948" }}>⏳</span> = menos de 3 dias,
                espere completar 3 dias performando antes de ajustar de novo. <b>Orç/dia</b> e <b>ROAS alvo</b> vêm da configuração da campanha no ML.
              </div>
              <div style={{ marginTop: 4 }}>
                <b>Ativa</b>/<b>Pausada</b> é o status da CAMPANHA (não do anúncio no catálogo) — campanha pausada não gasta
                nem gira, mesmo com o anúncio ativo. <b>Sem campanha</b> = não achamos campanha ligada a este anúncio, ou a
                campanha dele não teve investimento neste período (campanhas zeradas no período são ignoradas de propósito).
                Passe o mouse na etiqueta pra ver o nome da campanha.
              </div>
              {items.length > 0 && items.every((i) => i.dailyBudget === 0 && i.roasTarget === 0 && !i.lastUpdated) && (
                <div style={{ marginTop: 8, color: "#f7c948" }}>
                  <b>Orç/dia, ROAS alvo e Alterado vieram vazios em todos os anúncios</b>
                  {campanhasEncontradas === 0 ? " — nenhuma campanha com investimento neste período foi encontrada" : ` (${campanhasEncontradas} campanha(s) com investimento encontrada(s), mas sem cruzar com os anúncios)`}.
                  Abra &quot;Diagnóstico de configuração&quot; abaixo — se nenhuma URL responder 200, é o endpoint que mudou, não o nome do campo.
                </div>
              )}
              {(cfgDiag.length > 0 || !!cfgAmostra) && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: "pointer", color: "var(--muted)" }}>Diagnóstico de configuração (orçamento/ROAS/alterado/campanha) — {campanhasEncontradas} campanha(s) com investimento neste período</summary>
                  {cfgDiag.length > 0 && (
                    <div className="table-wrapper" style={{ marginTop: 6, border: "1px solid var(--border)" }}>
                      <table className="tbl-modern">
                        <thead><tr><th style={{ textAlign: "left" }}>URL tentada</th><th style={{ textAlign: "right" }}>Status</th></tr></thead>
                        <tbody>
                          {cfgDiag.map((t, idx) => (
                            <tr key={`${t.url}-${idx}`}>
                              <td style={{ textAlign: "left", fontFamily: "monospace", fontSize: ".72rem" }}>{t.url}</td>
                              <td style={{ textAlign: "right", color: t.status === 200 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>{t.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {!!cfgAmostra && (
                    <pre style={{ marginTop: 6, whiteSpace: "pre-wrap", color: "var(--muted)", fontSize: ".7rem", maxHeight: 240, overflow: "auto" }}>
                      {JSON.stringify(cfgAmostra, null, 2)}
                    </pre>
                  )}
                </details>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
