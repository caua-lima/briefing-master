"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import type { Goals } from "@/lib/domain/types";
import {
  fmtBRL,
  formatMesBR,
  formatDateBR,
  mesAtual,
  diaAtualNoMes,
  diasNoMes,
  clamp,
} from "@/lib/domain/calc";
import type { UserData } from "@/components/useUserData";
import ExpensesDoughnut from "./ExpensesDoughnut";
import MetasGauge from "./MetasGauge";
import Gauge from "./Gauge";
import DateRangePicker from "./DateRangePicker";
import { authedFetch } from "@/lib/api/authed-fetch";

type Props = { data: UserData };

type AnuncioResult = {
  item_id:      string;
  title:        string;
  retorno:      number;
  custoProduto: number;
  envioFull:    number;
  imposto:      number;
  taxaML:       number;
  ads:          number;
  lucroBruto:   number;
  lucro:        number;
  margem:       number;
  qty:          number;
  semVenda?:    boolean;
};

type HojeBreakdown = {
  faturamentoBruto: number;
  faturamentoLiquido: number;
  vendasCanceladas: number;
  vendasDevolvidas: number;
  totalCMV:         number;
  totalAds:         number;
  totalEnvio:       number;
  totalTaxasML:     number;
  totalImposto:     number;
  lucroLiquido:     number;
  pedidos:          number;
};

type MlMetrics = {
  faturamentoBruto:   number;
  faturamentoLiquido: number;
  vendasCanceladas:   number;
  vendasDevolvidas:   number;
  totalRetorno:       number;
  faturamentoHoje:    number;
  pedidosHoje:        number;
  ordersCount:        number;
  devolucoes:         number;
  totalCMV:           number;
  totalAds:           number;
  adsNaoVinculado:    number;
  totalEnvio:         number;
  totalImposto:       number;
  totalTaxasML:       number;
  custosOperacionais: number;
  lucroSemCustos:     number;
  lucroComCustos:     number;
  margemSemCustos:    number;
  margemComCustos:    number;
  anuncios:           AnuncioResult[];
  pedidosSemVinculo:  number;
  hoje:               HojeBreakdown;
  serieDiaria:        { data: string; faturamento: number }[];
  devolucoesDetalhe?: Devolucao[];
  adsDiag?:           unknown;
  adsFalhou?:         boolean;
  from:               string;
  to:                 string;
};

type Devolucao = {
  order_id: string;
  valor:    number;
  data:     string;
  motivo:   string;
  produto:  string;
  tipo:     string;
};

// cores usadas na composição de custos (batem com o doughnut)
const COST_COLORS = {
  cmv:  "rgba(99,102,241,.9)",
  full: "rgba(59,130,246,.9)",
  taxa: "rgba(245,158,11,.9)",
  imp:  "rgba(234,179,8,.9)",
  ads:  "rgba(239,68,68,.9)",
  op:   "rgba(167,139,250,.9)",
};

// throttle da sincronização automática (compartilhado entre montagens)
let lastAutoSync = 0;

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayISO(): string {
  return isoOf(new Date());
}
function monthRange(mes: string): { from: string; to: string } {
  const [y, m] = mes.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  const ld = String(last).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${ld}` };
}
function isoUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
// O período informado é um mês civil completo (dia 1 ao último dia)?
function isFullMonth(from: string, to: string): boolean {
  const a = new Date(from + "T00:00:00Z");
  const b = new Date(to + "T00:00:00Z");
  const last = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + 1, 0)).getUTCDate();
  return a.getUTCDate() === 1 && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCFullYear() === b.getUTCFullYear() && b.getUTCDate() === last;
}
// Período imediatamente anterior, do mesmo tamanho. Mês cheio → mês anterior;
// senão desloca a janela pra trás pelo mesmo número de dias.
function prevPeriod(from: string, to: string): { from: string; to: string } {
  const a = new Date(from + "T00:00:00Z");
  const b = new Date(to + "T00:00:00Z");
  if (isFullMonth(from, to)) {
    const pm = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() - 1, 1));
    const y = pm.getUTCFullYear();
    const m = pm.getUTCMonth() + 1;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const mm = String(m).padStart(2, "0");
    return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
  }
  const days = Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
  const prevTo = new Date(a.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86400000);
  return { from: isoUTC(prevFrom), to: isoUTC(prevTo) };
}

// ── Delta vs período anterior (seta ↑/↓ colorida) ──────────────
function Delta({ current, previous, mode }: { current: number; previous: number | null | undefined; mode: "pct" | "points" }) {
  if (previous == null) return null;
  const diff = current - previous;
  const flat = mode === "points"
    ? Math.abs(diff) < 0.05
    : Math.abs(diff) < 0.005 * Math.max(Math.abs(previous), 1);
  const up = diff > 0;
  const color = flat ? "var(--muted)" : up ? "var(--green)" : "var(--red)";
  const arrow = flat ? "→" : up ? "↑" : "↓";
  let text: string;
  if (mode === "points") {
    text = `${diff >= 0 ? "+" : "-"}${Math.abs(diff).toFixed(1)} p.p.`;
  } else {
    const pct = previous !== 0 ? (diff / Math.abs(previous)) * 100 : (current !== 0 ? 100 : 0);
    text = `${pct >= 0 ? "+" : "-"}${Math.abs(pct).toFixed(1)}%`;
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3, fontSize: ".72rem", fontWeight: 700, color }}>
      <span>{arrow}</span><span>{text}</span>
    </div>
  );
}

// ── KPI ────────────────────────────────────────────────────────
function Kpi({
  label, value, tone, isPct, sub, delta, indisponivel,
}: {
  label: string;
  value: number;
  tone: "pos" | "neg" | "acc" | "warn";
  isPct?: boolean;
  sub?: string;
  delta?: React.ReactNode;
  indisponivel?: boolean; // dado não veio: mostra "—", nunca 0
}) {
  const color =
    tone === "pos" ? "var(--green)" :
    tone === "neg" ? "var(--red)" :
    tone === "warn" ? "var(--yellow)" : "var(--text)";
  return (
    <div className={`kpi k-${tone}`}>
      <div className="k-lbl">{label}</div>
      <div className="k-val" style={{ color: indisponivel ? "var(--muted)" : color }}>
        {indisponivel ? "—" : isPct ? `${value.toFixed(1)}%` : fmtBRL(value)}
      </div>
      {sub && <div className="k-sub">{sub}</div>}
      {delta}
    </div>
  );
}

// ── Selo "atualizado há X min" ─────────────────────────────────
function LastUpdated({ at }: { at: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  if (!at) return null;
  const mins = Math.floor((now - at) / 60000);
  const txt = mins <= 0 ? "agora" : mins === 1 ? "há 1 min" : `há ${mins} min`;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: ".72rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 0 3px rgba(34,197,94,.15)" }} />
      Atualizado {txt} · auto 15min
    </span>
  );
}

// ── Curva ABC (Pareto de lucro) ────────────────────────────────
function CurvaABC({ anuncios }: { anuncios: AnuncioResult[] }) {
  const vendidos = anuncios.filter((a) => !a.semVenda);
  if (!vendidos.length) return null;
  const sorted = [...vendidos].sort((a, b) => b.lucro - a.lucro);
  const totalPos = sorted.reduce((s, a) => s + Math.max(a.lucro, 0), 0) || 1;
  const shares = sorted.map((a) => (Math.max(a.lucro, 0) / totalPos) * 100);
  const rows = sorted.map((a, i) => {
    const share = shares[i];
    const cum = shares.slice(0, i + 1).reduce((s, v) => s + v, 0);
    const classe = a.lucro < 0 ? "C" : cum <= 80 ? "A" : cum <= 95 ? "B" : "C";
    return { a, share, acc: cum, classe };
  });
  const cor = (c: string) => (c === "A" ? "var(--green)" : c === "B" ? "var(--yellow)" : "var(--red)");

  return (
    <div className="panel">
      <div className="panel-title" style={{ marginBottom: 6 }}>Curva ABC — quem puxa o lucro</div>
      <div style={{ fontSize: ".75rem", color: "var(--muted)", marginBottom: 12 }}>
        A = topo (até 80% do lucro) · B = 80–95% · C = restante / prejuízo
      </div>
      <div className="table-wrapper" style={{ border: "none" }}>
        <table className="tbl-modern">
          <thead><tr><th>Classe</th><th style={{ textAlign: "left" }}>Anúncio</th><th>Lucro</th><th>% do lucro</th><th>Acumulado</th></tr></thead>
          <tbody>
            {rows.map(({ a, share, acc: cum, classe }) => (
              <tr key={a.item_id}>
                <td><span className="tag" style={{ background: "transparent", color: cor(classe), border: `1px solid ${cor(classe)}` }}>{classe}</span></td>
                <td style={{ fontWeight: 600, textAlign: "left" }}>{a.title}</td>
                <td style={{ color: a.lucro >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>{fmtBRL(a.lucro)}</td>
                <td style={{ color: "var(--muted)" }}>{share.toFixed(1)}%</td>
                <td>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 60, height: 6, borderRadius: 99, background: "var(--surface2)", overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(cum, 100)}%`, height: "100%", background: cor(classe) }} />
                    </div>
                    <span style={{ color: "var(--muted)", fontSize: ".78rem" }}>{cum.toFixed(0)}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Devoluções (detalhe com motivo/produto) ────────────────────
function DevolucoesPanel({ total, detalhe }: { total: number; detalhe: Devolucao[] }) {
  const tipoLabel = (t: string) => (t === "devolucao" ? "Devolução" : t === "cancelamento" ? "Cancelamento" : t || "—");
  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 10 }}>
        <span className="panel-title">Devoluções</span>
        <span className="panel-sub">Total: <b style={{ color: "var(--red)" }}>{fmtBRL(total)}</b> · {detalhe.length} caso(s)</span>
      </div>
      {detalhe.length ? (
        <div className="table-wrapper" style={{ border: "none" }}>
          <table className="tbl-modern">
            <thead><tr><th>Data</th><th style={{ textAlign: "left" }}>Produto</th><th style={{ textAlign: "left" }}>Motivo</th><th style={{ textAlign: "left" }}>Tipo</th><th>Valor</th></tr></thead>
            <tbody>
              {detalhe.map((d, i) => (
                <tr key={d.order_id + i}>
                  <td style={{ color: "var(--muted)" }}>{d.data}</td>
                  <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>{d.produto || "—"}</td>
                  <td style={{ color: "var(--muted)", textAlign: "left" }}>{d.motivo || "—"}</td>
                  <td style={{ textAlign: "left" }}>{tipoLabel(d.tipo)}</td>
                  <td style={{ color: "var(--red)", fontWeight: 700 }}>{fmtBRL(d.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ color: "var(--muted)", fontSize: ".82rem" }}>Sem devoluções no período. </div>
      )}
    </div>
  );
}

// ── Vendas do Dia (hero) ───────────────────────────────────────
function VendasDoDiaHero({ hoje }: { hoje?: HojeBreakdown }) {
  const h: HojeBreakdown = hoje ?? {
    faturamentoBruto: 0, faturamentoLiquido: 0, vendasCanceladas: 0, vendasDevolvidas: 0,
    totalCMV: 0, totalAds: 0, totalEnvio: 0,
    totalTaxasML: 0, totalImposto: 0, lucroLiquido: 0, pedidos: 0,
  };
  const margem = h.faturamentoBruto > 0 ? (h.lucroLiquido / h.faturamentoBruto) * 100 : 0;

  const stats: { label: string; icon: string; value: number; color: string }[] = [
    { label: "Faturamento bruto", icon: "", value: h.faturamentoBruto, color: "var(--green)" },
    { label: "CMV (produto)",     icon: "", value: h.totalCMV,         color: "var(--red)" },
    { label: "Gasto com ADS",     icon: "", value: h.totalAds,         color: "var(--red)" },
    { label: "Lucro líquido",     icon: "", value: h.lucroLiquido,     color: h.lucroLiquido >= 0 ? "var(--green)" : "var(--red)" },
  ];

  return (
    <section className="hero">
      <div className="hero-head">
        <span className="hero-title">Vendas do Dia</span>
        <span className="hero-badge">
          {h.pedidos} pedido(s) · margem <b style={{ color: margem >= 0 ? "var(--green)" : "var(--red)" }}>{margem.toFixed(1)}%</b>
        </span>
      </div>
      <div className="hero-grid">
        {stats.map((s) => (
          <div key={s.label} className="hero-stat">
            <div className="lbl">{s.icon} {s.label}</div>
            <div className="val" style={{ color: s.color }}>{fmtBRL(s.value)}</div>
          </div>
        ))}
      </div>
      <div className="hero-foot">Lucro líquido = retorno − CMV − ADS − Full − taxas ML − imposto</div>
    </section>
  );
}

// ── Meta Diária (velocímetro) ──────────────────────────────────
function MetaDiariaCard({
  faturamentoHoje, pedidosHoje, metaDiaria,
}: {
  faturamentoHoje: number;
  pedidosHoje: number;
  metaDiaria: number | null;
}) {
  const pct = metaDiaria && metaDiaria > 0 ? clamp((faturamentoHoje / metaDiaria) * 100, 0, 100) : 0;
  const batida = metaDiaria ? faturamentoHoje >= metaDiaria : false;
  const falta = metaDiaria ? Math.max(metaDiaria - faturamentoHoje, 0) : 0;

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
      {metaDiaria ? (
        <Gauge
          caption="Meta Diária de Hoje"
          pct={pct}
          centerText={`${pct.toFixed(0)}%`}
          leftLabel="R$ 0"
          rightLabel={fmtBRL(metaDiaria)}
          footer={
            <>
              <b style={{ color: "var(--text)" }}>{fmtBRL(faturamentoHoje)}</b> · {pedidosHoje} pedido(s) ·{" "}
              <span style={{ color: batida ? "var(--green)" : "var(--muted)" }}>
                {batida ? "batida!" : `faltam ${fmtBRL(falta)}`}
              </span>
            </>
          }
        />
      ) : (
        <>
          <div className="panel-title" style={{ marginBottom: 8 }}>Meta Diária de Hoje</div>
          <div style={{ fontSize: ".8rem", color: "var(--muted)" }}>Configure uma meta (Meta 1) na aba Metas.</div>
        </>
      )}
    </div>
  );
}

// ── Tabela de Lucro por Anúncio ────────────────────────────────
function fmtRoas(retorno: number, ads: number): { txt: string; color: string } {
  if (ads <= 0) return { txt: "—", color: "var(--muted)" };
  const r = retorno / ads;
  const color = r >= 3 ? "var(--green)" : r >= 1.5 ? "var(--yellow)" : "var(--red)";
  return { txt: `${r.toFixed(2)}x`, color };
}

function TabelaAnuncios({ anuncios }: { anuncios: AnuncioResult[] }) {
  if (!anuncios.length) {
    return (
      <div style={{ color: "var(--muted)", fontSize: ".85rem", padding: "16px 0", textAlign: "center" }}>
        Nenhum anúncio no período. Cadastre os produtos (SKU/MLB) no Estoque.
      </div>
    );
  }
  const sum = (f: (a: AnuncioResult) => number) => anuncios.reduce((s, a) => s + f(a), 0);
  const totalRet = sum((a) => a.retorno);
  const totalBruto = sum((a) => a.lucroBruto);
  const totalLucro = sum((a) => a.lucro);
  const totalAds = sum((a) => a.ads);
  const margemTotal = totalRet > 0 ? (totalLucro / totalRet) * 100 : 0;
  const margemTag = (m: number) => (m >= 20 ? "tag-g" : m >= 10 ? "tag-y" : "tag-r");
  const totalRoas = fmtRoas(totalRet, totalAds);

  return (
    <div className="table-wrapper" style={{ border: "none" }}>
      <table className="tbl-modern">
        <thead>
          <tr>
            <th>Anúncio</th><th>Qtd</th><th>Retorno</th><th>CMV</th><th>Envio Full</th>
            <th>Taxa ML</th><th>Imposto</th><th>ADS</th><th>ROAS</th><th>Lucro Bruto</th><th>Lucro Líq.</th><th>Margem</th>
          </tr>
        </thead>
        <tbody>
          {anuncios.map((a) => {
            const roas = fmtRoas(a.retorno, a.ads);
            return (
              <tr key={a.item_id} style={a.semVenda ? { opacity: 0.72 } : undefined}>
                <td>
                  <span title={a.title} style={{ fontWeight: 600 }}>{a.title}</span>
                  {a.semVenda && <span style={{ marginLeft: 6, fontSize: ".64rem", fontWeight: 700, color: "#f7c948", background: "rgba(247,201,72,.12)", padding: "1px 6px", borderRadius: 5 }}>SEM VENDA</span>}
                  {a.item_id && <span style={{ display: "block", fontSize: ".7rem", color: "var(--muted)" }}>{a.item_id}</span>}
                </td>
                <td style={{ color: "var(--muted)" }}>{a.qty}</td>
                <td style={{ color: "var(--green)", fontWeight: 600 }}>{fmtBRL(a.retorno)}</td>
                <td style={{ color: "var(--red)" }}>{fmtBRL(a.custoProduto)}</td>
                <td style={{ color: "var(--red)" }}>{fmtBRL(a.envioFull)}</td>
                <td style={{ color: "var(--red)" }}>{fmtBRL(a.taxaML)}</td>
                <td style={{ color: "var(--red)" }}>{fmtBRL(a.imposto)}</td>
                <td style={{ color: "var(--red)" }}>{fmtBRL(a.ads)}</td>
                <td style={{ color: roas.color, fontWeight: 700 }}>{roas.txt}</td>
                <td style={{ color: a.lucroBruto >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(a.lucroBruto)}</td>
                <td style={{ fontWeight: 700, color: a.lucro >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(a.lucro)}</td>
                <td>{a.semVenda ? <span style={{ color: "var(--muted)" }}>—</span> : <span className={`tag ${margemTag(a.margem)}`}>{a.margem.toFixed(1)}%</span>}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td style={{ color: "var(--muted)" }}>{sum((a) => a.qty)}</td>
            <td style={{ color: "var(--green)" }}>{fmtBRL(totalRet)}</td>
            <td style={{ color: "var(--red)" }}>{fmtBRL(sum((a) => a.custoProduto))}</td>
            <td style={{ color: "var(--red)" }}>{fmtBRL(sum((a) => a.envioFull))}</td>
            <td style={{ color: "var(--red)" }}>{fmtBRL(sum((a) => a.taxaML))}</td>
            <td style={{ color: "var(--red)" }}>{fmtBRL(sum((a) => a.imposto))}</td>
            <td style={{ color: "var(--red)" }}>{fmtBRL(totalAds)}</td>
            <td style={{ color: totalRoas.color }}>{totalRoas.txt}</td>
            <td style={{ color: totalBruto >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(totalBruto)}</td>
            <td style={{ color: totalLucro >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(totalLucro)}</td>
            <td><span className={`tag ${margemTag(margemTotal)}`}>{margemTotal.toFixed(1)}%</span></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Média de vendas por dia ────────────────────────────────────
function diasDoPeriodo(from?: string, to?: string): number {
  if (!from || !to) return 1;
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

function MediaVendasDia({ anuncios, from, to }: { anuncios: AnuncioResult[]; from?: string; to?: string }) {
  const dias = diasDoPeriodo(from, to);
  const linhas = anuncios
    .filter((a) => !a.semVenda && a.qty > 0)
    .map((a) => ({ title: a.title, qty: a.qty, media: a.qty / dias }))
    .sort((x, y) => y.media - x.media);
  if (!linhas.length) return null;
  const totalQty = linhas.reduce((s, l) => s + l.qty, 0);

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 8 }}>
        <span className="panel-title">Média de vendas por dia</span>
        <span className="panel-sub">{dias} dia(s) no período · {totalQty} un vendidas · média {(totalQty / dias).toFixed(1)}/dia</span>
      </div>
      <div className="table-wrapper" style={{ border: "none" }}>
        <table className="tbl-modern">
          <thead><tr><th style={{ textAlign: "left" }}>Produto</th><th>Vendas no período</th><th>Média/dia</th></tr></thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={l.title + i}>
                <td style={{ textAlign: "left", fontWeight: 600 }}>{l.title}</td>
                <td style={{ color: "var(--muted)" }}>{l.qty} un</td>
                <td style={{ fontWeight: 700, color: "var(--accent)" }}>{l.media.toFixed(1)}/dia</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Dashboard principal ────────────────────────────────────────
export default function Dashboard({ data }: Props) {
  const mes = mesAtual();

  const [range, setRange] = useState<{ from: string; to: string }>(() => monthRange(mes));
  const [mlRefreshing, setMlRefreshing] = useState(false);
  const [mlLoading, setMlLoading] = useState(false);
  const [mlMetrics, setMlMetrics] = useState<MlMetrics | null>(null);
  const [prevMetrics, setPrevMetrics] = useState<MlMetrics | null>(null);
  const [mlAccount, setMlAccount] = useState<{ user?: { nickname?: string; site_id?: string } } | null>(null);
  const [diag, setDiag] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const mountedRef = useRef(true);

  function runDiagAds() {
    const d = mlMetrics?.adsDiag;
    setDiag(d ? JSON.stringify(d, null, 2) : "Sem diagnóstico disponível (ADS pode estar OK ou período sem dados).");
  }

  const periodoRange = range;

  // "Mês atual" ativa o acompanhamento de metas e as projeções de fechamento.
  const isMesAtual = useMemo(() => {
    const m = monthRange(mes);
    return range.from === m.from && range.to === m.to;
  }, [range, mes]);

  const periodoLabel = useMemo(() => {
    const today = todayISO();
    if (range.from === today && range.to === today) return "Hoje";
    if (isMesAtual) return "Mês atual";
    return "Personalizado";
  }, [range, isMesAtual]);

  const prevLabel = useMemo(
    () => (isFullMonth(range.from, range.to) ? "vs mês anterior" : "vs período anterior"),
    [range],
  );

  const fetchMetrics = useCallback(async (from: string, to: string, silent = false, fresh = false) => {
    if (!silent) setMlLoading(true);
    try {
      const res = await authedFetch(`/api/ml/metrics?from=${from}&to=${to}${fresh ? "&fresh=1" : ""}`, { cache: "no-store" });
      if (!res.ok) { if (!silent) setMlMetrics(null); return; }
      const json = await res.json();
      if (mountedRef.current) { setMlMetrics(json); setLastUpdated(Date.now()); }
    } catch {
      if (!silent && mountedRef.current) setMlMetrics(null);
    } finally {
      if (!silent && mountedRef.current) setMlLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    fetchMetrics(periodoRange.from, periodoRange.to);
  }, [periodoRange, fetchMetrics]);

  // Métricas do período ANTERIOR (mesmo tamanho) para a comparação vs. anterior.
  const prevRange = useMemo(() => prevPeriod(periodoRange.from, periodoRange.to), [periodoRange]);
  useEffect(() => {
    let alive = true;
    setPrevMetrics(null);
    (async () => {
      try {
        const res = await authedFetch(`/api/ml/metrics?from=${prevRange.from}&to=${prevRange.to}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (alive && mountedRef.current) setPrevMetrics(json);
      } catch { /* comparação é opcional; silencioso */ }
    })();
    return () => { alive = false; };
  }, [prevRange]);

  useEffect(() => {
    authedFetch("/api/ml/account", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (mountedRef.current) setMlAccount(j); })
      .catch(() => {});
  }, []);

  // Sincronização automática ao abrir (mantém "hoje" e o mês sempre atualizados)
  useEffect(() => {
    if (Date.now() - lastAutoSync < 5 * 60 * 1000) return;
    lastAutoSync = Date.now();
    (async () => {
      setMlRefreshing(true);
      try {
        await authedFetch("/api/ml/sync-all", { method: "POST" });
        if (mountedRef.current) await fetchMetrics(periodoRange.from, periodoRange.to, true, true);
      } catch { /* silencioso */ }
      finally { if (mountedRef.current) setMlRefreshing(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Atualização automática a cada 15 minutos (silenciosa) enquanto aberto
  useEffect(() => {
    const id = setInterval(() => {
      (async () => {
        try { await authedFetch("/api/ml/sync-all", { method: "POST" }); } catch { /* ignora */ }
        if (mountedRef.current) fetchMetrics(periodoRange.from, periodoRange.to, true, true);
      })();
    }, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [periodoRange, fetchMetrics]);

  async function handleRefreshML() {
    setMlRefreshing(true);
    try {
      await authedFetch("/api/ml/sync-all", { method: "POST" });
      await fetchMetrics(periodoRange.from, periodoRange.to, false, true);
    } catch (e) { console.error(e); }
    finally { setMlRefreshing(false); }
  }

  // ── Metas ────────────────────────────────────────────────
  const activeGoalEntry = data.goalEntries.find((e) => e.mes === mes) ?? data.goalEntries[0] ?? null;
  const goals: Goals | null = activeGoalEntry
    ? {
        mes:         activeGoalEntry.mes,
        meta1:       activeGoalEntry.meta1,
        meta2:       activeGoalEntry.meta2 ?? null,
        meta3:       activeGoalEntry.meta3 ?? null,
        metaMargem:  activeGoalEntry.metaMargem ?? 10,
        metaDiaria:  activeGoalEntry.metaDiaria ?? null,
        meta2Diaria: activeGoalEntry.meta2Diaria ?? null,
        meta3Diaria: activeGoalEntry.meta3Diaria ?? null,
        label:       activeGoalEntry.label,
      }
    : data.goals;

  const fatBruto = mlMetrics?.faturamentoBruto ?? 0;
  // Líquido = bruto − canceladas − devoluções. É a base real das metas.
  const fatLiquido = mlMetrics?.faturamentoLiquido ?? 0;
  const retorno = mlMetrics?.totalRetorno ?? 0;
  const lucroLiquido = mlMetrics?.lucroComCustos ?? 0;

  const projecao = useMemo(() => {
    if (!isMesAtual || !mlMetrics) return 0;
    const diaAtual = diaAtualNoMes();
    const totalDias = diasNoMes(mes);
    if (diaAtual <= 0) return 0;
    return (fatLiquido / diaAtual) * totalDias;
  }, [isMesAtual, mlMetrics, fatLiquido, mes]);

  // Projeção de LUCRO: escala a parte variável (sem custos op.) e mantém o
  // custo operacional do mês fixo.
  const projecaoLucro = useMemo(() => {
    if (!isMesAtual || !mlMetrics) return 0;
    const diaAtual = diaAtualNoMes();
    const totalDias = diasNoMes(mes);
    if (diaAtual <= 0) return 0;
    const variavel = mlMetrics.lucroSemCustos;
    return (variavel / diaAtual) * totalDias - (mlMetrics.custosOperacionais ?? 0);
  }, [isMesAtual, mlMetrics, mes]);

  // Meta diária automática = meta mensal (Meta 1) ÷ dias do mês
  const metaDiariaAtiva = goals?.meta1 ? goals.meta1 / diasNoMes(mes) : null;

  const totalCustos =
    (mlMetrics?.totalCMV ?? 0) + (mlMetrics?.totalEnvio ?? 0) + (mlMetrics?.totalTaxasML ?? 0) +
    (mlMetrics?.totalImposto ?? 0) + (mlMetrics?.totalAds ?? 0) + (mlMetrics?.custosOperacionais ?? 0);

  // Quando o ADS não vem, NÃO mostramos 0 — 0 é um número errado (some do custo
  // e infla a margem). A linha vira "indisponível" e a tela avisa.
  const adsFalhou = mlMetrics?.adsFalhou === true;

  const custoRows: { label: string; value: number; color: string; indisponivel?: boolean }[] = [
    { label: "CMV (custo do produto)", value: mlMetrics?.totalCMV ?? 0, color: COST_COLORS.cmv },
    { label: "Envio Full", value: mlMetrics?.totalEnvio ?? 0, color: COST_COLORS.full },
    { label: "Taxas ML (comissão)", value: mlMetrics?.totalTaxasML ?? 0, color: COST_COLORS.taxa },
    { label: "Imposto sobre venda", value: mlMetrics?.totalImposto ?? 0, color: COST_COLORS.imp },
    { label: "ADS (publicidade)", value: mlMetrics?.totalAds ?? 0, color: COST_COLORS.ads, indisponivel: adsFalhou },
    { label: "Custos operacionais", value: mlMetrics?.custosOperacionais ?? 0, color: COST_COLORS.op },
  ];

  return (
    <div className="dash">
      {/* ── Topbar ── */}
      <div className="dash-top">
        <div className="dash-top-left">
          <span className="acct-chip">
            <span className="acct-dot" /> Conta ML <b>{mlAccount?.user?.nickname ?? "—"}</b>
          </span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={handleRefreshML} disabled={mlRefreshing} style={{ opacity: mlRefreshing ? 0.6 : 1 }}>
            {mlRefreshing ? "Sincronizando..." : "⟳ Atualizar ML"}
          </button>
          {(mlMetrics && mlMetrics.totalAds === 0) && (
            <button type="button" className="btn btn-xs btn-ghost" onClick={runDiagAds} title="Diagnóstico do ADS">ADS</button>
          )}
          <LastUpdated at={lastUpdated} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <DateRangePicker
            from={range.from}
            to={range.to}
            onApply={(from, to) => setRange({ from, to })}
          />
        </div>
      </div>

      {diag && (
        <pre style={{
          position: "relative", background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 8, padding: "12px 14px", fontSize: ".72rem", maxHeight: 300, overflow: "auto",
          whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--text)",
        }}>
          <button type="button" className="btn btn-xs btn-ghost" onClick={() => setDiag(null)} style={{ position: "absolute", right: 8, top: 8 }}>Fechar</button>
          {diag}
        </pre>
      )}

      {adsFalhou && (
        <div style={{ padding: "10px 14px", background: "rgba(245,158,11,.12)", border: "1px solid rgba(245,158,11,.45)", borderRadius: 8, fontSize: ".82rem", color: "#f7c948" }}>
          <b>Atenção: o gasto com ADS não veio do Mercado Livre neste período.</b>{" "}
          Não estou mostrando R$ 0,00 para não te dar número errado — mas isso significa que o{" "}
          <b>lucro e a margem abaixo estão otimistas</b> (falta descontar o ADS). O resto dos números está correto.
        </div>
      )}

      {mlMetrics && !adsFalhou && mlMetrics.totalAds === 0 && (() => {
        const d = mlMetrics.adsDiag as { advertisersStatus?: number; advertiserId?: unknown } | null;
        const blocked = !!d && (d.advertisersStatus === 401 || d.advertisersStatus === 403 || d.advertiserId == null);
        if (!blocked) return null;
        return (
          <div style={{ padding: "10px 14px", background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.35)", borderRadius: 8, fontSize: ".82rem", color: "#f7c948" }}>
            <b>ADS não autorizado (HTTP {d?.advertisersStatus ?? "—"}).</b> O token do Mercado Livre não tem permissão de Publicidade.{" "}
            Reconecte o ML em <b>Trocar conta ML</b> concedendo acesso a <b>Publicidade / Mercado Ads</b> para o gasto com Ads voltar a aparecer.
          </div>
        );
      })()}

      {/* ── Conteúdo ── */}
      {mlLoading ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--muted)" }}>Carregando dados…</div>
      ) : (
        <>
          {/* Acompanhamento das metas (topo, modo mês) */}
          {isMesAtual && (
            <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="panel-head" style={{ marginBottom: 0 }}>
                <span className="panel-title">Acompanhamento das Metas — {formatMesBR(mes)}</span>
                <span className="panel-sub">Projeção de fechamento: {fmtBRL(projecao)}</span>
              </div>
              {goals?.meta1 ? (
                <MetasGauge
                  fatBruto={fatLiquido}
                  meta1={goals.meta1}
                  meta2={goals.meta2 ?? null}
                  meta3={goals.meta3 ?? null}
                  projecao={projecao}
                  projecaoLucro={projecaoLucro}
                  diaAtual={diaAtualNoMes()}
                  totalDias={diasNoMes(mes)}
                  margemAtual={mlMetrics?.margemComCustos ?? 0}
                  metaMargem={goals.metaMargem ?? 10}
                />
              ) : (
                <div className="panel" style={{ color: "var(--muted)", fontSize: ".85rem" }}>
                  Nenhuma meta configurada. Configure na aba Metas.
                </div>
              )}
            </section>
          )}

          {/* Vendas do dia */}
          <VendasDoDiaHero hoje={mlMetrics?.hoje} />

          {/* Resultado do período */}
          <section>
            <div className="panel-head">
              <span className="panel-title">Resultado do período</span>
              {mlMetrics && <span className="panel-sub">{formatDateBR(mlMetrics.from)} a {formatDateBR(mlMetrics.to)} · {periodoLabel}{prevMetrics ? ` · setas ${prevLabel}` : ""}</span>}
            </div>
            <div className="kpi-grid">
              <Kpi label="Faturamento bruto" value={fatBruto} tone="acc" sub="tudo, inclui cancelados/devolvidos" />
              <Kpi label="Faturamento líquido" value={fatLiquido} tone="acc" sub="− canceladas − devoluções"
                delta={<Delta current={fatLiquido} previous={prevMetrics?.faturamentoLiquido} mode="pct" />} />
              <Kpi label="Retorno sobre vendas" value={retorno} tone="acc"
                delta={<Delta current={retorno} previous={prevMetrics?.totalRetorno} mode="pct" />} />
              <Kpi label="Lucro líquido" value={lucroLiquido} tone={lucroLiquido >= 0 ? "pos" : "neg"} sub="já com custos operacionais"
                delta={<Delta current={lucroLiquido} previous={prevMetrics?.lucroComCustos} mode="pct" />} />
              <Kpi label="Margem líquida" value={mlMetrics?.margemComCustos ?? 0} tone="warn" isPct
                delta={<Delta current={mlMetrics?.margemComCustos ?? 0} previous={prevMetrics?.margemComCustos} mode="points" />} />
              <Kpi label="Gasto com ADS" value={mlMetrics?.totalAds ?? 0} tone="neg"
                indisponivel={adsFalhou} sub={adsFalhou ? "ML não retornou — não é zero" : undefined} />
              <Kpi label="Vendas canceladas" value={mlMetrics?.vendasCanceladas ?? 0} tone="neg" sub="não contam no lucro" />
              <Kpi label="Devoluções" value={mlMetrics?.vendasDevolvidas ?? 0} tone="neg" sub="0 a 0 (produto volta ao estoque)" />
            </div>
          </section>

          {/* Meta diária de hoje */}
          <MetaDiariaCard
            faturamentoHoje={mlMetrics?.faturamentoHoje ?? 0}
            pedidosHoje={mlMetrics?.pedidosHoje ?? 0}
            metaDiaria={metaDiariaAtiva}
          />

          {(mlMetrics?.pedidosSemVinculo ?? 0) > 0 && (
            <div style={{ padding: "8px 12px", background: "rgba(247,201,72,.1)", border: "1px solid rgba(247,201,72,.3)", borderRadius: 8, fontSize: ".78rem", color: "#f7c948" }}>
              {mlMetrics?.pedidosSemVinculo} pedido(s) sem produto vinculado — cadastre o SKU/MLB no Estoque para o lucro ficar completo.
            </div>
          )}

          {/* Composição de custos + Doughnut */}
          <div className="dash-2col">
            <div className="panel">
              <div className="panel-title" style={{ marginBottom: 14 }}>Composição de Custos</div>
              {custoRows.map((r) => (
                <div key={r.label} className="cost-row">
                  <span className="c-lbl"><span className="cost-dot" style={{ background: r.color }} />{r.label}</span>
                  {r.indisponivel
                    ? <span title="O Mercado Livre não retornou o gasto com ADS. Não mostro R$ 0,00 para não te dar número errado." style={{ color: "#f7c948", fontWeight: 700, fontSize: ".82rem" }}>indisponível</span>
                    : <span style={{ color: "var(--red)", fontWeight: 700 }}>{fmtBRL(r.value)}</span>}
                </div>
              ))}
              <div className="cost-total">
                <span>Total de custos{adsFalhou && <span style={{ color: "#f7c948", fontWeight: 400, fontSize: ".72rem" }}> (sem ADS)</span>}</span>
                <span style={{ color: "var(--red)" }}>{fmtBRL(totalCustos)}</span>
              </div>
            </div>
            <div className="panel">
              <div className="panel-title" style={{ marginBottom: 14 }}>Distribuição dos Gastos</div>
              <ExpensesDoughnut
                produto={mlMetrics?.totalCMV ?? 0}
                envio={mlMetrics?.totalEnvio ?? 0}
                taxasML={mlMetrics?.totalTaxasML ?? 0}
                imposto={mlMetrics?.totalImposto ?? 0}
                ads={mlMetrics?.totalAds ?? 0}
                operacional={mlMetrics?.custosOperacionais ?? 0}
              />
            </div>
          </div>

          {/* Lucro por anúncio */}
          <div className="panel">
            <div className="panel-head" style={{ marginBottom: 8 }}>
              <span className="panel-title">Lucro por Anúncio</span>
            </div>
            <div style={{ fontSize: ".76rem", color: "var(--muted)", marginBottom: 14 }}>
              Lucro líq. = Retorno − CMV − Envio Full − Taxa ML − Imposto − ADS · valores puxados do Mercado Livre
            </div>
            <TabelaAnuncios anuncios={mlMetrics?.anuncios ?? []} />
          </div>

          {/* Média de vendas por dia */}
          <MediaVendasDia anuncios={mlMetrics?.anuncios ?? []} from={mlMetrics?.from} to={mlMetrics?.to} />

          {/* Curva ABC de produtos */}
          <CurvaABC anuncios={mlMetrics?.anuncios ?? []} />

          {/* Devoluções detalhadas */}
          <DevolucoesPanel total={mlMetrics?.devolucoes ?? 0} detalhe={mlMetrics?.devolucoesDetalhe ?? []} />
        </>
      )}
    </div>
  );
}
