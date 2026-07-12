"use client";

import { useEffect, useState } from "react";
import { fmtBRL, mesAtual, todayStr, totalCustosMes } from "@/lib/domain/calc";
import type { Cost } from "@/lib/domain/types";
import { deleteCost, upsertCost } from "@/lib/firebase/data";
import type { UserData } from "@/components/useUserData";
import { useAccess } from "@/components/tabs/AccessGuard";

function newId() {
  return "c" + Date.now() + Math.random().toString(36).slice(2, 6);
}

export default function CustosTab({ uid, data }: { uid: string; data: UserData }) {
  const { canEdit } = useAccess();
  const totalDia = data.costs.filter((c) => c.freq === "diario").reduce((s, c) => s + (parseFloat(c.valor) || 0), 0);
  const totalMes = totalCustosMes(data.costs, mesAtual());

  function onAdd() {
    upsertCost(uid, { id: newId(), nome: "", valor: "", freq: "diario", data: todayStr() }).catch(() => {});
  }

  return (
    <div className="dash">
      <div className="dash-top">
        <div className="dash-top-left"><h2 style={{ fontSize: "1.15rem", fontWeight: 800 }}>💸 Custos Operacionais</h2></div>
        {canEdit && <button type="button" className="btn btn-primary btn-sm" onClick={onAdd}>＋ Adicionar Custo</button>}
      </div>

      <div className="kpi-grid">
        <div className="kpi k-neg"><div className="k-lbl">Custo fixo / dia</div><div className="k-val" style={{ color: "var(--red)" }}>{fmtBRL(totalDia)}</div><div className="k-sub">descontado do lucro diário</div></div>
        <div className="kpi k-neg"><div className="k-lbl">Custo total do mês</div><div className="k-val" style={{ color: "var(--red)" }}>{fmtBRL(totalMes)}</div><div className="k-sub">fixos × dias + mensais + avulsos</div></div>
        <div className="kpi k-acc"><div className="k-lbl">Custos cadastrados</div><div className="k-val">{data.costs.length}</div></div>
      </div>

      <div style={{ fontSize: ".8rem", color: "var(--muted)", background: "rgba(79,142,247,.06)", border: "1px solid rgba(79,142,247,.18)", borderRadius: 8, padding: "10px 14px" }}>
        💡 <strong>Diário</strong> = desconta todo dia · <strong>Mensal</strong> = só no lucro do mês · <strong>Avulso</strong> = apenas na data informada
      </div>

      <div className="panel">
        {data.costs.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
            Nenhum custo cadastrado.<br />Clique em <strong>＋ Adicionar Custo</strong>.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.costs.map((c) => (<CustoRow key={c.id} uid={uid} cost={c} />))}
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

function CustoRow({ uid, cost }: { uid: string; cost: Cost }) {
  const [nome, setNome] = useState(cost.nome);
  const [valor, setValor] = useState(cost.valor);
  const [freq, setFreq] = useState<Cost["freq"]>(cost.freq);
  const [dataAvulso, setDataAvulso] = useState(cost.data || todayStr());

  useEffect(() => {
    setNome(cost.nome); setValor(cost.valor); setFreq(cost.freq); setDataAvulso(cost.data || todayStr());
  }, [cost.nome, cost.valor, cost.freq, cost.data]);

  useEffect(() => {
    const handle = setTimeout(() => {
      const next: Cost = { id: cost.id, nome, valor, freq, data: dataAvulso };
      if (next.nome === cost.nome && next.valor === cost.valor && next.freq === cost.freq && next.data === cost.data) return;
      upsertCost(uid, next).catch(() => {});
    }, 350);
    return () => clearTimeout(handle);
  }, [nome, valor, freq, dataAvulso, cost, uid]);

  const meta = FREQ_META[freq];
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "12px 14px", borderRadius: 10, background: "var(--surface2)", border: "1px solid var(--border)", borderLeft: `3px solid ${meta.cor}` }}>
      <input type="text" placeholder="Ex: Mercado Turbo, aluguel…" value={nome} onChange={(e) => setNome(e.target.value)} style={{ ...inputStyle, flex: "3 1 180px", fontWeight: 600 }} />
      <div style={{ position: "relative", flex: "1 1 110px" }}>
        <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontSize: ".85rem", pointerEvents: "none" }}>R$</span>
        <input type="number" min="0" step="0.01" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} style={{ ...inputStyle, paddingLeft: 30, fontWeight: 700, color: "var(--red)" }} />
      </div>
      <select value={freq} onChange={(e) => setFreq(e.target.value as Cost["freq"])} style={{ ...inputStyle, flex: "1 1 120px", color: meta.cor, fontWeight: 600 }}>
        <option value="diario">📅 Diário</option>
        <option value="mensal">🗓 Mensal</option>
        <option value="avulso">⚡ Avulso</option>
      </select>
      {freq === "avulso" && (
        <input type="date" value={dataAvulso} onChange={(e) => setDataAvulso(e.target.value)} style={{ ...inputStyle, flex: "1 1 140px" }} />
      )}
      <button type="button" className="btn btn-danger btn-xs" onClick={() => deleteCost(uid, cost.id).catch(() => {})} style={{ flexShrink: 0 }}>🗑</button>
    </div>
  );
}
