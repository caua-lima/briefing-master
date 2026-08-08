"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtBRL, isFullMonth, prevPeriod, todayStr } from "@/lib/domain/calc";
import { authedFetch } from "@/lib/api/authed-fetch";
import DateRangePicker from "@/components/dashboard/DateRangePicker";
import { Delta } from "@/components/dashboard/ExecutiveKpis";

type CustoDre = { nome: string; valor: number; freq: string };

type Metrics = {
  faturamentoBruto: number;
  faturamentoLiquido: number;
  vendasCanceladas: number;
  vendasDevolvidas: number;
  totalRetorno: number;
  totalCMV: number;
  totalAds: number;
  totalEnvio: number;
  totalImposto: number;
  totalTaxasML: number;
  custosOperacionais: number;
  custosDre: number;
  custosDreDetalhe: CustoDre[];
  lucroComCustos: number;
  adsFalhou?: boolean;
  ordersCount: number;
};

function monthRange() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return { from: `${d.getFullYear()}-${mm}-01`, to: `${d.getFullYear()}-${mm}-${String(last).padStart(2, "0")}` };
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const num = (n: number, d = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

/** "julho de 2026" quando o período é um mês inteiro; senão "01/07 – 22/07". */
function fmtPeriodo(from: string, to: string): string {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const ultimoDia = new Date(fy, fm, 0).getDate();
  if (fy === ty && fm === tm && fd === 1 && td === ultimoDia) {
    return `${MESES[fm - 1]} de ${fy}`;
  }
  const br = (s: string) => s.slice(8, 10) + "/" + s.slice(5, 7);
  return `${br(from)} – ${br(to)}`;
}

type LinhaProps = {
  rotulo: string;
  valor: number;
  nota?: string;
  /** deducao = sai do resultado; subtotal = fechamento; resultado = linha final */
  tipo?: "deducao" | "subtotal" | "resultado";
  base?: number;
  /** Explica o que compõe este subtotal/resultado — mesmo padrão ⓘ + hover usado nos KPIs do Dashboard (ExecutiveKpis/PerformanceGauge). */
  tooltip?: string;
};

function Linha({ rotulo, valor, nota, tipo, base, tooltip }: LinhaProps) {
  const ehResultado = tipo === "resultado";
  const ehSub = tipo === "subtotal" || ehResultado;
  const ehDed = tipo === "deducao";
  const cor = ehResultado
    ? (valor >= 0 ? "var(--green)" : "var(--red)")
    : ehDed ? "var(--red)" : "var(--text)";
  // % sobre a receita: é o que torna a DRE comparável entre meses de tamanhos
  // diferentes — R$ 3 mil de taxa significa coisas distintas em 20k e em 60k.
  const pct = base && base !== 0 ? (valor / base) * 100 : null;
  const larguraBarra = pct === null ? 0 : Math.min(Math.abs(pct), 100);

  return (
    <div
      className={`dre-line${ehSub ? "" : " is-nested"}`}
      style={{
        padding: ehSub ? "11px 12px" : "7px 12px 7px 26px",
        marginTop: ehSub ? 4 : 0,
        background: ehResultado
          ? (valor >= 0 ? "rgba(54,179,126,.1)" : "rgba(214,90,74,.1)")
          : tipo === "subtotal" ? "var(--surface2)" : undefined,
        border: ehResultado
          ? `1px solid ${valor >= 0 ? "rgba(54,179,126,.4)" : "rgba(214,90,74,.4)"}`
          : undefined,
      }}
    >
      <div className="dre-lbl" style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
        {ehDed && <span style={{ color: "var(--muted)", fontSize: ".8rem", flexShrink: 0 }}>−</span>}
        <div style={{ minWidth: 0 }}>
          <span style={{
            fontSize: ehSub ? ".9rem" : ".84rem",
            fontWeight: ehResultado ? 800 : ehSub ? 700 : 500,
            color: ehSub ? "var(--text)" : "var(--muted)",
            textTransform: ehResultado ? "uppercase" : undefined,
            letterSpacing: ehResultado ? ".04em" : undefined,
          }}>
            {rotulo}
          </span>
          {tooltip && (
            <span className="pg-info" tabIndex={0} style={{ marginLeft: 5 }}>
              ⓘ
              <span role="tooltip" className="pg-tooltip">{tooltip}</span>
            </span>
          )}
          {nota && <div style={{ fontSize: ".7rem", color: "var(--muted)", marginTop: 1 }}>{nota}</div>}
        </div>
      </div>

      <span className="dre-val" style={{
        fontSize: ehResultado ? "1.05rem" : ehSub ? ".95rem" : ".86rem",
        fontWeight: ehSub ? 800 : 600,
        whiteSpace: "nowrap", color: cor, fontVariantNumeric: "tabular-nums",
      }}>
        {ehDed ? "−" : ""}{fmtBRL(Math.abs(valor))}
      </span>

      {/* % sobre a receita, com mini-barra para leitura rápida */}
      <div className="dre-pct" style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <span style={{
          fontSize: ".72rem", color: ehSub ? "var(--text)" : "var(--muted)",
          whiteSpace: "nowrap", textAlign: "right", fontVariantNumeric: "tabular-nums",
          fontWeight: ehSub ? 700 : 400,
        }}>
          {pct === null ? "" : `${pct.toFixed(1)}%`}
        </span>
        {pct !== null && !ehResultado && (
          <div style={{ height: 3, borderRadius: 2, background: "var(--border)", overflow: "hidden", minWidth: 54 }}>
            <div style={{
              width: `${larguraBarra}%`, height: "100%", borderRadius: 2,
              background: ehDed ? "var(--red)" : "var(--green)", opacity: ehDed ? .55 : .7,
            }} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Cabeçalho de grupo dentro do demonstrativo, para separar os blocos. */
function GrupoDre({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: ".68rem", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase",
      color: "var(--muted)", padding: "16px 12px 4px",
    }}>
      {children}
    </div>
  );
}

export default function DreTab() {
  const [range, setRange] = useState(() => monthRange());
  const [m, setM] = useState<Metrics | null>(null);
  const [mPrev, setMPrev] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authedFetch(`/api/ml/metrics?from=${range.from}&to=${range.to}`, { cache: "no-store" });
      setM(r.ok ? await r.json() : null);
    } catch {
      setM(null);
    } finally {
      setLoading(false);
    }
    // Período anterior equivalente — mesma lógica do Dashboard (mês cheio vs
    // mês anterior; mês em andamento vs mesmo dia do mês anterior). Falha
    // silenciosa: comparação é um extra, não pode travar a DRE em si.
    try {
      const prev = prevPeriod(range.from, range.to);
      const rp = await authedFetch(`/api/ml/metrics?from=${prev.from}&to=${prev.to}`, { cache: "no-store" });
      setMPrev(rp.ok ? await rp.json() : null);
    } catch {
      setMPrev(null);
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const prevLabel = !isFullMonth(range.from, range.to)
    ? "vs período anterior"
    : range.to > todayStr() ? "vs mesmo dia do mês anterior" : "vs mês anterior";

  if (loading) {
    return <div className="dash"><div className="panel" style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Carregando DRE…</div></div>;
  }
  if (!m) {
    return <div className="dash"><div className="panel" style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Não consegui carregar os dados do período.</div></div>;
  }

  // Cópia com tipo já estreitado pra "não-nulo" — funções aninhadas abaixo
  // (exportarCsv) não herdam a checagem `if (!m) return` acima, então usam
  // esta constante em vez de `m` direto.
  const metrics = m;
  const receitaBruta = metrics.faturamentoBruto;
  const canceladas = m.vendasCanceladas + m.vendasDevolvidas;
  const receitaLiquida = m.faturamentoLiquido;
  const receitaOperacional = m.totalRetorno; // já é líquida de taxa e frete
  const lucroBruto = receitaOperacional - m.totalCMV;
  const resultadoOperacional = m.lucroComCustos; // o mesmo do Dashboard
  const resultadoLiquido = resultadoOperacional - m.custosDre;

  const base = receitaLiquida;
  const margem = (v: number) => (base ? (v / base) * 100 : 0);

  const receitaLiquidaPrev = mPrev?.faturamentoLiquido ?? null;
  const lucroBrutoPrev = mPrev ? mPrev.totalRetorno - mPrev.totalCMV : null;
  const resultadoOperacionalPrev = mPrev?.lucroComCustos ?? null;
  const resultadoLiquidoPrev = mPrev ? mPrev.lucroComCustos - mPrev.custosDre : null;

  function exportarCsv() {
    const linhas: { rotulo: string; valor: number; ded?: boolean }[] = [
      { rotulo: "Receita bruta de vendas", valor: receitaBruta },
      { rotulo: "Cancelamentos e devoluções", valor: canceladas, ded: true },
      { rotulo: "Receita líquida", valor: receitaLiquida },
      { rotulo: "Taxas do Mercado Livre", valor: metrics.totalTaxasML, ded: true },
      { rotulo: "Frete", valor: metrics.totalEnvio, ded: true },
      { rotulo: "Receita operacional líquida", valor: receitaOperacional },
      { rotulo: "Custo da mercadoria vendida", valor: metrics.totalCMV, ded: true },
      { rotulo: "Lucro bruto", valor: lucroBruto },
      { rotulo: "Impostos sobre vendas", valor: metrics.totalImposto, ded: true },
      { rotulo: "Marketing (ADS)", valor: metrics.totalAds, ded: true },
      { rotulo: "Despesas operacionais", valor: metrics.custosOperacionais, ded: true },
      { rotulo: "Resultado operacional", valor: resultadoOperacional },
      ...metrics.custosDreDetalhe.map((c) => ({ rotulo: `Despesa da empresa: ${c.nome}`, valor: c.valor, ded: true })),
      { rotulo: "Resultado líquido", valor: resultadoLiquido },
    ];
    const header = ["Linha", "Valor (R$)", "% receita líquida"];
    const linhasCsv = linhas.map((l) => [l.rotulo, `${l.ded ? "-" : ""}${num(l.valor)}`, num(margem(l.valor), 1)]);
    const csv = [header, ...linhasCsv]
      .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))
      .join("\r\n");
    const blob = new Blob([String.fromCharCode(0xfeff) + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dre-${range.from}_a_${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="dash">
      <div className="tab-head">
        <div className="tab-head-left">
          <h2 className="tab-title">DRE</h2>
          <span className="tab-head-sub" style={{ textTransform: "capitalize" }}>
            {fmtPeriodo(range.from, range.to)} · {m.ordersCount} pedido(s)
          </span>
        </div>
        <DateRangePicker from={range.from} to={range.to} onApply={(from, to) => setRange({ from, to })} />
      </div>

      {m.adsFalhou && (
        <div className="note note-warn">
          O gasto com ADS não veio do Mercado Livre neste período. O resultado abaixo está
          <b> otimista</b> — falta descontar a verba de anúncios.
        </div>
      )}

      <div className="kpi-grid">
        <div className="kpi k-acc">
          <div className="k-lbl">Receita líquida</div>
          <div className="k-val">{fmtBRL(receitaLiquida)}</div>
          <div className="k-sub">sem cancelados e devolvidos</div>
          <Delta current={receitaLiquida} previous={receitaLiquidaPrev} mode="pct" label={prevLabel} />
        </div>
        <div className="kpi k-pos">
          <div className="k-lbl">Lucro bruto</div>
          <div className="k-val" style={{ color: "var(--green)" }}>{fmtBRL(lucroBruto)}</div>
          <div className="k-sub">margem de {margem(lucroBruto).toFixed(1)}%</div>
          <Delta current={lucroBruto} previous={lucroBrutoPrev} mode="pct" label={prevLabel} />
        </div>
        <div className="kpi k-warn">
          <div className="k-lbl">Resultado operacional</div>
          <div className="k-val" style={{ color: resultadoOperacional >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(resultadoOperacional)}</div>
          <div className="k-sub">é o lucro do Dashboard</div>
          <Delta current={resultadoOperacional} previous={resultadoOperacionalPrev} mode="pct" label={prevLabel} />
        </div>
        <div className="kpi k-neg">
          <div className="k-lbl">Resultado líquido</div>
          <div className="k-val" style={{ color: resultadoLiquido >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(resultadoLiquido)}</div>
          <div className="k-sub">margem de {margem(resultadoLiquido).toFixed(1)}%</div>
          <Delta current={resultadoLiquido} previous={resultadoLiquidoPrev} mode="pct" label={prevLabel} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head" style={{ marginBottom: 2 }}>
          <span className="panel-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            Demonstrativo de resultado
            <button type="button" className="btn btn-xs btn-ghost" onClick={exportarCsv} title="Exporta todas as linhas do demonstrativo em CSV">
              ⬇ Exportar CSV
            </button>
          </span>
          <span className="panel-sub">{fmtPeriodo(range.from, range.to)}</span>
        </div>

        {/* Cabeçalho das colunas de valor (no celular some: cada linha já se explica) */}
        <div className="dre-head">
          <span />
          <span style={{ textAlign: "right" }}>Valor</span>
          <span style={{ textAlign: "right" }}>% receita</span>
        </div>

        <GrupoDre>Receita</GrupoDre>
        <Linha rotulo="Receita bruta de vendas" valor={receitaBruta} nota="tudo que entrou, inclusive o que caiu depois" />
        <Linha rotulo="Cancelamentos e devoluções" valor={canceladas} tipo="deducao" base={base} />
        <Linha
          rotulo="Receita líquida"
          valor={receitaLiquida}
          tipo="subtotal"
          tooltip="Receita bruta de vendas menos cancelamentos e devoluções concluídas no período."
        />

        <GrupoDre>Custos de venda no Mercado Livre</GrupoDre>
        <Linha rotulo="Taxas do Mercado Livre" valor={m.totalTaxasML} tipo="deducao" base={base} />
        <Linha rotulo="Frete" valor={m.totalEnvio} tipo="deducao" base={base} />
        <Linha
          rotulo="Receita operacional líquida"
          valor={receitaOperacional}
          tipo="subtotal"
          nota="o que o ML de fato te repassa"
          tooltip="Receita líquida menos taxas do Mercado Livre e frete — é o valor que efetivamente cai na conta, antes de descontar o custo da mercadoria."
        />

        <GrupoDre>Mercadoria</GrupoDre>
        <Linha rotulo="Custo da mercadoria vendida" valor={m.totalCMV} tipo="deducao" base={base} nota="custo médio × unidades vendidas" />
        <Linha
          rotulo="Lucro bruto"
          valor={lucroBruto}
          tipo="subtotal"
          tooltip="Receita operacional líquida menos o custo da mercadoria vendida (custo médio × unidades). Ainda não descontou imposto, ADS nem despesas operacionais."
        />

        <GrupoDre>Impostos e despesas operacionais</GrupoDre>
        <Linha rotulo="Impostos sobre vendas" valor={m.totalImposto} tipo="deducao" base={base} />
        <Linha rotulo="Marketing (ADS)" valor={m.totalAds} tipo="deducao" base={base} />
        <Linha rotulo="Despesas operacionais" valor={m.custosOperacionais} tipo="deducao" base={base} nota="custos da aba Custos que descontam no Dashboard" />
        <Linha
          rotulo="Resultado operacional"
          valor={resultadoOperacional}
          tipo="subtotal"
          nota="daqui pra cima é exatamente o lucro líquido do Dashboard"
          tooltip="Lucro bruto menos impostos sobre vendas, ADS e despesas operacionais (as da aba Custos com escopo 'Dash'). Não inclui pró-labore, contador nem retirada — essas só entram no Resultado líquido, abaixo."
        />

        <GrupoDre>Despesas da empresa</GrupoDre>
        <Linha rotulo="Pró-labore, contador, retirada" valor={m.custosDre} tipo="deducao" base={base} nota="só aparecem aqui, fora do lucro do Dashboard" />
        <div style={{ marginTop: 10 }}>
          <Linha
            rotulo="Resultado líquido"
            valor={resultadoLiquido}
            tipo="resultado"
            base={base}
            tooltip="Resultado operacional menos as despesas da empresa marcadas 'Só na DRE' (pró-labore, contador, retirada). É o número final de tudo que saiu, inclusive o que o Dashboard não desconta."
          />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head" style={{ marginBottom: 8 }}>
          <span className="panel-title">Despesas da empresa no período</span>
          <span className="panel-sub">cadastre na aba Custos marcando <b>Só na DRE</b></span>
        </div>
        {m.custosDreDetalhe.length === 0 ? (
          <div style={{ fontSize: ".82rem", color: "var(--muted)", lineHeight: 1.6 }}>
            Nenhuma despesa marcada como <b>Só na DRE</b> neste período. Vá em <b>Custos</b>,
            cadastre o custo e escolha <b>Só na DRE</b> — ele entra aqui sem mexer no lucro
            que aparece no Dashboard.
            <div style={{ marginTop: 6, fontSize: ".78rem" }}>
              Lembre que custo <b>mensal</b> só entra quando o período é um mês inteiro.
            </div>
          </div>
        ) : (
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="tbl-modern tbl-cards">
              <thead><tr>
                <th style={{ textAlign: "left" }}>Despesa</th>
                <th style={{ textAlign: "left" }}>Frequência</th>
                <th style={{ textAlign: "right" }}>No período</th>
                <th style={{ textAlign: "right" }}>% da receita</th>
              </tr></thead>
              <tbody>
                {m.custosDreDetalhe.map((c, i) => (
                  <tr key={`${c.nome}-${i}`}>
                    <td style={{ textAlign: "left", fontWeight: 600 }}>{c.nome}</td>
                    <td data-label="Frequência" style={{ textAlign: "left", color: "var(--muted)", fontSize: ".8rem" }}>{c.freq}</td>
                    <td data-label="No período" style={{ textAlign: "right", color: "var(--red)", whiteSpace: "nowrap" }}>−{fmtBRL(c.valor)}</td>
                    <td data-label="% da receita" style={{ textAlign: "right", color: "var(--muted)" }}>{margem(c.valor).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
