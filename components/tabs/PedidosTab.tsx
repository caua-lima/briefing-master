"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtBRL } from "@/lib/domain/calc";
import { authedFetch } from "@/lib/api/authed-fetch";
import DateRangePicker from "@/components/dashboard/DateRangePicker";

type Pedido = {
  order_id: string;
  data: string;
  hora: string;
  status: string;
  produto: string;
  qtd: number;
  valor: number;
  bruto: number;
  retorno: number;      // valor − taxa − frete (o que volta)
  cmv: number;
  envio: number;
  taxaML: number;
  imposto: number;
  lucro: number;
  margem: number;
  vinculado: boolean;
};

function monthRange() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return { from: `${d.getFullYear()}-${mm}-01`, to: `${d.getFullYear()}-${mm}-${String(last).padStart(2, "0")}` };
}

export default function PedidosTab() {
  const [range, setRange] = useState(() => monthRange());
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "lucro" | "prejuizo" | "semcad">("todos");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch(`/api/ml/pedidos?from=${range.from}&to=${range.to}`, { cache: "no-store" });
      if (res.ok) setPedidos((await res.json()).pedidos ?? []);
      else setPedidos([]);
    } catch {
      setPedidos([]);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  async function atualizar() {
    setLoading(true);
    try { await authedFetch("/api/ml/sync-all", { method: "POST" }); } catch { /* ignora */ }
    await load();
  }

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return pedidos.filter((p) => {
      if (q && !(p.produto.toLowerCase().includes(q) || p.order_id.includes(q))) return false;
      if (filtro === "lucro" && p.lucro <= 0) return false;
      if (filtro === "prejuizo" && p.lucro >= 0) return false;
      if (filtro === "semcad" && p.vinculado) return false;
      return true;
    });
  }, [pedidos, busca, filtro]);

  const prejuizoN = pedidos.filter((p) => p.lucro < 0).length;
  const semCadN = pedidos.filter((p) => !p.vinculado).length;

  const totalLucro = filtrados.reduce((s, p) => s + p.lucro, 0);
  const totalValor = filtrados.reduce((s, p) => s + p.valor, 0);
  const totalRetorno = filtrados.reduce((s, p) => s + p.retorno, 0);
  const margemMedia = filtrados.length
    ? filtrados.reduce((s, p) => s + p.margem, 0) / filtrados.length
    : 0;
  const margemTag = (m: number) => (m >= 20 ? "tag-g" : m >= 10 ? "tag-y" : "tag-r");

  return (
    <div className="dash">
      {/* Topo */}
      <div className="dash-top">
        <div className="dash-top-left">
          <h2 style={{ fontSize: "1.15rem", fontWeight: 800 }}>Pedidos</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={atualizar} disabled={loading}>
            {loading ? "Atualizando..." : "⟳ Atualizar"}
          </button>
        </div>
        <DateRangePicker from={range.from} to={range.to} onApply={(from, to) => setRange({ from, to })} />
      </div>

      {/* Resumo */}
      <div className="kpi-grid">
        <div className="kpi k-acc"><div className="k-lbl">Pedidos</div><div className="k-val">{filtrados.length}</div></div>
        <div className="kpi k-acc"><div className="k-lbl">Faturamento</div><div className="k-val">{fmtBRL(totalValor)}</div><div className="k-sub">bruto</div></div>
        <div className="kpi k-pos"><div className="k-lbl">Retorno</div><div className="k-val" style={{ color: "var(--green)" }}>{fmtBRL(totalRetorno)}</div><div className="k-sub">líquido que volta</div></div>
        <div className={`kpi ${totalLucro >= 0 ? "k-pos" : "k-neg"}`}><div className="k-lbl">Lucro líquido</div><div className="k-val" style={{ color: totalLucro >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(totalLucro)}</div><div className="k-sub">retorno − custos</div></div>
        <div className="kpi k-warn"><div className="k-lbl">Margem média</div><div className="k-val" style={{ color: "var(--yellow)" }}>{margemMedia.toFixed(1)}%</div></div>
        <div className="kpi k-acc"><div className="k-lbl">Ticket médio</div><div className="k-val">{fmtBRL(filtrados.length ? totalValor / filtrados.length : 0)}</div><div className="k-sub">por pedido</div></div>
      </div>

      {/* Busca + filtros */}
      <input
        type="text" placeholder="Buscar por produto ou nº do pedido…" value={busca}
        onChange={(e) => setBusca(e.target.value)}
        style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 14px", color: "var(--text)", fontSize: ".9rem", outline: "none", boxSizing: "border-box" }}
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {([
          ["todos", `Todos (${pedidos.length})`, "var(--accent)"],
          ["lucro", "Lucrativos", "var(--green)"],
          ["prejuizo", `Prejuízo (${prejuizoN})`, "var(--red)"],
          ["semcad", `Sem cadastro (${semCadN})`, "var(--yellow)"],
        ] as const).map(([id, label, cor]) => (
          <button
            key={id} type="button" onClick={() => setFiltro(id)}
            style={{
              fontSize: ".78rem", fontWeight: 600, padding: "5px 12px", borderRadius: 20, cursor: "pointer",
              background: filtro === id ? cor : "var(--surface2)", color: filtro === id ? "#fff" : "var(--muted)",
              border: `1px solid ${filtro === id ? cor : "var(--border)"}`,
            }}
          >{label}</button>
        ))}
      </div>

      {/* Tabela */}
      <div className="panel">
        <div style={{ fontSize: ".76rem", color: "var(--muted)", marginBottom: 12 }}>
          <b>Retorno</b> = Valor − Taxa ML − Frete · <b>Custos</b> = CMV + Frete + Taxa + Imposto (passe o mouse pra ver o detalhe) · <b>Lucro</b> = Valor − Custos
        </div>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Carregando pedidos…</div>
        ) : filtrados.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Nenhum pedido no período.</div>
        ) : (
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="tbl-modern">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Data</th>
                  <th style={{ textAlign: "left" }}>Produto</th>
                  <th>Qtd</th>
                  <th style={{ textAlign: "right" }}>Valor</th>
                  <th style={{ textAlign: "right" }}>Retorno</th>
                  <th style={{ textAlign: "right" }}>Custos</th>
                  <th style={{ textAlign: "right" }}>Lucro líq.</th>
                  <th>Margem</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((p) => {
                  const custos = p.cmv + p.envio + p.taxaML + p.imposto;
                  const prej = p.lucro < 0;
                  return (
                    <tr key={p.order_id} style={{ background: prej ? "rgba(239,68,68,.05)" : undefined, boxShadow: `inset 3px 0 0 ${prej ? "var(--red)" : "var(--green)"}` }}>
                      <td style={{ textAlign: "left", color: "var(--muted)", whiteSpace: "nowrap", fontSize: ".82rem" }}>
                        {p.data.split("-").reverse().join("/")}<span style={{ fontSize: ".68rem", display: "block", opacity: .7 }}>{p.hora}</span>
                      </td>
                      <td style={{ textAlign: "left", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <span style={{ fontWeight: 600 }} title={p.produto}>{p.produto || "—"}</span>
                        {!p.vinculado && <span style={{ marginLeft: 6, fontSize: ".6rem", fontWeight: 700, color: "#f7c948", background: "rgba(247,201,72,.12)", padding: "1px 6px", borderRadius: 5, verticalAlign: "middle" }}>SEM CADASTRO</span>}
                        <span style={{ display: "block", fontSize: ".66rem", color: "var(--muted)" }}>#{p.order_id}</span>
                      </td>
                      <td style={{ color: "var(--muted)" }}>{p.qtd}</td>
                      <td style={{ textAlign: "right", color: "var(--text)", whiteSpace: "nowrap" }}>{fmtBRL(p.valor)}</td>
                      <td style={{ textAlign: "right", color: "var(--text)", fontWeight: 600, whiteSpace: "nowrap" }}>{fmtBRL(p.retorno)}</td>
                      <td style={{ textAlign: "right", color: "var(--red)", whiteSpace: "nowrap", cursor: "help" }} title={`CMV ${fmtBRL(p.cmv)}  ·  Frete ${fmtBRL(p.envio)}  ·  Taxa ML ${fmtBRL(p.taxaML)}  ·  Imposto ${fmtBRL(p.imposto)}`}>
                        −{fmtBRL(custos)}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 800, whiteSpace: "nowrap", color: p.lucro >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(p.lucro)}</td>
                      <td><span className={`tag ${margemTag(p.margem)}`}>{p.margem.toFixed(1)}%</span></td>
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
