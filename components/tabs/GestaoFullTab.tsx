"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";

type Item = { mlb: string; title: string; available: number; sold: number; status: string; inventory_id: string };
type Receb = { data: string; quantidade: number; inventory_id: string; tipo: string };

function statusLabel(s: string): { txt: string; cor: string } {
  const l = s.toLowerCase();
  if (l === "active") return { txt: "Ativo", cor: "var(--green)" };
  if (l === "paused") return { txt: "Pausado", cor: "var(--yellow)" };
  if (l === "closed") return { txt: "Encerrado", cor: "var(--red)" };
  if (l.includes("review")) return { txt: "Em revisão", cor: "var(--yellow)" };
  return { txt: s || "—", cor: "var(--muted)" };
}

export default function GestaoFullTab() {
  const [itens, setItens] = useState<Item[]>([]);
  const [recebimentos, setRecebimentos] = useState<Receb[]>([]);
  const [resumo, setResumo] = useState({ totalDisponivel: 0, totalVendido: 0 });
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch("/api/ml/gestao-full", { cache: "no-store" });
      if (res.ok) {
        const j = await res.json();
        setItens(j.itens ?? []);
        setRecebimentos(j.recebimentos ?? []);
        setResumo({ totalDisponivel: j.totalDisponivel ?? 0, totalVendido: j.totalVendido ?? 0 });
      } else { setItens([]); }
    } catch { setItens([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtrados = itens.filter((it) => {
    const q = busca.trim().toLowerCase();
    return !q || it.title.toLowerCase().includes(q) || it.mlb.toLowerCase().includes(q);
  });
  const semEstoque = itens.filter((it) => it.available <= 0).length;

  return (
    <div className="dash">
      <div className="dash-top">
        <div className="dash-top-left">
          <h2 style={{ fontSize: "1.15rem", fontWeight: 800 }}>🏭 Gestão Full</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={load} disabled={loading}>{loading ? "⏳ Carregando..." : "⟳ Atualizar"}</button>
        </div>
      </div>

      <div style={{ fontSize: ".8rem", color: "var(--muted)", background: "rgba(79,142,247,.06)", border: "1px solid rgba(79,142,247,.18)", borderRadius: 8, padding: "10px 14px" }}>
        📦 Estoque dos seus anúncios no Full e recebimentos (o que chegou ao centro de distribuição). A lista de <em>envios agendados</em> só existe no Seller Center — a API do ML não a expõe.
      </div>

      <div className="kpi-grid">
        <div className="kpi k-pos"><div className="k-lbl">Disponível no Full</div><div className="k-val" style={{ color: "var(--green)" }}>{resumo.totalDisponivel} un</div></div>
        <div className="kpi k-acc"><div className="k-lbl">Vendido (histórico)</div><div className="k-val">{resumo.totalVendido} un</div></div>
        <div className="kpi k-warn"><div className="k-lbl">Anúncios no Full</div><div className="k-val" style={{ color: "var(--yellow)" }}>{itens.length}</div></div>
        <div className="kpi k-neg"><div className="k-lbl">Sem estoque</div><div className="k-val" style={{ color: semEstoque > 0 ? "var(--red)" : "var(--muted)" }}>{semEstoque}</div></div>
      </div>

      <input
        type="text" placeholder="🔍 Buscar por anúncio ou MLB…" value={busca} onChange={(e) => setBusca(e.target.value)}
        style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", color: "var(--text)", fontSize: ".9rem", outline: "none", boxSizing: "border-box" }}
      />

      {/* Estoque no Full */}
      <div className="panel">
        <div className="panel-title" style={{ marginBottom: 12 }}>📦 Estoque no Full por anúncio</div>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>⏳ Carregando…</div>
        ) : filtrados.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>
            {itens.length === 0 ? "Nenhum anúncio com estoque no Full encontrado (cadastre os MLBs no Estoque)." : "Nenhum resultado para a busca."}
          </div>
        ) : (
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="tbl-modern">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Anúncio</th>
                  <th>Disponível</th><th>Vendido</th>
                  <th style={{ textAlign: "left" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((it) => {
                  const st = statusLabel(it.status);
                  return (
                    <tr key={it.mlb}>
                      <td style={{ textAlign: "left", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <span style={{ fontWeight: 600 }} title={it.title}>{it.title || "—"}</span>
                        <span style={{ display: "block", fontSize: ".68rem", color: "var(--muted)" }}>{it.mlb}</span>
                      </td>
                      <td style={{ fontWeight: 700, color: it.available > 0 ? "var(--green)" : "var(--red)" }}>{it.available} un</td>
                      <td style={{ color: "var(--muted)" }}>{it.sold}</td>
                      <td style={{ textAlign: "left" }}><span style={{ fontSize: ".72rem", fontWeight: 700, color: st.cor, background: `${st.cor}1f`, border: `1px solid ${st.cor}`, borderRadius: 6, padding: "1px 8px" }}>{st.txt}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recebimentos */}
      {recebimentos.length > 0 && (
        <div className="panel">
          <div className="panel-title" style={{ marginBottom: 12 }}>📥 Recebimentos no Full (últimos 90 dias)</div>
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="tbl-modern">
              <thead><tr><th style={{ textAlign: "left" }}>Data</th><th style={{ textAlign: "left" }}>Inventory</th><th>Quantidade</th></tr></thead>
              <tbody>
                {recebimentos.map((r, i) => (
                  <tr key={r.inventory_id + r.data + i}>
                    <td style={{ textAlign: "left", color: "var(--muted)" }}>{r.data ? r.data.split("-").reverse().join("/") : "—"}</td>
                    <td style={{ textAlign: "left", color: "var(--muted)", fontSize: ".78rem" }}>{r.inventory_id}</td>
                    <td style={{ color: "var(--green)", fontWeight: 700 }}>+{r.quantidade} un</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
