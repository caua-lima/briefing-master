"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtBRL } from "@/lib/domain/calc";
import { authedFetch } from "@/lib/api/authed-fetch";
import { watchFinanceiroManual, saveFinanceiroManual, type FinanceiroManual } from "@/lib/firebase/data";

function parseBR(s: string): number {
  const n = parseFloat(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

type Repasse = {
  order_id: string;
  data: string;
  produto: string;
  bruto: number;
  taxaML: number;
  envio: number;
  liquido: number;
  exato: boolean;
  repasseEm: string;
  status: "liberado" | "pendente" | "sem_data";
};
type Resumo = { bruto: number; liquido: number; liberado: number; aReceber: number; semData: number; exatos: number; count: number };
type Agenda = { data: string; liquido: number; pedidos: number; pendente?: boolean };
type GlobalCF = { aReceber: number; pedidos: number; exatos: number };
type FluxoMP = { ok: boolean; aReceber?: number; liberado?: number; pendentes?: number; aprovados?: number; count?: number; totalMp?: number; agenda?: Agenda[]; status?: number; error?: string };

function isoOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function monthRange() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return { from: `${d.getFullYear()}-${mm}-01`, to: `${d.getFullYear()}-${mm}-${String(last).padStart(2, "0")}` };
}
function br(d: string) {
  return d ? d.split("-").reverse().join("/") : "—";
}
function fmtDia(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const wd = new Date(y, m - 1, d).toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  return `${wd} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

type Periodo = "hoje" | "mes" | "custom";

const STATUS_META: Record<Repasse["status"], { label: string; cor: string }> = {
  liberado: { label: "Liberado", cor: "var(--green)" },
  pendente: { label: "A receber", cor: "var(--yellow)" },
  sem_data: { label: "Sem data", cor: "var(--muted)" },
};

export default function FinanceiroTab() {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [repasses, setRepasses] = useState<Repasse[]>([]);
  const [resumo, setResumo] = useState<Resumo>({ bruto: 0, liquido: 0, liberado: 0, aReceber: 0, semData: 0, exatos: 0, count: 0 });
  const [agenda, setAgenda] = useState<Agenda[]>([]);
  const [agendaTotal, setAgendaTotal] = useState<Agenda[]>([]);
  const [globalCF, setGlobalCF] = useState<GlobalCF>({ aReceber: 0, pedidos: 0, exatos: 0 });
  const [fluxoMP, setFluxoMP] = useState<FluxoMP | null>(null);
  const [manual, setManual] = useState<FinanceiroManual>({ saldoConta: 0, cofrinho: 0 });
  const [editSaldo, setEditSaldo] = useState(false);
  const [saldoInput, setSaldoInput] = useState("");
  const [cofrinhoInput, setCofrinhoInput] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => watchFinanceiroManual(setManual), []);

  async function salvarManual() {
    try {
      await saveFinanceiroManual({ saldoConta: parseBR(saldoInput), cofrinho: parseBR(cofrinhoInput) });
      setEditSaldo(false);
    } catch (e) {
      alert("Erro ao salvar: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  const loadSaldo = useCallback(async () => {
    try {
      const r = await authedFetch("/api/ml/mp-fluxo", { cache: "no-store" });
      if (r.ok) setFluxoMP(await r.json());
    } catch { /* ignora */ }
  }, []);

  const range = useMemo(() => {
    const today = isoOf(new Date());
    if (periodo === "hoje") return { from: today, to: today };
    if (periodo === "custom" && customFrom && customTo) return { from: customFrom, to: customTo };
    return monthRange();
  }, [periodo, customFrom, customTo]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch(`/api/ml/financeiro?from=${range.from}&to=${range.to}`, { cache: "no-store" });
      if (res.ok) {
        const j = await res.json();
        setRepasses(j.repasses ?? []);
        setResumo(j.resumo ?? { bruto: 0, liquido: 0, liberado: 0, aReceber: 0, semData: 0, exatos: 0, count: 0 });
        setAgenda(j.agenda ?? []);
        setAgendaTotal(j.agendaTotal ?? []);
        setGlobalCF(j.global ?? { aReceber: 0, pedidos: 0, exatos: 0 });
      } else { setRepasses([]); setAgenda([]); setAgendaTotal([]); }
    } catch { setRepasses([]); setAgenda([]); setAgendaTotal([]); } finally { setLoading(false); }
  }, [range]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadSaldo(); }, [loadSaldo]);

  async function atualizar() {
    setLoading(true);
    try { await authedFetch("/api/ml/sync-all", { method: "POST" }); } catch { /* ignora */ }
    await Promise.all([load(), loadSaldo()]);
  }

  const hoje = isoOf(new Date());
  // Se o MP respondeu, usa a agenda real dele (inclui Pix); senão, a reconstruída.
  const proximos = (fluxoMP?.ok ? (fluxoMP.agenda ?? []) : agendaTotal).filter((a) => a.data >= hoje);

  return (
    <div className="dash">
      <div className="dash-top">
        <div className="dash-top-left">
          <h2 style={{ fontSize: "1.15rem", fontWeight: 800 }}>💰 Financeiro</h2>
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

      {/* Saldo da conta + Cofrinho (manual — o MP não expõe pela API) */}
      <div>
        <div className="panel-head" style={{ marginBottom: 8 }}>
          <span className="panel-title">💰 Saldo & Cofrinho</span>
          {!editSaldo ? (
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => { setSaldoInput(manual.saldoConta ? String(manual.saldoConta) : ""); setCofrinhoInput(manual.cofrinho ? String(manual.cofrinho) : ""); setEditSaldo(true); }}>✏️ Editar</button>
          ) : (
            <span style={{ display: "flex", gap: 6 }}>
              <button type="button" className="btn btn-success btn-xs" onClick={salvarManual}>💾 Salvar</button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEditSaldo(false)}>✕</button>
            </span>
          )}
        </div>
        <div className="kpi-grid">
          <div className="kpi k-pos">
            <div className="k-lbl">🏦 Saldo disponível</div>
            {editSaldo
              ? <input type="number" step="0.01" placeholder="0,00" value={saldoInput} onChange={(e) => setSaldoInput(e.target.value)} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: "1.2rem", fontWeight: 800, width: "100%", outline: "none" }} />
              : <div className="k-val" style={{ color: "var(--green)" }}>{fmtBRL(manual.saldoConta)}</div>}
            <div className="k-sub">na conta MP · manual</div>
          </div>
          <div className="kpi k-acc">
            <div className="k-lbl">🐷 Cofrinho</div>
            {editSaldo
              ? <input type="number" step="0.01" placeholder="0,00" value={cofrinhoInput} onChange={(e) => setCofrinhoInput(e.target.value)} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: "1.2rem", fontWeight: 800, width: "100%", outline: "none" }} />
              : <div className="k-val">{fmtBRL(manual.cofrinho)}</div>}
            <div className="k-sub">reservado/rendendo · manual</div>
          </div>
        </div>
      </div>

      {/* Fluxo REAL do Mercado Pago (inclui Pix) via /v1/payments/search */}
      {fluxoMP?.ok && (
        <div>
          <div className="panel-head" style={{ marginBottom: 8 }}>
            <span className="panel-title">💳 Mercado Pago</span>
            <span className="panel-sub">direto do MP · inclui Pix e vendas</span>
          </div>
          <div className="kpi-grid">
            <div className="kpi k-warn"><div className="k-lbl">⏳ A receber</div><div className="k-val" style={{ color: "var(--yellow)" }}>{fmtBRL(fluxoMP.aReceber ?? 0)}</div><div className="k-sub">{fluxoMP.pendentes ?? 0} lançamento(s) futuros</div></div>
            <div className="kpi k-pos"><div className="k-lbl">✅ Já liberado (90d)</div><div className="k-val" style={{ color: "var(--green)" }}>{fmtBRL(fluxoMP.liberado ?? 0)}</div><div className="k-sub">líquido que já caiu (últimos 90 dias)</div></div>
          </div>
          {(fluxoMP.count ?? 0) === 0 && (
            <div style={{ padding: "8px 12px", background: "rgba(100,116,139,.12)", border: "1px solid var(--border)", borderRadius: 8, fontSize: ".76rem", color: "var(--muted)", marginTop: 10 }}>
              🔎 O MP respondeu, mas trouxe <b>0 pagamentos</b> (total reportado: {fluxoMP.totalMp ?? 0}). Provável que o <b>MP_ACCESS_TOKEN seja de outra aplicação/conta</b> que não é a que recebe as vendas. Precisa ser o token de <b>produção da conta VaZXPress</b> (a mesma que recebe no Mercado Pago).
            </div>
          )}
        </div>
      )}

      {/* Sem acesso ao MP → mostra o total a receber estimado dos pedidos do ML */}
      {(!fluxoMP || !fluxoMP.ok) && (
        <div>
          <div className="panel-head" style={{ marginBottom: 8 }}>
            <span className="panel-title">💰 A receber (total)</span>
            <span className="panel-sub">todos os repasses futuros dos pedidos do ML</span>
          </div>
          <div className="kpi-grid">
            <div className="kpi k-warn"><div className="k-lbl">⏳ A receber (total)</div><div className="k-val" style={{ color: "var(--yellow)" }}>{fmtBRL(globalCF.aReceber)}</div><div className="k-sub">{globalCF.pedidos} pedido(s) a liberar</div></div>
          </div>
          {fluxoMP && !fluxoMP.ok && (
            <div style={{ padding: "8px 12px", background: "rgba(100,116,139,.12)", border: "1px solid var(--border)", borderRadius: 8, fontSize: ".76rem", color: "var(--muted)", marginTop: 10 }}>
              ℹ️ Ainda não li o fluxo direto do Mercado Pago
              {fluxoMP.error === "sem_mp_token" ? " (falta configurar o MP_ACCESS_TOKEN na Vercel)" : fluxoMP.status ? ` (HTTP ${fluxoMP.status})` : ""}.
              O valor acima é <b>estimado dos seus pedidos do ML</b> (sem Pix). Assim que o MP responder, este bloco vira o número real.
            </div>
          )}
        </div>
      )}

      {/* Reconstruído pelos pedidos do ML — detalhe do período selecionado */}
      <div className="panel-head" style={{ marginBottom: -4 }}>
        <span className="panel-title">🧾 Pelos pedidos do ML — período</span>
        <span className="panel-sub">detalhe estimado por pedido (pode diferir do saldo do MP)</span>
      </div>
      <div className="kpi-grid">
        <div className="kpi k-warn"><div className="k-lbl">⏳ A receber (período)</div><div className="k-val" style={{ color: "var(--yellow)" }}>{fmtBRL(resumo.aReceber)}</div><div className="k-sub">líquido, ainda não liberado</div></div>
        <div className="kpi k-pos"><div className="k-lbl">✅ Já liberado (período)</div><div className="k-val" style={{ color: "var(--green)" }}>{fmtBRL(resumo.liberado)}</div><div className="k-sub">repasse já na data</div></div>
        <div className="kpi k-acc"><div className="k-lbl">Σ Líquido do período</div><div className="k-val">{fmtBRL(resumo.liquido)}</div><div className="k-sub">{resumo.count} pedido(s)</div></div>
        <div className="kpi k-neg"><div className="k-lbl">Bruto do período</div><div className="k-val">{fmtBRL(resumo.bruto)}</div><div className="k-sub">antes de taxas/frete</div></div>
      </div>

      {resumo.semData > 0 && (
        <div style={{ padding: "8px 12px", background: "rgba(100,116,139,.12)", border: "1px solid var(--border)", borderRadius: 8, fontSize: ".78rem", color: "var(--muted)" }}>
          ℹ️ {fmtBRL(resumo.semData)} em pedidos ainda sem data de repasse definida pelo Mercado Pago (aparecem como “sem data” na lista).
        </div>
      )}

      {/* Próximos repasses (agenda) */}
      <div className="panel">
        <div className="panel-head" style={{ marginBottom: 12 }}>
          <span className="panel-title">📅 Próximos repasses</span>
          <span className="panel-sub">quando e quanto cai no Mercado Pago{fluxoMP?.ok ? " · líquido real, inclui Pix" : " · líquido estimado"}</span>
        </div>
        {proximos.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: ".82rem", padding: "6px 0" }}>Nenhum repasse futuro no período selecionado.</div>
        ) : (() => {
          const totalProx = proximos.reduce((s, a) => s + a.liquido, 0);
          const maxV = Math.max(...proximos.map((a) => a.liquido), 1);
          return (
            <>
              <div style={{ fontSize: ".8rem", color: "var(--muted)", marginBottom: 12 }}>
                Total: <b style={{ color: "var(--yellow)" }}>{fmtBRL(totalProx)}</b> em {proximos.length} data(s) · {proximos.reduce((s, a) => s + a.pedidos, 0)} pedido(s)
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))", gap: 10 }}>
                {proximos.map((a) => (
                  <div key={a.data} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: "11px 13px", display: "flex", flexDirection: "column", gap: 7 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
                      <span style={{ fontSize: ".76rem", fontWeight: 700, color: "var(--text)", textTransform: "capitalize" }}>{fmtDia(a.data)}</span>
                      <span style={{ fontSize: ".64rem", color: "var(--muted)", whiteSpace: "nowrap" }}>{a.pedidos} ped.</span>
                    </div>
                    <div style={{ fontSize: "1.18rem", fontWeight: 800, color: "var(--green)", lineHeight: 1.1 }}>{fmtBRL(a.liquido)}</div>
                    <div style={{ height: 5, borderRadius: 99, background: "var(--surface)", overflow: "hidden" }}>
                      <div style={{ width: `${Math.max(6, (a.liquido / maxV) * 100)}%`, height: "100%", background: "linear-gradient(90deg, var(--green), #34d399)" }} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          );
        })()}
      </div>

      {/* Detalhe por pedido */}
      <div className="panel">
        <div className="panel-title" style={{ marginBottom: 10 }}>🧾 Repasses por pedido</div>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>⏳ Carregando…</div>
        ) : repasses.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Nenhum pedido no período. Clique em Atualizar.</div>
        ) : (
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="tbl-modern">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Pedido</th>
                  <th style={{ textAlign: "left" }}>Produto</th>
                  <th>Bruto</th><th>Taxa+Frete</th><th>Líquido</th>
                  <th style={{ textAlign: "left" }}>💰 Repasse em</th>
                  <th style={{ textAlign: "left" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {repasses.map((r) => {
                  const meta = STATUS_META[r.status];
                  return (
                    <tr key={r.order_id}>
                      <td style={{ textAlign: "left", color: "var(--muted)", whiteSpace: "nowrap" }}>
                        {br(r.data)}<span style={{ display: "block", fontSize: ".66rem" }}>#{r.order_id}</span>
                      </td>
                      <td style={{ textAlign: "left", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.produto}>{r.produto || "—"}</td>
                      <td style={{ color: "var(--muted)" }}>{fmtBRL(r.bruto)}</td>
                      <td style={{ color: "var(--red)" }}>{fmtBRL(r.taxaML + r.envio)}</td>
                      <td style={{ color: "var(--green)", fontWeight: 700, whiteSpace: "nowrap" }}>
                        {fmtBRL(r.liquido)}
                        {!r.exato && <span title="Estimado (bruto − taxa − frete)" style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 4, fontSize: ".7rem" }}>~</span>}
                      </td>
                      <td style={{ textAlign: "left", whiteSpace: "nowrap", fontWeight: r.repasseEm ? 600 : 400, color: r.repasseEm ? "var(--text)" : "var(--muted)" }}>{br(r.repasseEm)}</td>
                      <td style={{ textAlign: "left" }}>
                        <span style={{ fontSize: ".72rem", fontWeight: 700, color: meta.cor, background: `${meta.cor}1f`, border: `1px solid ${meta.cor}`, borderRadius: 6, padding: "1px 8px" }}>{meta.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: 10, fontSize: ".72rem", color: "var(--muted)" }}>
          Líquido <b>exato</b> vem do Mercado Pago (net recebido por pagamento) — {resumo.exatos} de {resumo.count} pedido(s). Os marcados com <b>~</b> ainda estão estimados (bruto − taxa ML − frete) e viram exatos nas próximas sincronizações.
        </div>
      </div>
    </div>
  );
}
