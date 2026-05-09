"use client";

import { useEffect, useRef, useState } from "react";
import {
  colorClass,
  computeSummary,
  emptyListing,
  fmtBRL,
  formatDateBR,
  formatDateLong,
} from "@/lib/domain/calc";
import type { ArchivedDay, Listing } from "@/lib/domain/types";
import { archiveDay, deleteDay } from "@/lib/firebase/data";
import Modal from "@/components/Modal";
import type { UserData } from "@/components/useUserData";

type ChartType = "revenue" | "profit" | "margin" | "roas" | "ads" | "cmv";
type ChartMode = "line" | "bar" | "pie";

export default function HistoricoTab({
  uid,
  data,
}: {
  uid: string;
  data: UserData;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [chartType, setChartType] = useState<ChartType>("revenue");

  const filtered = data.days.filter((day) => {
    // Product/name search
    if (search) {
      const q = search.toLowerCase();
      const matchesAd = (day.ads || []).some(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          // also match raw listing mlb if present
          false,
      );
      const matchesRaw = (day.raw || []).some(
        (r: Listing) =>
          r.name.toLowerCase().includes(q) ||
          (r.mlb ?? "").toLowerCase().includes(q),
      );
      if (!matchesAd && !matchesRaw) return false;
    }
    if (dateFrom && day.date < dateFrom) return false;
    if (dateTo && day.date > dateTo) return false;
    return true;
  });

  const chartDays = filtered.map((day) => {
    const s = computeSummary(day.raw ?? []);
    return { ...day, ...s };
  });

  if (data.days.length === 0) {
    return (
      <>
        <div className="history-header">
          <h2>🗂 Histórico de Dias</h2>
        </div>
        <div className="history-empty">
          <div className="empty-icon">📭</div>
          <p>Nenhum dia arquivado ainda.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span style={{ color: "var(--muted)", fontSize: ".9rem", display: "flex", alignItems: "center" }}>📊 Gráfico:</span>
        {(['revenue', 'profit', 'margin', 'roas', 'ads', 'cmv'] as const).map((type) => (
          <button
            key={type}
            type="button"
            className={`btn ${chartType === type ? 'btn-primary' : 'btn-ghost'} btn-sm`}
            onClick={() => setChartType(type)}
          >
            {{
              revenue: '💵 Faturamento',
              profit: '✅ Lucro Líquido',
              margin: '📊 Margem %',
              roas: '📢 ROAS',
              ads: '📢 Gasto Ads',
              cmv: '📦 CMV',
            }[type]}
          </button>
        ))}
      </div>

      <div className="history-charts-grid">
        <div className="history-chart-span-2">
          <Chart days={chartDays} type={chartType} mode="line" />
        </div>
        <div className="history-chart-row">
          <Chart days={chartDays} type={chartType} mode="bar" />
          <Chart days={chartDays} type={chartType} mode="pie" />
        </div>
      </div>

      {/* Filters */}
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "14px 16px",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto auto",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <input
            type="text"
            placeholder="🔍 Filtrar por produto ou MLB…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOpenIdx(null);
            }}
            style={{
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "8px 12px",
              color: "var(--text)",
              fontSize: ".88rem",
              outline: "none",
              width: "100%",
              boxSizing: "border-box",
            }}
          />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            title="Data inicial"
            style={{
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "8px 10px",
              color: "var(--text)",
              fontSize: ".82rem",
              outline: "none",
            }}
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            title="Data final"
            style={{
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "8px 10px",
              color: "var(--text)",
              fontSize: ".82rem",
              outline: "none",
            }}
          />
        </div>
        {(search || dateFrom || dateTo) && (
          <div style={{ marginTop: 8, fontSize: ".78rem", color: "var(--muted)" }}>
            {filtered.length} de {data.days.length} dias encontrados{" "}
            <button
              type="button"
              onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); }}
              style={{
                marginLeft: 8,
                color: "var(--blue)",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: ".78rem",
                padding: 0,
              }}
            >
              Limpar filtros
            </button>
          </div>
        )}
      </div>

      <div className="history-header">
        <h2>🗂 Histórico de Dias</h2>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          onClick={() => {
            if (!confirm("Apagar TODO o histórico?")) return;
            data.days.forEach((d) => deleteDay(uid, d.date).catch(() => { }));
          }}
        >
          🗑 Limpar Histórico
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="history-empty">
          <div className="empty-icon">🔍</div>
          <p>Nenhum resultado encontrado para os filtros aplicados.</p>
        </div>
      ) : (
        <div>
          {filtered.map((day) => {
            const idx = data.days.indexOf(day);
            return (
              <DayCard
                key={day.date}
                day={day}
                open={openIdx === idx}
                onToggle={() => setOpenIdx(openIdx === idx ? null : idx)}
                onEdit={() => setEditIdx(idx)}
                onDelete={() => {
                  if (!confirm("Remover este dia?")) return;
                  deleteDay(uid, day.date).catch(() => { });
                }}
              />
            );
          })}
        </div>
      )}

      {editIdx !== null && data.days[editIdx] && (
        <EditModal
          uid={uid}
          day={data.days[editIdx]}
          onClose={() => setEditIdx(null)}
        />
      )}
    </>
  );
}

function DayCard({
  day,
  open,
  onToggle,
  onEdit,
  onDelete,
}: {
  day: ArchivedDay;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const computed = computeSummary(day.raw ?? []);

  return (
    <div className={`history-day ${open ? "open" : ""}`}>
      <div
        className="history-day-header"
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onToggle();
        }}
        role="button"
        tabIndex={0}
      >
        <div className="history-day-date">
          <span>📅</span>
          <span>{formatDateLong(day.date)}</span>
        </div>
        <div className="history-day-pills">
          <span className="pill pill-green">
            💵 {fmtBRL(computed.totalFaturamento)}
          </span>
          <span className={`pill ${computed.totalLiquido >= 0 ? "pill-green" : "pill-red"}`}>
            ✅ {fmtBRL(computed.totalLiquido)}
          </span>
          {computed.totalRoas !== null ? (
            <span className="pill pill-yellow">📢 {computed.totalRoas.toFixed(2)}x</span>
          ) : (
            <span className="pill">📢 —</span>
          )}
          <span className="pill">{computed.ads.length} anúncios</span>
        </div>
        <div className="history-day-actions">
          <button
            type="button"
            className="btn btn-warning btn-xs"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
          >
            ✏️ Editar
          </button>
          <button
            type="button"
            className="btn btn-danger btn-xs"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            🗑
          </button>
          <span className="chevron">▼</span>
        </div>
      </div>
      {open && (
        <div className="history-day-body">
          <div className="table-wrapper" style={{ marginBottom: 14 }}>
            <table>
              <thead>
                <tr>
                  <th>Anúncio</th>
                  <th>Faturamento</th>
                  <th>CMV</th>
                  <th>L.Bruto</th>
                  <th>Ads</th>
                  <th>L.Líquido</th>
                  <th>Margem</th>
                  <th>ROAS</th>
                </tr>
              </thead>
              <tbody>
                {computed.ads.map((a, i) => (
                  <tr key={i}>
                    <td className="td-name">{a.name}</td>
                    <td className="positive">{fmtBRL(a.faturamento)}</td>
                    <td className="negative">{fmtBRL(a.cmv)}</td>
                    <td className={colorClass(a.bruto)}>{fmtBRL(a.bruto)}</td>
                    <td className="negative">{fmtBRL(a.ads)}</td>
                    <td className={colorClass(a.liquido)}>{fmtBRL(a.liquido)}</td>
                    <td
                      className={
                        a.margem >= 10 ? "positive"
                          : a.margem > 0 ? "neutral"
                            : "negative"
                      }
                    >
                      {a.margem.toFixed(1)}%
                    </td>
                    <td
                      className={
                        a.roas !== null
                          ? a.roas >= 1 ? "positive" : "negative"
                          : "neutral"
                      }
                    >
                      {a.roas !== null ? `${a.roas.toFixed(2)}x` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="summary-grid" style={{ marginTop: 0 }}>
            <div className="summary-card card-receita">
              <div className="card-label">💵 Faturamento</div>
              <div className="card-value positive">
                {fmtBRL(computed.totalFaturamento)}
              </div>
            </div>
            <div className="summary-card card-bruto">
              <div className="card-label">💼 L.Bruto</div>
              <div className={`card-value ${colorClass(computed.totalBruto)}`}>
                {fmtBRL(computed.totalBruto)}
              </div>
            </div>
            <div className="summary-card card-liquido">
              <div className="card-label">✅ L.Líquido</div>
              <div className={`card-value ${colorClass(computed.totalLiquido)}`}>
                {fmtBRL(computed.totalLiquido)}
              </div>
              <div className="card-sub">
                Margem: {computed.totalMargem.toFixed(1)}%
              </div>
            </div>
            <div className="summary-card card-roas">
              <div className="card-label">📢 ROAS</div>
              <div
                className={`card-value ${computed.totalRoas !== null
                    ? computed.totalRoas >= 1 ? "positive" : "negative"
                    : "neutral"
                  }`}
              >
                {computed.totalRoas !== null ? `${computed.totalRoas.toFixed(2)}x` : "—"}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EditModal({
  uid,
  day,
  onClose,
}: {
  uid: string;
  day: ArchivedDay;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Listing[]>(() =>
    day.raw?.length
      ? day.raw.map((a) => ({ ...a }))
      : (day.ads || []).map((a) => ({
        name: a.name || "",
        preco: "",
        retorno: "",
        custo: "",
        vendas: "",
        ads: "",
      })),
  );

  function update(i: number, p: Partial<Listing>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...p } : it)));
  }

  async function onSave() {
    if (!items.length) { alert("Adicione pelo menos um anúncio."); return; }
    const s = computeSummary(items);
    await archiveDay(uid, { date: day.date, ...s, raw: items });
    onClose();
  }

  return (
    <Modal open onClose={onClose} wide>
      <div className="modal-icon">✏️</div>
      <div className="modal-title">Editar dia do histórico</div>
      <p className="modal-sub">📅 {formatDateLong(day.date)}</p>
      <div>
        {items.map((a, i) => (
          <div key={i} className="edit-ad-card">
            <div className="edit-ad-title">
              <span>📦 Anúncio {i + 1}</span>
              <button
                type="button"
                className="btn btn-danger btn-xs"
                onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
              >
                ✕
              </button>
            </div>
            <input
              className="edit-name-input"
              type="text"
              placeholder="Nome"
              value={a.name}
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <div className="edit-fields">
              <EditField label="🏷️ Preço venda" value={a.preco} onChange={(v) => update(i, { preco: v })} />
              <EditField label="📥 Retorno líq." value={a.retorno} onChange={(v) => update(i, { retorno: v })} />
              <EditField label="💰 Custo" value={a.custo} onChange={(v) => update(i, { custo: v })} />
              <EditField label="🛒 Vendas" value={a.vendas} onChange={(v) => update(i, { vendas: v })} step="1" />
              <EditField label="📢 Ads" value={a.ads} onChange={(v) => update(i, { ads: v })} />
              <EditField label="🏷️ MLB" value={a.mlb ?? ""} onChange={(v) => update(i, { mlb: v })} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setItems((prev) => [...prev, emptyListing()])}
        >
          ＋ Adicionar anúncio
        </button>
      </div>
      <div className="modal-btns">
        <button type="button" className="btn btn-success" onClick={onSave}>
          💾 Salvar alterações
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          ✕ Cancelar
        </button>
      </div>
    </Modal>
  );
}

function EditField({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
}) {
  return (
    <div className="edit-field">
      <label>{label}</label>
      <input
        type={step === "1" || label.includes("MLB") ? (label.includes("MLB") ? "text" : "number") : "number"}
        min="0"
        step={step ?? "0.01"}
        placeholder="0.00"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function Chart({
  days,
  type,
  mode,
}: {
  days: ArchivedDay[];
  type: ChartType;
  mode: ChartMode;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const wrap = canvas?.parentElement;
    if (!canvas || !wrap) return;
    const W = wrap.clientWidth || 800;
    const H = 220;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    const dataAsc = [...days].reverse();
    const labels = dataAsc.map((d) => formatDateBR(d.date));

    const values = dataAsc.map((d) => {
      switch (type) {
        case 'revenue': return d.totalFaturamento || 0;
        case 'profit': return d.totalLiquido || 0;
        case 'margin': return d.totalMargem || 0;
        case 'roas': return d.totalRoas || 0;
        case 'ads': return d.totalAds || 0;
        case 'cmv': return d.totalCMV || 0;
        default: return 0;
      }
    });
    if (!values.length) return;

    const PAD = mode === "pie"
      ? { top: 18, right: 18, bottom: 18, left: 18 }
      : { top: 20, right: 20, bottom: 40, left: 82 };
    const cW = W - PAD.left - PAD.right;
    const cH = H - PAD.top - PAD.bottom;
    const minV = Math.min(...values, 0);
    const maxV = Math.max(...values, 0);
    const range = maxV - minV || 1;
    const xStep = values.length > 1 ? cW / (values.length - 1) : cW / 2;
    const xPos = (i: number) => PAD.left + (values.length > 1 ? i * xStep : cW / 2);
    const yPos = (v: number) => PAD.top + cH - ((v - minV) / range) * cH;

    const isCurrency = ['revenue', 'profit', 'ads', 'cmv'].includes(type);
    const isPercent = type === 'margin';

    if (mode !== "pie") {
      ctx.strokeStyle = "#2e3350";
      ctx.lineWidth = 1;
      for (let g = 0; g <= 4; g++) {
        const y = PAD.top + (cH / 4) * g;
        ctx.beginPath();
        ctx.moveTo(PAD.left, y);
        ctx.lineTo(PAD.left + cW, y);
        ctx.stroke();
        ctx.fillStyle = "#64748b";
        ctx.font = "11px Segoe UI,sans-serif";
        ctx.textAlign = "right";
        const v = maxV - (range / 4) * g;
        let label = '';
        if (isCurrency) {
          label = `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
        } else if (isPercent) {
          label = `${v.toFixed(1)}%`;
        } else {
          label = v.toFixed(1) + 'x';
        }
        ctx.fillText(label, PAD.left - 6, y + 4);
      }
    }

    const colors = {
      revenue: { grad0: "rgba(79,142,247,.3)", grad1: "rgba(79,142,247,.02)", line: "#4f8ef7" },
      profit: { grad0: "rgba(34,197,94,.3)", grad1: "rgba(34,197,94,.02)", line: "#22c55e" },
      margin: { grad0: "rgba(249,115,22,.3)", grad1: "rgba(249,115,22,.02)", line: "#f97316" },
      roas: { grad0: "rgba(168,85,247,.3)", grad1: "rgba(168,85,247,.02)", line: "#a855f7" },
      ads: { grad0: "rgba(239,68,68,.3)", grad1: "rgba(239,68,68,.02)", line: "#ef4444" },
      cmv: { grad0: "rgba(99,102,241,.3)", grad1: "rgba(99,102,241,.02)", line: "#6366f1" },
    };
    const color = colors[type];

    if (mode === "bar") {
      const barGap = values.length > 1 ? 8 : 0;
      const barWidth = Math.max(10, (cW - barGap * (values.length - 1)) / values.length);
      values.forEach((v, i) => {
        const x = PAD.left + i * (barWidth + barGap);
        const topY = yPos(Math.max(v, 0));
        const baseY = yPos(0);
        const barH = Math.max(2, Math.abs(baseY - topY));
        const barTop = v >= 0 ? topY : baseY;

        const grad = ctx.createLinearGradient(0, barTop, 0, barTop + barH);
        grad.addColorStop(0, color.grad0);
        grad.addColorStop(1, color.grad1);
        ctx.fillStyle = grad;
        ctx.fillRect(x, barTop, barWidth, barH);

        ctx.fillStyle = "#64748b";
        ctx.font = "10px Segoe UI,sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(labels[i], x + barWidth / 2, H - PAD.bottom + 18);
      });
      return;
    }

    if (mode === "pie") {
      const total = values.reduce((sum, value) => sum + Math.max(value, 0), 0) || 1;
      const cx = PAD.left + cW / 2;
      const cy = PAD.top + cH / 2;
      const radius = Math.min(cW, cH) / 2 - 8;
      let start = -Math.PI / 2;
      const palette = ["#4f8ef7", "#22c55e", "#f59e0b", "#a855f7", "#ef4444", "#6366f1", "#14b8a6", "#f97316"];

      values.forEach((value, index) => {
        const slice = Math.max(value, 0) / total;
        const end = start + slice * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, start, end);
        ctx.closePath();
        ctx.fillStyle = palette[index % palette.length];
        ctx.fill();
        start = end;
      });

      const legendX = 12;
      const legendY = 18;
      ctx.font = "11px Segoe UI,sans-serif";
      ctx.textAlign = "left";
      values.slice(0, 6).forEach((value, index) => {
        const y = legendY + index * 18;
        ctx.fillStyle = palette[index % palette.length];
        ctx.fillRect(legendX, y - 9, 10, 10);
        ctx.fillStyle = "#64748b";
        ctx.fillText(`${labels[index]} · ${((Math.max(value, 0) / total) * 100).toFixed(0)}%`, legendX + 16, y);
      });
      return;
    }

    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
    grad.addColorStop(0, color.grad0);
    grad.addColorStop(1, color.grad1);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(xPos(0), yPos(values[0]));
    for (let i = 1; i < values.length; i++) ctx.lineTo(xPos(i), yPos(values[i]));
    ctx.lineTo(xPos(values.length - 1), PAD.top + cH);
    ctx.lineTo(xPos(0), PAD.top + cH);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = color.line;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(xPos(0), yPos(values[0]));
    for (let i = 1; i < values.length; i++) ctx.lineTo(xPos(i), yPos(values[i]));
    ctx.stroke();

    values.forEach((v, i) => {
      const x = xPos(i);
      const y = yPos(v);
      ctx.fillStyle = color.line;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#64748b";
      ctx.font = "10px Segoe UI,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(labels[i], x, H - PAD.bottom + 18);
    });
  }, [days, type, mode]);

  const titles = {
    revenue: '💵 Evolução do Faturamento',
    profit: '✅ Evolução do Lucro Líquido',
    margin: '📊 Evolução da Margem',
    roas: '📢 Evolução do ROAS',
    ads: '📢 Evolução do Gasto em Ads',
    cmv: '📦 Evolução do CMV',
  };

  const modeTitle = {
    line: "Linha",
    bar: "Barras",
    pie: "Pizza",
  };

  return (
    <div className="chart-section">
      <h3>📈 {titles[type]} · {modeTitle[mode]}</h3>
      <div className="chart-canvas-wrap">
        <canvas ref={ref} className="chart-canvas" />
      </div>
    </div>
  );
}