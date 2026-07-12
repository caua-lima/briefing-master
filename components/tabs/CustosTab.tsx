"use client";

import { useEffect, useState } from "react";
import { fmtBRL, mesAtual, todayStr, totalCustosMes, diasNoMes } from "@/lib/domain/calc";
import type { Cost } from "@/lib/domain/types";
import { deleteCost, upsertCost } from "@/lib/firebase/data";
import type { UserData } from "@/components/useUserData";
import { useAccess } from "@/components/tabs/AccessGuard";

function newId() {
  return "c" + Date.now() + Math.random().toString(36).slice(2, 6);
}

// Quanto o custo pesa no mês atual (fixo × dias, mensal cheio, avulso no mês).
function impactoMes(c: Cost, dias: number): number {
  const v = parseFloat(c.valor) || 0;
  if (c.freq === "diario") return v * dias;
  if (c.freq === "mensal") return v;
  // avulso: só conta se for do mês corrente
  return (c.data ?? "").slice(0, 7) === mesAtual() ? v : 0;
}

export default function CustosTab({ uid, data }: { uid: string; data: UserData }) {
  const { canEdit } = useAccess();
  const dias = diasNoMes(mesAtual());
  const totalDia = data.costs.filter((c) => c.freq === "diario").reduce((s, c) => s + (parseFloat(c.valor) || 0), 0);
  const totalMensais = data.costs.filter((c) => c.freq === "mensal").reduce((s, c) => s + (parseFloat(c.valor) || 0), 0);
  const totalMes = totalCustosMes(data.costs, mesAtual());
  const nDiario = data.costs.filter((c) => c.freq === "diario").length;
  const nMensal = data.costs.filter((c) => c.freq === "mensal").length;
  const nAvulso = data.costs.filter((c) => c.freq === "avulso").length;

  function onAdd() {
    upsertCost(uid, { id: newId(), nome: "", valor: "", freq: "diario", data: todayStr() }).catch(() => {});
  }

  return (
    <div className="dash">
      <div className="dash-top">
        <div className="dash-top-left"><h2 style={{ fontSize: "1.15rem", fontWeight: 800 }}>Custos Operacionais</h2></div>
        {canEdit && <button type="button" className="btn btn-primary btn-sm" onClick={onAdd}>＋ Adicionar Custo</button>}
      </div>

      <div className="kpi-grid">
        <div className="kpi k-neg"><div className="k-lbl">Custo fixo / dia</div><div className="k-val" style={{ color: "var(--red)" }}>{fmtBRL(totalDia)}</div><div className="k-sub">{nDiario} diário(s) · desconta todo dia</div></div>
        <div className="kpi k-warn"><div className="k-lbl">Mensais fixos</div><div className="k-val" style={{ color: "var(--yellow)" }}>{fmtBRL(totalMensais)}</div><div className="k-sub">{nMensal} custo(s) · 1×/mês</div></div>
        <div className="kpi k-neg"><div className="k-lbl">Impacto no mês</div><div className="k-val" style={{ color: "var(--red)" }}>{fmtBRL(totalMes)}</div><div className="k-sub">fixos × {dias}d + mensais + avulsos</div></div>
        <div className="kpi k-acc"><div className="k-lbl">Custos cadastrados</div><div className="k-val">{data.costs.length}</div><div className="k-sub">{nAvulso} avulso(s)</div></div>
      </div>

      <div style={{ fontSize: ".8rem", color: "var(--muted)", background: "rgba(79,142,247,.06)", border: "1px solid rgba(79,142,247,.18)", borderRadius: 8, padding: "10px 14px" }}>
        <strong>Diário</strong> = desconta todo dia · <strong>Mensal</strong> = só no lucro do mês · <strong>Avulso</strong> = apenas na data informada
      </div>

      <div className="panel">
        {data.costs.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
            Nenhum custo cadastrado.<br />Clique em <strong>＋ Adicionar Custo</strong>.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.costs.map((c) => (<CustoRow key={c.id} uid={uid} cost={c} canEdit={canEdit} impacto={impactoMes(c, dias)} />))}
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8,
  padding: "9px 11px", color: "var(--text)", fontSize: ".9rem", outline: "none", width: "100%",
};

const FREQ_META: Record<Cost["freq"], { cor: string; label: string }> = {
  diario: { cor: "var(--red)", label: "Diário" },
  mensal: { cor: "var(--yellow)", label: "Mensal" },
  avulso: { cor: "var(--purple)", label: "Avulso" },
};

function CustoRow({ uid, cost, canEdit, impacto }: { uid: string; cost: Cost; canEdit: boolean; impacto: number }) {
  const [nome, setNome] = useState(cost.nome);
  const [valor, setValor] = useState(cost.valor);
  const [freq, setFreq] = useState<Cost["freq"]>(cost.freq);
  const [dataAvulso, setDataAvulso] = useState(cost.data || todayStr());

  useEffect(() => {
    setNome(cost.nome); setValor(cost.valor); setFreq(cost.freq); setDataAvulso(cost.data || todayStr());
  }, [cost.nome, cost.valor, cost.freq, cost.data]);

  useEffect(() => {
    if (!canEdit) return;
    const handle = setTimeout(() => {
      const next: Cost = { id: cost.id, nome, valor, freq, data: dataAvulso };
      if (next.nome === cost.nome && next.valor === cost.valor && next.freq === cost.freq && next.data === cost.data) return;
      upsertCost(uid, next).catch(() => {});
    }, 350);
    return () => clearTimeout(handle);
  }, [nome, valor, freq, dataAvulso, cost, uid, canEdit]);

  const meta = FREQ_META[freq];
  const ro = !canEdit;
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "12px 14px", borderRadius: 10, background: "var(--surface2)", border: "1px solid var(--border)", borderLeft: `3px solid ${meta.cor}` }}>
      <span style={{ flexShrink: 0, fontSize: ".68rem", fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase", color: meta.cor, background: `${meta.cor}1a`, border: `1px solid ${meta.cor}55`, borderRadius: 6, padding: "3px 8px" }}>{meta.label}</span>
      <input type="text" placeholder="Ex: Mercado Turbo, aluguel…" value={nome} onChange={(e) => setNome(e.target.value)} readOnly={ro} style={{ ...inputStyle, flex: "3 1 180px", fontWeight: 600, opacity: ro ? .8 : 1 }} />
      <div style={{ position: "relative", flex: "1 1 110px" }}>
        <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontSize: ".85rem", pointerEvents: "none" }}>R$</span>
        <input type="number" min="0" step="0.01" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} readOnly={ro} style={{ ...inputStyle, paddingLeft: 30, fontWeight: 700, color: "var(--red)", opacity: ro ? .8 : 1 }} />
      </div>
      <select value={freq} onChange={(e) => setFreq(e.target.value as Cost["freq"])} disabled={ro} style={{ ...inputStyle, flex: "1 1 120px", color: meta.cor, fontWeight: 600, opacity: ro ? .8 : 1 }}>
        <option value="diario">Diário</option>
        <option value="mensal">Mensal</option>
        <option value="avulso">Avulso</option>
      </select>
      {freq === "avulso" && (
        <input type="date" value={dataAvulso} onChange={(e) => setDataAvulso(e.target.value)} readOnly={ro} style={{ ...inputStyle, flex: "1 1 140px", opacity: ro ? .8 : 1 }} />
      )}
      <div style={{ flexShrink: 0, textAlign: "right", minWidth: 96 }}>
        <div style={{ fontSize: ".62rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>no mês</div>
        <div style={{ fontWeight: 700, color: "var(--red)", whiteSpace: "nowrap" }}>{fmtBRL(impacto)}</div>
      </div>
      {canEdit && (
        <button type="button" className="btn btn-danger btn-xs" onClick={() => deleteCost(uid, cost.id).catch(() => {})} style={{ flexShrink: 0 }}>Excluir</button>
      )}
    </div>
  );
}
