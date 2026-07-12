"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  from: string;                                   // yyyy-mm-dd
  to: string;                                     // yyyy-mm-dd
  onApply: (from: string, to: string) => void;
};

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];

// ── helpers de data (trabalham em yyyy-mm-dd, sem fuso) ──────────
function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function parse(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m: m - 1, d };
}
function todayIso(): string {
  const t = new Date();
  return iso(t.getFullYear(), t.getMonth(), t.getDate());
}
function addDays(s: string, n: number): string {
  const { y, m, d } = parse(s);
  const dt = new Date(y, m, d + n);
  return iso(dt.getFullYear(), dt.getMonth(), dt.getDate());
}
function monthBounds(y: number, m: number): { from: string; to: string } {
  const last = new Date(y, m + 1, 0).getDate();
  return { from: iso(y, m, 1), to: iso(y, m, last) };
}
function fmtBR(s: string): string {
  const { y, m, d } = parse(s);
  return `${String(d).padStart(2, "0")}/${String(m + 1).padStart(2, "0")}/${y}`;
}
function shiftMonth(y: number, m: number, delta: number): { y: number; m: number } {
  const dt = new Date(y, m + delta, 1);
  return { y: dt.getFullYear(), m: dt.getMonth() };
}

type Preset = { key: string; label: string; range: () => { from: string; to: string } };

function buildPresets(): Preset[] {
  const t = todayIso();
  const { y, m } = parse(t);
  const prev = shiftMonth(y, m, -1);
  return [
    { key: "mes",    label: "Mês atual",    range: () => monthBounds(y, m) },
    { key: "mespas", label: "Mês passado",  range: () => monthBounds(prev.y, prev.m) },
    { key: "7d",     label: "Últimos 7d",   range: () => ({ from: addDays(t, -6), to: t }) },
    { key: "30d",    label: "Últimos 30d",  range: () => ({ from: addDays(t, -29), to: t }) },
    { key: "hoje",   label: "Hoje",         range: () => ({ from: t, to: t }) },
    { key: "ontem",  label: "Ontem",        range: () => ({ from: addDays(t, -1), to: addDays(t, -1) }) },
  ];
}

function MonthGrid({
  y, m, draftFrom, draftTo, onPick,
}: {
  y: number;
  m: number;
  draftFrom: string;
  draftTo: string;
  onPick: (day: string) => void;
}) {
  const firstWeekday = new Date(y, m, 1).getDay();       // 0 = domingo
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = todayIso();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="drp-cal">
      <div className="drp-cal-title">{MONTHS[m]} {y}</div>
      <div className="drp-grid">
        {DOW.map((d) => <div key={d} className="drp-dow">{d}</div>)}
        {cells.map((d, i) => {
          if (d === null) return <div key={`e${i}`} className="drp-day muted" />;
          const day = iso(y, m, d);
          const hasRange = !!draftFrom && !!draftTo;
          const inRange = hasRange && day >= draftFrom && day <= draftTo;
          const isEdge = day === draftFrom || (!!draftTo && day === draftTo);
          const cls = ["drp-day"];
          if (inRange) cls.push("in");
          if (isEdge) cls.push("edge");
          if (day === today) cls.push("today");
          return (
            <button key={day} type="button" className={cls.join(" ")} onClick={() => onPick(day)}>
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function DateRangePicker({ from, to, onApply }: Props) {
  const presets = useMemo(() => buildPresets(), []);
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [view, setView] = useState<{ y: number; m: number }>(() => parse(from)); // mês da esquerda
  const rootRef = useRef<HTMLDivElement>(null);

  function toggle() {
    if (!open) {
      // ao abrir, sincroniza o rascunho com o intervalo atual
      setDraftFrom(from);
      setDraftTo(to);
      setView(parse(from));
    }
    setOpen((o) => !o);
  }

  // Fecha ao clicar fora / Esc
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pickDay(day: string) {
    // sem início, ou intervalo já completo começa de novo
    if (!draftFrom || (draftFrom && draftTo)) {
      setDraftFrom(day);
      setDraftTo("");
    } else if (day < draftFrom) {
      setDraftFrom(day);          // clicou antes do início vira o novo início
    } else {
      setDraftTo(day);
    }
  }

  function apply() {
    const f = draftFrom || from;
    const t = draftTo || draftFrom || to;   // um dia só = from
    onApply(f, t);
    setOpen(false);
  }

  function pickPreset(p: Preset) {
    const r = p.range();
    setDraftFrom(r.from);
    setDraftTo(r.to);
    setView(parse(r.from));
    onApply(r.from, r.to);
    setOpen(false);
  }

  const activePreset = presets.find((p) => {
    const r = p.range();
    return r.from === from && r.to === to;
  });

  const right = shiftMonth(view.y, view.m, 1);

  return (
    <div className="drp" ref={rootRef}>
      <button type="button" className="drp-trigger" onClick={toggle}>
        <span>{fmtBR(from)} <span className="drp-dash">–</span> {fmtBR(to)}</span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </button>

      {open && (
        <div className="drp-pop" role="dialog">
          <div className="drp-presets">
            {presets.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`drp-preset ${activePreset?.key === p.key ? "active" : ""}`}
                onClick={() => pickPreset(p)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="drp-foot-label">
            {draftFrom ? fmtBR(draftFrom) : "—"} até {draftTo ? fmtBR(draftTo) : draftFrom ? "…" : "—"}
          </div>

          <div className="drp-cals">
            <button type="button" className="drp-nav drp-nav-prev" onClick={() => setView(shiftMonth(view.y, view.m, -1))} aria-label="Mês anterior">‹</button>
            <MonthGrid y={view.y} m={view.m} draftFrom={draftFrom} draftTo={draftTo} onPick={pickDay} />
            <MonthGrid y={right.y} m={right.m} draftFrom={draftFrom} draftTo={draftTo} onPick={pickDay} />
            <button type="button" className="drp-nav drp-nav-next" onClick={() => setView(shiftMonth(view.y, view.m, 1))} aria-label="Próximo mês">›</button>
          </div>

          <div className="drp-actions">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
            <button type="button" className="btn btn-sm btn-warning" onClick={apply}>Aplicar</button>
          </div>
        </div>
      )}
    </div>
  );
}
