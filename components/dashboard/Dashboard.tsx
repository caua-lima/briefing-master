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
import AvisoRemessasFull from "./AvisoRemessasFull";
import { authedFetch } from "@/lib/api/authed-fetch";

type Props = { data: UserData; onVerEstoque?: () => void };

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
  vendas:       number;
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
  reconc?:            { count: number; nosso: number; real: number };
  devolucoesEmAndamento?: number;
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
  status?:      string;
  emAndamento?: boolean;
};

/**
 * Cores da composição de custos (batem com o doughnut). Paleta Zênite, com
 * uma matiz distinta por fatia — o remap automático tinha deixado violeta
 * repetido em duas fatias, que ficavam indistinguíveis lado a lado.
 */
const COST_COLORS = {
  cmv:  "#F4B942", // custo da mercadoria — ouro, é o maior bloco (série principal)
  full: "#5B8DEF", // frete/Full — azul aço
  taxa: "#C98218", // taxas do ML — âmbar queimado
  imp:  "#B9B5A6", // impostos — marfim apagado
  ads:  "#9B6BCE", // investimento em anúncios — roxo ameixa
  op:   "#D65A4A", // despesas operacionais — terracota
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
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 0 3px rgba(54,179,126,.15)" }} />
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
        <table className="tbl-modern tbl-cards tbl-cards-plain">
          <thead><tr><th>Classe</th><th style={{ textAlign: "left" }}>Anúncio</th><th>Lucro</th><th>% do lucro</th><th>Acumulado</th></tr></thead>
          <tbody>
            {rows.map(({ a, share, acc: cum, classe }) => (
              <tr key={a.item_id}>
                <td data-label="Classe"><span className="tag" style={{ background: "transparent", color: cor(classe), border: `1px solid ${cor(classe)}` }}>{classe}</span></td>
                <td data-label="Anúncio" style={{ fontWeight: 600, textAlign: "left" }}>{a.title}</td>
                <td data-label="Lucro" style={{ color: a.lucro >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>{fmtBRL(a.lucro)}</td>
                <td data-label="% do lucro" style={{ color: "var(--muted)" }}>{share.toFixed(1)}%</td>
                <td data-label="Acumulado">
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

// ── Conferência da margem com o dinheiro real (Mercado Pago) ────
function ConferenciaMP({ reconc }: { reconc?: { count: number; nosso: number; real: number } }) {
  if (!reconc || reconc.count === 0) return null;

  const gap = reconc.nosso - reconc.real; // >0 = ML tirou mais do que a gente conta
  const pctAbs = reconc.real > 0 ? (Math.abs(gap) / reconc.real) * 100 : 0;
  // Menos de 1% ou R$5 no período é ruído de arredondamento/fuso, não custo oculto.
  const ok = Math.abs(gap) < Math.max(5, reconc.real * 0.01);
  const cor = ok ? "var(--green)" : "var(--red)";
  const media = gap / reconc.count;

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <span className="panel-title">Conferência com o dinheiro real</span>
        <span className="panel-sub">nossa conta × líquido do Mercado Pago · {reconc.count} pedido(s)</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>Repasse estimado (nossa conta)</div>
          <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>{fmtBRL(reconc.nosso)}</div>
          <div style={{ fontSize: ".68rem", color: "var(--muted)" }}>total − taxa ML − frete</div>
        </div>
        <div>
          <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>Caiu de verdade (MP)</div>
          <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>{fmtBRL(reconc.real)}</div>
          <div style={{ fontSize: ".68rem", color: "var(--muted)" }}>net_received_amount</div>
        </div>
        <div>
          <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>Diferença</div>
          <div style={{ fontSize: "1.05rem", fontWeight: 800, color: cor }}>
            {gap >= 0 ? "−" : "+"}{fmtBRL(Math.abs(gap))}
          </div>
          <div style={{ fontSize: ".68rem", color: "var(--muted)" }}>{pctAbs.toFixed(1)}% do líquido</div>
        </div>
      </div>

      {ok ? (
        <div style={{
          padding: "10px 12px", borderRadius: 8, fontSize: ".82rem", lineHeight: 1.55,
          background: "rgba(54,179,126,.1)", border: "1px solid rgba(54,179,126,.35)", color: "var(--green)",
        }}>
          <b>Bate.</b> O que a gente calcula como repasse do ML confere com o que o Mercado Pago
          liberou. Não há custo de venda escapando — a margem está confiável.
        </div>
      ) : (
        <div style={{
          padding: "10px 12px", borderRadius: 8, fontSize: ".82rem", lineHeight: 1.55,
          background: "rgba(214,90,74,.1)", border: "1px solid rgba(214,90,74,.4)", color: "#E68B7E",
        }}>
          <b>Há {fmtBRL(Math.abs(gap))} de diferença</b> ({fmtBRL(Math.abs(media))} por pedido).{" "}
          {gap > 0
            ? "O ML repassou MENOS do que a nossa conta previa — existe um custo de venda que não estamos descontando (financiamento, tarifa fixa ou comissão maior). A margem real é mais baixa do que a mostrada nesta diferença."
            : "O MP liberou MAIS do que a nossa conta previa — provável reembolso de frete ou tarifa. A margem real é um pouco melhor."}
          <div style={{ marginTop: 6, color: "var(--muted)" }}>
            Não inclui a taxa mensal de armazenagem do Full, que o ML cobra fora da venda — essa
            entra à mão na aba Custos.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Melhores dias da semana ────────────────────────────────────
const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
// Ordem de exibição: começa na segunda, como a semana comercial.
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0];

function MelhoresDias({ serie, from, to }: { serie: { data: string; faturamento: number }[]; from?: string; to?: string }) {
  const dados = useMemo(() => {
    if (!from || !to) return null;
    const fat = new Map(serie.map((s) => [s.data, s.faturamento]));

    // Não conta dia futuro do mês corrente: ele tem 0 e afundaria a média do
    // dia da semana em que cai. O limite é hoje (data local).
    const hoje = new Date();
    const hojeISO = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
    const fimReal = to < hojeISO ? to : hojeISO;
    if (fimReal < from) return null;

    const soma = new Array(7).fill(0);
    const dias = new Array(7).fill(0);

    const [fy, fm, fd] = from.split("-").map(Number);
    const [ty, tm, td] = fimReal.split("-").map(Number);
    // Percorre data a data no fuso local (new Date(y,m,d) evita o desvio de UTC).
    const cur = new Date(fy, fm - 1, fd);
    const fim = new Date(ty, tm - 1, td);
    while (cur <= fim) {
      const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
      const wd = cur.getDay();
      soma[wd] += fat.get(iso) ?? 0;
      dias[wd] += 1;
      cur.setDate(cur.getDate() + 1);
    }

    const linhas = ORDEM_DIAS.map((wd) => ({
      wd,
      nome: DIAS_SEMANA[wd],
      media: dias[wd] > 0 ? soma[wd] / dias[wd] : 0,
      total: soma[wd],
      amostras: dias[wd],
    }));
    const totalDias = dias.reduce((s: number, n: number) => s + n, 0);
    const maiorMedia = Math.max(...linhas.map((l) => l.media), 0);
    const melhor = [...linhas].filter((l) => l.amostras > 0).sort((a, b) => b.media - a.media)[0] ?? null;
    return { linhas, maiorMedia, melhor, totalDias };
  }, [serie, from, to]);

  if (!dados || dados.totalDias === 0 || dados.maiorMedia === 0) return null;
  const { linhas, maiorMedia, melhor } = dados;

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <span className="panel-title">Melhores dias da semana</span>
        <span className="panel-sub">faturamento médio por dia · {dados.totalDias} dia(s) no período</span>
      </div>

      {melhor && (
        <div style={{ fontSize: ".82rem", color: "var(--muted)", marginBottom: 12 }}>
          Seu dia mais forte é <b style={{ color: "var(--green)" }}>{melhor.nome.toLowerCase()}</b>,
          média de <b style={{ color: "var(--text)" }}>{fmtBRL(melhor.media)}</b> por dia.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {linhas.map((l) => {
          const ehMelhor = melhor?.wd === l.wd;
          const larg = maiorMedia > 0 ? (l.media / maiorMedia) * 100 : 0;
          return (
            <div key={l.wd} style={{ display: "grid", gridTemplateColumns: "78px 1fr auto", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: ".8rem", fontWeight: ehMelhor ? 700 : 500, color: ehMelhor ? "var(--green)" : "var(--text)" }}>
                {l.nome}
              </span>
              <div style={{ height: 20, borderRadius: 6, background: "var(--surface2)", overflow: "hidden" }}>
                <div style={{
                  width: `${larg}%`, height: "100%", borderRadius: 6,
                  background: ehMelhor ? "var(--green)" : "var(--accent)",
                  opacity: l.amostras > 0 ? (ehMelhor ? 0.9 : 0.55) : 0.2,
                  transition: "width .3s",
                }} />
              </div>
              <span style={{ fontSize: ".8rem", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color: ehMelhor ? "var(--text)" : "var(--muted)", fontWeight: ehMelhor ? 700 : 400 }}>
                {l.amostras > 0 ? fmtBRL(l.media) : "—"}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 10, fontSize: ".72rem", color: "var(--muted)", lineHeight: 1.5 }}>
        Média por dia, não o total — assim compara justo mesmo quando um dia da semana
        aparece mais vezes no período. Amplie a data no topo para basear em mais semanas.
      </div>
    </div>
  );
}

// ── Devoluções (detalhe com motivo/produto) ────────────────────
function DevolucoesPanel({ total, emAndamento, detalhe }: { total: number; emAndamento?: number; detalhe: Devolucao[] }) {
  const tipoLabel = (t: string) => (t === "devolucao" ? "Devolução" : t === "cancelamento" ? "Cancelamento" : t || "—");
  const nEmAndamento = detalhe.filter((d) => d.emAndamento).length;
  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 10 }}>
        <span className="panel-title">Devoluções</span>
        <span className="panel-sub">Concluídas: <b style={{ color: "var(--red)" }}>{fmtBRL(total)}</b> · {detalhe.length} caso(s)</span>
      </div>

      {(emAndamento ?? 0) > 0 && (
        <div style={{
          marginBottom: 10, padding: "8px 12px", borderRadius: 8, fontSize: ".8rem", lineHeight: 1.5,
          background: "rgba(244,185,66,.1)", border: "1px solid rgba(244,185,66,.35)", color: "#F4B942",
        }}>
          <b>{fmtBRL(emAndamento ?? 0)}</b> em {nEmAndamento} devolução(ões) <b>ainda em disputa</b> —
          seguem contando como venda no lucro até o Mercado Livre concluir. Só desconto quando fecha.
        </div>
      )}

      {detalhe.length ? (
        <div className="table-wrapper" style={{ border: "none" }}>
          <table className="tbl-modern tbl-cards tbl-cards-plain">
            <thead><tr><th>Data</th><th style={{ textAlign: "left" }}>Produto</th><th style={{ textAlign: "left" }}>Motivo</th><th style={{ textAlign: "left" }}>Situação</th><th>Valor</th></tr></thead>
            <tbody>
              {detalhe.map((d, i) => (
                <tr key={d.order_id + i} style={{ opacity: d.emAndamento ? 0.7 : 1 }}>
                  <td data-label="Data" style={{ color: "var(--muted)" }}>{d.data}</td>
                  <td data-label="Produto" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>{d.produto || "—"}</td>
                  <td data-label="Motivo" style={{ color: "var(--muted)", textAlign: "left" }}>{d.motivo || "—"}</td>
                  <td data-label="Situação" style={{ textAlign: "left" }}>
                    {d.emAndamento
                      ? <span style={{ color: "#F4B942", fontWeight: 600 }}>em disputa</span>
                      : <span style={{ color: "var(--muted)" }}>{tipoLabel(d.tipo)} · concluída</span>}
                    {d.status && <span style={{ display: "block", fontSize: ".64rem", color: "var(--muted)" }}>{d.status}</span>}
                  </td>
                  <td data-label="Valor" style={{ color: d.emAndamento ? "#F4B942" : "var(--red)", fontWeight: 700 }}>{fmtBRL(d.valor)}</td>
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
    { label: "Imposto",           icon: "", value: h.totalImposto,     color: "var(--red)" },
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
  faturamentoHoje, pedidosHoje, metaDiaria, metaPlana, diasRestantes,
}: {
  faturamentoHoje: number;
  pedidosHoje: number;
  metaDiaria: number | null;
  metaPlana: number | null;
  diasRestantes: number | null;
}) {
  const semMeta = metaDiaria == null;
  // metaDiaria == 0 → não falta mais nada: a meta do mês já foi batida.
  const mesBatido = metaDiaria === 0;
  const pct = metaDiaria && metaDiaria > 0 ? clamp((faturamentoHoje / metaDiaria) * 100, 0, 100) : (mesBatido ? 100 : 0);
  const batida = mesBatido || (metaDiaria ? faturamentoHoje >= metaDiaria : false);
  const falta = metaDiaria ? Math.max(metaDiaria - faturamentoHoje, 0) : 0;

  // Quanto a meta de hoje mudou vs o ritmo plano (meta do mês ÷ dias).
  // Acima de 1% de diferença já vale explicar o porquê.
  const ajuste = metaDiaria != null && metaPlana != null && metaPlana > 0
    ? (metaDiaria - metaPlana) / metaPlana
    : 0;
  const atrasado = ajuste > 0.01;
  const adiantado = ajuste < -0.01;

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
      {semMeta ? (
        <>
          <div className="panel-title" style={{ marginBottom: 8 }}>Meta Diária de Hoje</div>
          <div style={{ fontSize: ".8rem", color: "var(--muted)" }}>Configure uma meta (Meta 1) na aba Metas.</div>
        </>
      ) : (
        <>
          <Gauge
            caption="Meta Diária de Hoje"
            pct={pct}
            centerText={mesBatido ? "100%" : `${pct.toFixed(0)}%`}
            leftLabel="R$ 0"
            rightLabel={mesBatido ? "meta do mês batida" : fmtBRL(metaDiaria ?? 0)}
            footer={
              <>
                <b style={{ color: "var(--text)" }}>{fmtBRL(faturamentoHoje)}</b> · {pedidosHoje} pedido(s) ·{" "}
                <span style={{ color: batida ? "var(--green)" : "var(--muted)" }}>
                  {mesBatido ? "meta do mês já batida!" : batida ? "batida!" : `faltam ${fmtBRL(falta)}`}
                </span>
              </>
            }
          />
          {/* Por que a meta de hoje não é a meta plana */}
          {!mesBatido && metaPlana != null && diasRestantes != null && (
            <div style={{ marginTop: 10, textAlign: "center", fontSize: ".72rem", lineHeight: 1.5 }}>
              {atrasado && (
                <span style={{ color: "#F4B942" }}>
                  ↑ subiu de <b>{fmtBRL(metaPlana)}</b> — você está atrás do ritmo
                </span>
              )}
              {adiantado && (
                <span style={{ color: "var(--green)" }}>
                  ↓ caiu de <b>{fmtBRL(metaPlana)}</b> — você está adiantado
                </span>
              )}
              {!atrasado && !adiantado && (
                <span style={{ color: "var(--muted)" }}>no ritmo da meta ({fmtBRL(metaPlana)}/dia)</span>
              )}
              <span style={{ color: "var(--muted)", display: "block" }}>
                o que falta ÷ {diasRestantes} dia(s) restante(s)
              </span>
            </div>
          )}
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
      <table className="tbl-modern tbl-cards">
        <thead>
          <tr>
            <th>Anúncio</th><th>Vendas</th><th>Un</th><th>Retorno</th><th>CMV</th><th>Frete</th>
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
                  {a.semVenda && <span title="Anúncio gastou em ADS mas não vendeu neste período. Se você excluiu o anúncio, o gasto anterior continua aqui porque foi dinheiro real pago ao ML." style={{ marginLeft: 6, fontSize: ".64rem", fontWeight: 700, color: "#F4B942", background: "rgba(244,185,66,.12)", padding: "1px 6px", borderRadius: 5, cursor: "help" }}>SÓ ADS</span>}
                  {a.item_id && <span style={{ display: "block", fontSize: ".7rem", color: "var(--muted)" }}>{a.item_id}</span>}
                </td>
                <td data-label="Vendas" style={{ fontWeight: 700 }}>{a.vendas || "—"}</td>
                <td data-label="Un" style={{ color: "var(--muted)" }}>{a.qty}</td>
                <td data-label="Retorno" style={{ color: "var(--green)", fontWeight: 600 }}>{fmtBRL(a.retorno)}</td>
                <td data-label="CMV" style={{ color: "var(--red)" }}>{fmtBRL(a.custoProduto)}</td>
                <td data-label="Frete" style={{ color: "var(--red)" }}>{fmtBRL(a.envioFull)}</td>
                <td data-label="Taxa ML" style={{ color: "var(--red)" }}>{fmtBRL(a.taxaML)}</td>
                <td data-label="Imposto" style={{ color: "var(--red)" }}>{fmtBRL(a.imposto)}</td>
                <td data-label="ADS" style={{ color: "var(--red)" }}>{fmtBRL(a.ads)}</td>
                <td data-label="ROAS" style={{ color: roas.color, fontWeight: 700 }}>{roas.txt}</td>
                <td data-label="Lucro bruto" style={{ color: a.lucroBruto >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(a.lucroBruto)}</td>
                <td data-label="Lucro líq." style={{ fontWeight: 700, color: a.lucro >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(a.lucro)}</td>
                <td data-label="Margem">{a.semVenda ? <span style={{ color: "var(--muted)" }}>—</span> : <span className={`tag ${margemTag(a.margem)}`}>{a.margem.toFixed(1)}%</span>}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td data-label="">Total</td>
            <td data-label="Vendas" style={{ fontWeight: 700 }}>{sum((a) => a.vendas)}</td>
            <td data-label="Un" style={{ color: "var(--muted)" }}>{sum((a) => a.qty)}</td>
            <td data-label="Retorno" style={{ color: "var(--green)" }}>{fmtBRL(totalRet)}</td>
            <td data-label="CMV" style={{ color: "var(--red)" }}>{fmtBRL(sum((a) => a.custoProduto))}</td>
            <td data-label="Frete" style={{ color: "var(--red)" }}>{fmtBRL(sum((a) => a.envioFull))}</td>
            <td data-label="Taxa ML" style={{ color: "var(--red)" }}>{fmtBRL(sum((a) => a.taxaML))}</td>
            <td data-label="Imposto" style={{ color: "var(--red)" }}>{fmtBRL(sum((a) => a.imposto))}</td>
            <td data-label="ADS" style={{ color: "var(--red)" }}>{fmtBRL(totalAds)}</td>
            <td data-label="ROAS" style={{ color: totalRoas.color }}>{totalRoas.txt}</td>
            <td data-label="Lucro bruto" style={{ color: totalBruto >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(totalBruto)}</td>
            <td data-label="Lucro líq." style={{ color: totalLucro >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(totalLucro)}</td>
            <td data-label="Margem"><span className={`tag ${margemTag(margemTotal)}`}>{margemTotal.toFixed(1)}%</span></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Lucro por anúncio, com filtro de data próprio ──────────────
/**
 * Envolve a tabela de lucro por anúncio com um período independente do
 * dashboard. Por padrão segue o período principal (sem refazer a chamada);
 * ao mudar a data aqui, busca só os anúncios daquele intervalo.
 */
function LucroPorAnuncioPanel({ anuncios, from, to }: { anuncios: AnuncioResult[]; from?: string; to?: string }) {
  const [range, setRange] = useState<{ from: string; to: string }>({ from: from ?? "", to: to ?? "" });
  const [proprio, setProprio] = useState<AnuncioResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(false);

  const indep = !!proprio && (range.from !== from || range.to !== to);

  // Segue o dashboard enquanto o filtro próprio não estiver ativo.
  useEffect(() => {
    if (!proprio) setRange({ from: from ?? "", to: to ?? "" });
  }, [from, to, proprio]);

  async function aplicar(f: string, t: string) {
    setRange({ from: f, to: t });
    // Voltou ao período do dashboard → usa os dados que já vieram, sem refetch.
    if (f === from && t === to) { setProprio(null); setErro(false); return; }
    setLoading(true); setErro(false);
    try {
      const r = await authedFetch(`/api/ml/metrics?from=${f}&to=${t}`, { cache: "no-store" });
      if (!r.ok) { setErro(true); setProprio([]); }
      else { const j = await r.json(); setProprio(j.anuncios ?? []); }
    } catch {
      setErro(true); setProprio([]);
    } finally {
      setLoading(false);
    }
  }

  const dados = indep ? (proprio ?? []) : anuncios;

  return (
    <section className="panel">
      <div className="panel-head" style={{ marginBottom: 8, gap: 10, flexWrap: "wrap" }}>
        <span className="panel-title">Lucro por Anúncio</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {indep && (
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => aplicar(from ?? "", to ?? "")}>
              voltar ao período do dashboard
            </button>
          )}
          <DateRangePicker from={range.from} to={range.to} onApply={aplicar} />
        </div>
      </div>
      <div style={{ fontSize: ".76rem", color: "var(--muted)", marginBottom: 14 }}>
        {indep
          ? <>Filtro próprio: <b style={{ color: "var(--text)" }}>{formatDateBR(range.from)} a {formatDateBR(range.to)}</b> — independente do dashboard.</>
          : "Lucro líq. = Retorno − CMV − Frete − Taxa ML − Imposto − ADS · o frete é o que você paga no envio (Full ou próprio)"}
      </div>
      {erro ? (
        <div style={{ color: "var(--red)", fontSize: ".82rem", padding: "12px 0" }}>
          Não consegui carregar os anúncios desse período. Tente de novo.
        </div>
      ) : loading ? (
        <div style={{ color: "var(--muted)", fontSize: ".85rem", padding: "16px 0", textAlign: "center" }}>Carregando…</div>
      ) : (
        <TabelaAnuncios anuncios={dados} />
      )}
    </section>
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
        <table className="tbl-modern tbl-cards">
          <thead><tr><th style={{ textAlign: "left" }}>Produto</th><th>Vendas no período</th><th>Média/dia</th></tr></thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={l.title + i}>
                <td style={{ textAlign: "left", fontWeight: 600 }}>{l.title}</td>
                <td data-label="Vendas no período" style={{ color: "var(--muted)" }}>{l.qty} un</td>
                <td data-label="Média/dia" style={{ fontWeight: 700, color: "var(--accent)" }}>{l.media.toFixed(1)}/dia</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Dashboard principal ────────────────────────────────────────
export default function Dashboard({ data, onVerEstoque }: Props) {
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

  // ── Meta diária DINÂMICA ──────────────────────────────────────
  // Plana = meta do mês ÷ dias do mês (só referência de "ritmo ideal").
  const metaDiariaPlana = goals?.meta1 ? goals.meta1 / diasNoMes(mes) : null;

  const diasRestantesMes = isMesAtual ? Math.max(diasNoMes(mes) - diaAtualNoMes() + 1, 1) : null;

  // Meta de HOJE = o que ainda falta pra meta do mês ÷ dias que restam (hoje
  // incluso). Se um dia fica abaixo, o que sobrou se redistribui e a meta dos
  // dias seguintes sobe sozinha.
  //
  // Usa o acumulado até ONTEM de propósito: se usasse o de hoje, o alvo cairia
  // conforme as vendas do dia entrassem — a meta fugiria da própria medição.
  const metaDiariaAtiva = useMemo(() => {
    if (!goals?.meta1) return null;
    if (!isMesAtual || !diasRestantesMes) return metaDiariaPlana; // outro período: plana
    const fatAteOntem = Math.max(fatLiquido - (mlMetrics?.faturamentoHoje ?? 0), 0);
    const falta = Math.max(goals.meta1 - fatAteOntem, 0);
    return falta / diasRestantesMes;
  }, [goals?.meta1, isMesAtual, diasRestantesMes, metaDiariaPlana, fatLiquido, mlMetrics?.faturamentoHoje]);

  const totalCustos =
    (mlMetrics?.totalCMV ?? 0) + (mlMetrics?.totalEnvio ?? 0) + (mlMetrics?.totalTaxasML ?? 0) +
    (mlMetrics?.totalImposto ?? 0) + (mlMetrics?.totalAds ?? 0) + (mlMetrics?.custosOperacionais ?? 0);

  // Quando o ADS não vem, NÃO mostramos 0 — 0 é um número errado (some do custo
  // e infla a margem). A linha vira "indisponível" e a tela avisa.
  const adsFalhou = mlMetrics?.adsFalhou === true;

  const custoRows: { label: string; value: number; color: string; indisponivel?: boolean }[] = [
    { label: "CMV (custo do produto)", value: mlMetrics?.totalCMV ?? 0, color: COST_COLORS.cmv },
    { label: "Frete (envio)", value: mlMetrics?.totalEnvio ?? 0, color: COST_COLORS.full },
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

      <AvisoRemessasFull onVerEstoque={onVerEstoque} />

      {adsFalhou && (
        <div style={{ padding: "10px 14px", background: "rgba(244,185,66,.12)", border: "1px solid rgba(244,185,66,.45)", borderRadius: 8, fontSize: ".82rem", color: "#F4B942" }}>
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
          <div style={{ padding: "10px 14px", background: "rgba(244,185,66,.1)", border: "1px solid rgba(244,185,66,.35)", borderRadius: 8, fontSize: ".82rem", color: "#F4B942" }}>
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
            metaPlana={metaDiariaPlana}
            diasRestantes={diasRestantesMes}
          />

          {(mlMetrics?.pedidosSemVinculo ?? 0) > 0 && (
            <div style={{ padding: "8px 12px", background: "rgba(244,185,66,.1)", border: "1px solid rgba(244,185,66,.3)", borderRadius: 8, fontSize: ".78rem", color: "#F4B942" }}>
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
                    ? <span title="O Mercado Livre não retornou o gasto com ADS. Não mostro R$ 0,00 para não te dar número errado." style={{ color: "#F4B942", fontWeight: 700, fontSize: ".82rem" }}>indisponível</span>
                    : <span style={{ color: "var(--red)", fontWeight: 700 }}>{fmtBRL(r.value)}</span>}
                </div>
              ))}
              <div className="cost-total">
                <span>Total de custos{adsFalhou && <span style={{ color: "#F4B942", fontWeight: 400, fontSize: ".72rem" }}> (sem ADS)</span>}</span>
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

          {/* Lucro por anúncio — com filtro de data próprio */}
          <LucroPorAnuncioPanel anuncios={mlMetrics?.anuncios ?? []} from={mlMetrics?.from} to={mlMetrics?.to} />

          {/* Média de vendas por dia */}
          <MediaVendasDia anuncios={mlMetrics?.anuncios ?? []} from={mlMetrics?.from} to={mlMetrics?.to} />

          {/* Conferência da margem contra o dinheiro real */}
          <ConferenciaMP reconc={mlMetrics?.reconc} />

          {/* Melhores dias da semana */}
          <MelhoresDias serie={mlMetrics?.serieDiaria ?? []} from={mlMetrics?.from} to={mlMetrics?.to} />

          {/* Curva ABC de produtos */}
          <CurvaABC anuncios={mlMetrics?.anuncios ?? []} />

          {/* Devoluções detalhadas */}
          <DevolucoesPanel total={mlMetrics?.devolucoes ?? 0} emAndamento={mlMetrics?.devolucoesEmAndamento} detalhe={mlMetrics?.devolucoesDetalhe ?? []} />
        </>
      )}
    </div>
  );
}
