"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtBRL } from "@/lib/domain/calc";
import { authedFetch } from "@/lib/api/authed-fetch";

type Envio = {
  id: string;
  status: string;
  declaradas: number;
  aptas: number | null;
  warehouse: string;
  dataReservada: string;
  custo: number;
};
type Resumo = { agendados: number; preparando: number; aCaminho: number; recebendo: number; finalizado: number; cancelado: number; total: number };

function statusLabel(s: string): { txt: string; cor: string } {
  const l = s.toLowerCase();
  if (l.includes("cancel")) return { txt: "Cancelado", cor: "var(--red)" };
  if (l.includes("final") || l.includes("processed") || l.includes("closed")) return { txt: "Processamento finalizado", cor: "var(--green)" };
  if (l.includes("recei") || l.includes("receb") || l.includes("pending")) return { txt: "Recebimento pendente", cor: "var(--yellow)" };
  if (l.includes("prepar") || l.includes("handling") || l.includes("draft")) return { txt: "Em preparação", cor: "#4f8ef7" };
  if (l.includes("transit") || l.includes("shipped") || l.includes("caminho")) return { txt: "A caminho", cor: "#4f8ef7" };
  return { txt: s || "—", cor: "var(--muted)" };
}

export default function GestaoFullTab() {
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [resumo, setResumo] = useState<Resumo>({ agendados: 0, preparando: 0, aCaminho: 0, recebendo: 0, finalizado: 0, cancelado: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [apiStatus, setApiStatus] = useState<number>(0);
  const [diag, setDiag] = useState<string | null>(null);

  async function runDiag() {
    setDiag("⏳ Testando endpoints do Full…");
    try {
      const r = await authedFetch("/api/ml/debug-inbound", { cache: "no-store" });
      setDiag(JSON.stringify(await r.json(), null, 2));
    } catch (e) {
      setDiag("Erro: " + String(e));
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch("/api/ml/gestao-full", { cache: "no-store" });
      if (res.ok) {
        const j = await res.json();
        setEnvios(j.envios ?? []);
        setResumo(j.resumo ?? resumo);
        setApiStatus(j.apiStatus ?? 0);
      } else { setEnvios([]); }
    } catch { setEnvios([]); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  const cards: { label: string; icon: string; n: number; cor: string }[] = [
    { label: "Agendados / preparando", icon: "🗓", n: resumo.agendados + resumo.preparando, cor: "#4f8ef7" },
    { label: "Recebimento pendente", icon: "📥", n: resumo.recebendo, cor: "var(--yellow)" },
    { label: "Finalizados", icon: "✅", n: resumo.finalizado, cor: "var(--green)" },
    { label: "Cancelados", icon: "⚠️", n: resumo.cancelado, cor: "var(--red)" },
  ];

  return (
    <div className="dash">
      <div className="dash-top">
        <div className="dash-top-left">
          <h2 style={{ fontSize: "1.15rem", fontWeight: 800 }}>🏭 Gestão Full</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={load} disabled={loading}>{loading ? "⏳ Carregando..." : "⟳ Atualizar"}</button>
          {(!loading && envios.length === 0) && (
            <button type="button" className="btn btn-xs btn-ghost" onClick={runDiag} title="Diagnóstico dos endpoints do Full">🐞 Diagnóstico</button>
          )}
        </div>
      </div>

      {diag && (
        <pre style={{ position: "relative", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontSize: ".72rem", maxHeight: 320, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--text)" }}>
          <button type="button" className="btn btn-xs btn-ghost" onClick={() => setDiag(null)} style={{ position: "absolute", right: 8, top: 8 }}>✕</button>
          {diag}
        </pre>
      )}

      <div style={{ fontSize: ".8rem", color: "var(--muted)", background: "rgba(79,142,247,.06)", border: "1px solid rgba(79,142,247,.18)", borderRadius: 8, padding: "10px 14px" }}>
        📦 Envios que você manda para o centro de distribuição do Full (agendados, em preparação, recebimento e processamento).
      </div>

      <div className="kpi-grid">
        <div className="kpi k-acc"><div className="k-lbl">📋 Total</div><div className="k-val">{resumo.total}</div></div>
        {cards.map((c) => (
          <div key={c.label} className="kpi" style={{ borderLeft: `3px solid ${c.cor}` }}>
            <div className="k-lbl">{c.icon} {c.label}</div><div className="k-val" style={{ color: c.cor }}>{c.n}</div>
          </div>
        ))}
      </div>

      <div className="panel">
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>⏳ Carregando…</div>
        ) : envios.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>
            {apiStatus && apiStatus !== 200 ? (
              <>Não foi possível ler os envios inbound (HTTP {apiStatus}).<br />Pode ser permissão do Full na sua app do ML — reconecte concedendo acesso.</>
            ) : "Nenhum envio ao Full encontrado."}
          </div>
        ) : (
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="tbl-modern">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Envio</th>
                  <th>Declaradas / Aptas</th>
                  <th style={{ textAlign: "left" }}>Data reservada</th>
                  <th>Custo aplicado</th>
                  <th style={{ textAlign: "left" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {envios.map((e) => {
                  const st = statusLabel(e.status);
                  return (
                    <tr key={e.id}>
                      <td style={{ textAlign: "left", fontWeight: 600 }}>#{e.id}</td>
                      <td>{e.declaradas}{" / "}{e.aptas == null ? "—" : <b style={{ color: e.aptas < e.declaradas ? "var(--yellow)" : "var(--green)" }}>{e.aptas}</b>}</td>
                      <td style={{ textAlign: "left", color: "var(--muted)", whiteSpace: "nowrap" }}>
                        {e.dataReservada ? e.dataReservada.split("-").reverse().join("/") : "—"}
                        {e.warehouse && <span style={{ display: "block", fontSize: ".68rem" }}>{e.warehouse}</span>}
                      </td>
                      <td style={{ color: e.custo > 0 ? "var(--red)" : "var(--muted)" }}>{e.custo > 0 ? fmtBRL(e.custo) : "—"}</td>
                      <td style={{ textAlign: "left" }}>
                        <span style={{ fontSize: ".72rem", fontWeight: 700, color: st.cor, background: `${st.cor}1f`, border: `1px solid ${st.cor}`, borderRadius: 6, padding: "1px 8px" }}>{st.txt}</span>
                      </td>
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
