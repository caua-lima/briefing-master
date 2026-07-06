"use client";

import { useMemo, useState } from "react";
import Modal from "@/components/Modal";
import { fmtBRL, formatMesBR, mesAtual } from "@/lib/domain/calc";
import type { GoalEntry } from "@/lib/domain/types";
import {
  deleteGoalEntry,
  saveGoalEntry,
  updateGoalEntry,
} from "@/lib/firebase/data";
import type { UserData } from "@/components/useUserData";

export default function MetasTab({
  uid,
  data,
}: {
  uid: string;
  data: UserData;
}) {
  const [openNew, setOpenNew] = useState(false);
  const [editEntry, setEditEntry] = useState<GoalEntry | null>(null);

  // Current month's active entry (first one matching current month, or latest)
  const activeEntry = useMemo<GoalEntry | null>(() => {
    const mes = mesAtual();
    return (
      data.goalEntries.find((e) => e.mes === mes) ??
      data.goalEntries[0] ??
      null
    );
  }, [data.goalEntries]);

  return (
    <div className="dash">
      <div className="dash-top">
        <div className="dash-top-left"><h2 style={{ fontSize: "1.15rem", fontWeight: 800 }}>🎯 Definição de Metas</h2></div>
        <button type="button" className="btn btn-purple btn-sm" onClick={() => setOpenNew(true)}>＋ Nova Meta</button>
      </div>

      <div style={{ fontSize: ".8rem", color: "var(--muted)", background: "rgba(167,139,250,.07)", border: "1px solid rgba(167,139,250,.2)", borderRadius: 8, padding: "10px 14px" }}>
        💡 Defina as metas de faturamento (🥇🥈🥉) e a margem de lucro líquido alvo. O <strong>acompanhamento com velocímetros</strong> aparece no Dashboard.
      </div>

      <div className="panel">
        <div className="panel-title" style={{ marginBottom: 14 }}>📋 Metas cadastradas</div>
        {data.goalEntries.length === 0 ? (
          <div style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>
            Nenhuma meta definida.<br />Clique em <strong>＋ Nova Meta</strong>.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.goalEntries.map((entry) => (
              <GoalEntryRow
                key={entry.id}
                entry={entry}
                isActive={entry.id === activeEntry?.id}
                onEdit={() => setEditEntry(entry)}
                onDelete={() => { if (!confirm("Remover esta meta?")) return; deleteGoalEntry(uid, entry.id).catch(() => {}); }}
              />
            ))}
          </div>
        )}
      </div>

      {openNew && <GoalEntryModal uid={uid} entry={null} open onClose={() => setOpenNew(false)} />}
      {editEntry && <GoalEntryModal uid={uid} entry={editEntry} open onClose={() => setEditEntry(null)} />}
    </div>
  );
}

function GoalEntryRow({
  entry,
  isActive,
  onEdit,
  onDelete,
}: {
  entry: GoalEntry;
  isActive: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const chip = (emoji: string, valor: number | null, cor: string) =>
    valor ? (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: `${cor}1f`, border: `1px solid ${cor}`, color: cor, borderRadius: 999, padding: "2px 10px", fontSize: ".76rem", fontWeight: 700 }}>
        {emoji} {fmtBRL(valor)}
      </span>
    ) : null;

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap",
      background: isActive ? "rgba(79,142,247,.06)" : "var(--surface2)",
      border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
      borderRadius: 10, padding: "12px 16px",
    }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 800, fontSize: ".95rem", textTransform: "capitalize" }}>{formatMesBR(entry.mes)}</span>
          {isActive && <span style={{ fontSize: ".68rem", background: "var(--accent)", color: "#fff", borderRadius: 6, padding: "2px 8px", fontWeight: 700 }}>ATIVA</span>}
          {entry.label && <span style={{ fontSize: ".78rem", color: "var(--muted)" }}>· {entry.label}</span>}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          {chip("🥇", entry.meta1, "#4f8ef7")}
          {chip("🥈", entry.meta2, "#f7c948")}
          {chip("🥉", entry.meta3, "#a855f7")}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(34,197,94,.12)", border: "1px solid var(--green)", color: "var(--green)", borderRadius: 999, padding: "2px 10px", fontSize: ".76rem", fontWeight: 700 }}>
            📈 margem {entry.metaMargem ?? 10}%
          </span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" className="btn btn-warning btn-xs" onClick={onEdit}>✏️ Editar</button>
        <button type="button" className="btn btn-danger btn-xs" onClick={onDelete}>🗑</button>
      </div>
    </div>
  );
}

function GoalEntryModal({
  uid,
  entry,
  open,
  onClose,
}: {
  uid: string;
  entry: GoalEntry | null;
  open: boolean;
  onClose: () => void;
}) {
  const [mes, setMes] = useState(entry ? entry.mes : mesAtual());
  const [m1, setM1] = useState(entry?.meta1 ? String(entry.meta1) : "");
  const [m2, setM2] = useState(entry?.meta2 ? String(entry.meta2) : "");
  const [m3, setM3] = useState(entry?.meta3 ? String(entry.meta3) : "");
  const [margem, setMargem] = useState(entry?.metaMargem != null ? String(entry.metaMargem) : "10");
  const [label, setLabel] = useState(entry?.label ?? "");

  async function onSave() {
    const v1 = parseFloat(m1) || 0;
    if (!v1) { alert("Informe pelo menos a Meta 1."); return; }
    const newEntry: GoalEntry = {
      id: entry?.id || `goal_${Date.now()}`,
      mes: mes || mesAtual(),
      meta1: v1,
      meta2: parseFloat(m2) || null,
      meta3: parseFloat(m3) || null,
      metaMargem: parseFloat(margem) || 10,
      // meta diária é derivada automaticamente da meta mensal (meta1 / dias)
      metaDiaria: null,
      meta2Diaria: null,
      meta3Diaria: null,
      // Firebase setDoc não aceita undefined em campos — usar null para ausência
      label: label || undefined,
    };
    if (entry) {
      await updateGoalEntry(uid, entry.id, newEntry);
    } else {
      await saveGoalEntry(uid, newEntry);
    }
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="modal-icon">🎯</div>
      <div className="modal-title">
        {entry ? "Editar Meta" : "Nova Meta"}
      </div>

      <div className="config-field">
        <label>📅 Mês / Ano</label>
        <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
      </div>

      <div className="config-field">
        <label>📝 Nome da meta principal (opcional)</label>
        <input
          type="text"
          placeholder="Ex: Objetivo Principal, Meta agressiva…"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <div className="hint">Aparece no card principal e no histórico desta meta</div>
      </div>

      <hr className="config-sep" />
      <div className="config-section-title">🎯 Metas Mensais de Faturamento</div>

      <div className="config-field">
        <label>🥇 Meta 1 — Objetivo Principal (R$)</label>
        <input type="number" min="0" step="100" placeholder="Ex: 15000" value={m1} onChange={(e) => setM1(e.target.value)} />
      </div>
      <div className="config-field">
        <label>🥈 Meta 2 (opcional, R$)</label>
        <input type="number" min="0" step="100" placeholder="Ex: 20000" value={m2} onChange={(e) => setM2(e.target.value)} />
      </div>
      <div className="config-field">
        <label>🥉 Meta 3 (opcional, R$)</label>
        <input type="number" min="0" step="100" placeholder="Ex: 25000" value={m3} onChange={(e) => setM3(e.target.value)} />
      </div>

      <hr className="config-sep" />
      <div className="config-section-title">💰 Meta de Lucro Líquido</div>

      <div className="config-field">
        <label>📈 Margem de lucro líquido alvo (%)</label>
        <input type="number" min="0" step="0.5" placeholder="10" value={margem} onChange={(e) => setMargem(e.target.value)} />
        <div className="hint">
          Padrão 10%. A meta diária é calculada automaticamente pela meta mensal (Meta 1 ÷ dias do mês).
        </div>
      </div>

      <div className="modal-btns">
        <button type="button" className="btn btn-success" onClick={onSave}>
          💾 Salvar Meta
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          ✕ Cancelar
        </button>
      </div>
    </Modal>
  );
}
