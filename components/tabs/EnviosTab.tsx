"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtBRL } from "@/lib/domain/calc";
import { authedFetch } from "@/lib/api/authed-fetch";

type Envio = {
  order_id: string;
  data: string;
  produto: string;
  status: string;
  substatus: string;
  bucket: "entregue" | "aCaminho" | "preparando" | "problema" | "outros";
  logistic: string;
  tracking: string;
  estimated: string;
  entregaEm: string;
  valor: number;
};
type Resumo = { entregue: number; aCaminho: number; preparando: number; problema: number; outros: number; total: number };

function isoOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function monthRange() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return { from: `${d.getFullYear()}-${mm}-01`, to: `${d.getFullYear()}-${mm}-${String(last).padStart(2, "0")}` };
}

const STATUS_LABEL: Record<string, string> = {
  delivered: "Entregue", shipped: "A caminho", ready_to_ship: "Pronto p/ envio",
  handling: "Em preparação", pending: "Pendente", not_delivered: "Não entregue", cancelled: "Cancelado",
};
const BUCKET_META: Record<Envio["bucket"], { label: string; cor: string }> = {
  entregue: { label: "Entregue", cor: "var(--green)" },
  aCaminho: { label: "A caminho", cor: "#4f8ef7" },
  preparando: { label: "Preparando", cor: "var(--yellow)" },
  problema: { label: "Problema", cor: "var(--red)" },
  outros: { label: "Outros", cor: "var(--muted)" },
};

type Periodo = "hoje" | "mes" | "custom";

export default function EnviosTab() {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [resumo, setResumo] = useState<Resumo>({ entregue: 0, aCaminho: 0, preparando: 0, problema: 0, outros: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<Envio["bucket"] | "todos">("todos");

  const range = useMemo(() => {
    const today = isoOf(new Date());
    if (periodo === "hoje") return { from: today, to: today };
    if (periodo === "custom" && customFrom && customTo) return { from: customFrom, to: customTo };
    return monthRange();
  }, [periodo, customFrom, customTo]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch(`/api/ml/envios?from=${range.from}&to=${range.to}`, { cache: "no-store" });
      if (res.ok) {
        const j = await res.json();
        setEnvios(j.envios ?? []);
        setResumo(j.resumo ?? { entregue: 0, aCaminho: 0, preparando: 0, problema: 0, outros: 0, total: 0 });
      } else { setEnvios([]); }
    } catch { setEnvios([]); } finally { setLoading(false); }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  async function atualizar() {
    setLoading(true);
    try { await authedFetch("/api/ml/sync-all", { method: "POST" }); } catch { /* ignora */ }
    await load();
  }

  const lista = filtro === "todos" ? envios : envios.filter((e) => e.bucket === filtro);

  const cards: { key: Envio["bucket"]; icon: string; n: number }[] = [
    { key: "entregue", icon: "✅", n: resumo.entregue },
    { key: "aCaminho", icon: "🚚", n: resumo.aCaminho },
    { key: "preparando", icon: "📦", n: resumo.preparando },
    { key: "problema", icon: "⚠️", n: resumo.problema },
  ];

  return (
    <div className="dash">
      <div className="dash-top">
        <div className="dash-top-left">
          <h2 style={{ fontSize: "1.15rem", fontWeight: 800 }}>📦 Entregas</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={atualizar} disabled={loading}>
            {loading ? "⏳ Atualizando..." : "⟳ Atualizar"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div className="seg">
            {(["hoje", "mes", "custom"] as Periodo[]).map((m) => (
              <button key={m} type="button" className={`seg-btn ${periodo === m ? "active" : ""}`} onClick={() => setPeriodo(m)}>
                {m === "hoje" ? "Hoje" : m === "mes" ? "Mês" : "Personalizado"}
              </button>
            ))}
          </div>
          {periodo === "custom" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input type="date" className="date-input" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              <span style={{ color: "var(--muted)", fontSize: ".8rem" }}>até</span>
              <input type="date" className="date-input" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </div>
          )}
        </div>
      </div>

      {/* Cards por status (clicáveis pra filtrar) */}
      <div className="kpi-grid">
        <button type="button" onClick={() => setFiltro("todos")} className="kpi k-acc" style={{ cursor: "pointer", textAlign: "left", border: filtro === "todos" ? "1px solid var(--accent)" : undefined }}>
          <div className="k-lbl">📋 Total</div><div className="k-val">{resumo.total}</div>
        </button>
        {cards.map((c) => {
          const meta = BUCKET_META[c.key];
          return (
            <button key={c.key} type="button" onClick={() => setFiltro(filtro === c.key ? "todos" : c.key)} className="kpi" style={{ cursor: "pointer", textAlign: "left", borderLeft: `3px solid ${meta.cor}`, border: filtro === c.key ? `1px solid ${meta.cor}` : undefined }}>
              <div className="k-lbl">{c.icon} {meta.label}</div>
              <div className="k-val" style={{ color: meta.cor }}>{c.n}</div>
            </button>
          );
        })}
      </div>

      <div className="panel">
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>⏳ Carregando envios…</div>
        ) : lista.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
            {resumo.total === 0 ? "Nenhum envio sincronizado. Clique em Atualizar." : "Nenhum envio nesse filtro."}
          </div>
        ) : (
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="tbl-modern">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Data</th>
                  <th style={{ textAlign: "left" }}>Produto</th>
                  <th style={{ textAlign: "left" }}>Status</th>
                  <th style={{ textAlign: "left" }}>Previsão de entrega</th>
                  <th style={{ textAlign: "left" }}>Entregue em</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((e) => {
                  const meta = BUCKET_META[e.bucket];
                  return (
                    <tr key={e.order_id}>
                      <td style={{ textAlign: "left", color: "var(--muted)", whiteSpace: "nowrap" }}>{e.data.split("-").reverse().join("/")}</td>
                      <td style={{ textAlign: "left", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <span style={{ fontWeight: 600 }} title={e.produto}>{e.produto || "—"}</span>
                        <span style={{ display: "block", fontSize: ".68rem", color: "var(--muted)" }}>#{e.order_id}{e.tracking ? ` · ${e.tracking}` : ""}</span>
                      </td>
                      <td style={{ textAlign: "left" }}>
                        <span style={{ display: "inline-block", fontSize: ".72rem", fontWeight: 700, color: meta.cor, background: `${meta.cor}1f`, border: `1px solid ${meta.cor}`, borderRadius: 6, padding: "1px 8px" }}>
                          {STATUS_LABEL[e.status] ?? meta.label}
                        </span>
                      </td>
                      <td style={{ textAlign: "left", color: "var(--muted)", whiteSpace: "nowrap" }}>{e.estimated ? e.estimated.split("-").reverse().join("/") : "—"}</td>
                      <td style={{ textAlign: "left", color: e.entregaEm ? "var(--green)" : "var(--muted)", whiteSpace: "nowrap", fontWeight: e.entregaEm ? 600 : 400 }}>{e.entregaEm ? e.entregaEm.split("-").reverse().join("/") : "—"}</td>
                      <td style={{ color: "var(--green)", fontWeight: 600 }}>{fmtBRL(e.valor)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
