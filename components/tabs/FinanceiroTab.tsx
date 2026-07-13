"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { fmtBRL } from "@/lib/domain/calc";
import { authedFetch } from "@/lib/api/authed-fetch";
import DateRangePicker from "@/components/dashboard/DateRangePicker";
import { watchFinanceiroManual, saveFinanceiroBase, saveFinanceiroSaidas, type FinanceiroManual, type SaidaFin } from "@/lib/firebase/data";

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
type FluxoMP = { ok: boolean; aReceber?: number; liberado?: number; liberadoDesde?: number; pendentes?: number; aprovados?: number; count?: number; totalMp?: number; agenda?: Agenda[]; status?: number; error?: string };

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

const inpBase: CSSProperties = { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", color: "var(--text)", fontSize: "1.05rem", fontWeight: 800, width: "100%", outline: "none", marginTop: 4 };

const STATUS_META: Record<Repasse["status"], { label: string; cor: string }> = {
  liberado: { label: "Liberado", cor: "var(--green)" },
  pendente: { label: "A receber", cor: "var(--yellow)" },
  sem_data: { label: "Sem data", cor: "var(--muted)" },
};

export default function FinanceiroTab() {
  const [range, setRange] = useState(() => monthRange());
  const [repasses, setRepasses] = useState<Repasse[]>([]);
  const [resumo, setResumo] = useState<Resumo>({ bruto: 0, liquido: 0, liberado: 0, aReceber: 0, semData: 0, exatos: 0, count: 0 });
  const [agenda, setAgenda] = useState<Agenda[]>([]);
  const [agendaTotal, setAgendaTotal] = useState<Agenda[]>([]);
  const [globalCF, setGlobalCF] = useState<GlobalCF>({ aReceber: 0, pedidos: 0, exatos: 0 });
  const [fluxoMP, setFluxoMP] = useState<FluxoMP | null>(null);
  const [manual, setManual] = useState<FinanceiroManual>({ cofrinhoBase: 0, baseTs: 0, saldoConta: 0, cdiAnual: 0, saidas: [] });
  const [editBase, setEditBase] = useState(false);
  const [baseIn, setBaseIn] = useState({ cofrinho: "", cdi: "", saldo: "" });
  const [novaSaida, setNovaSaida] = useState({ data: isoOf(new Date()), valor: "", desc: "" });
  const [loading, setLoading] = useState(true);
  type DiagPend = { id: string; dia: string; liquido: number; bruto: number; tipo: string; parcelas: number; relStatus: string };
  const [diagPend, setDiagPend] = useState<DiagPend[] | null>(null);
  const [diagOpen, setDiagOpen] = useState(false);

  async function carregarDiag() {
    setDiagOpen(true);
    try {
      const r = await authedFetch(`/api/ml/mp-fluxo?desde=${manual.baseTs || 0}&debug=1`, { cache: "no-store" });
      if (r.ok) { const j = await r.json(); setDiagPend(j.pend ?? []); }
    } catch { /* ignora */ }
  }

  useEffect(() => watchFinanceiroManual(setManual), []);

  async function salvarBase() {
    try {
      await saveFinanceiroBase({ cofrinhoBase: parseBR(baseIn.cofrinho), cdiAnual: parseBR(baseIn.cdi), saldoConta: parseBR(baseIn.saldo) });
      setEditBase(false);
    } catch (e) { alert("Erro ao salvar: " + (e instanceof Error ? e.message : String(e))); }
  }
  async function addSaida() {
    const valor = parseBR(novaSaida.valor);
    if (!valor || valor <= 0) { alert("Informe o valor da saída."); return; }
    const nova: SaidaFin = { id: "s" + Date.now(), data: novaSaida.data, valor, desc: novaSaida.desc.trim() || undefined };
    try {
      await saveFinanceiroSaidas([...(manual.saidas ?? []), nova]);
      setNovaSaida({ data: isoOf(new Date()), valor: "", desc: "" });
    } catch (e) { alert("Erro ao salvar saída: " + (e instanceof Error ? e.message : String(e))); }
  }
  async function removeSaida(id: string) {
    try { await saveFinanceiroSaidas((manual.saidas ?? []).filter((s) => s.id !== id)); }
    catch (e) { alert("Erro ao remover: " + (e instanceof Error ? e.message : String(e))); }
  }

  const loadSaldo = useCallback(async (desde: number) => {
    try {
      const r = await authedFetch(`/api/ml/mp-fluxo?desde=${desde || 0}`, { cache: "no-store" });
      if (r.ok) setFluxoMP(await r.json());
    } catch { /* ignora */ }
  }, []);

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
  useEffect(() => { loadSaldo(manual.baseTs); }, [loadSaldo, manual.baseTs]);

  async function atualizar() {
    setLoading(true);
    try { await authedFetch("/api/ml/sync-all", { method: "POST" }); } catch { /* ignora */ }
    await Promise.all([load(), loadSaldo(manual.baseTs)]);
  }

  const hoje = isoOf(new Date());
  // Se o MP respondeu, usa a agenda real dele (inclui Pix); senão, a reconstruída.
  const proximos = (fluxoMP?.ok ? (fluxoMP.agenda ?? []) : agendaTotal).filter((a) => a.data >= hoje);

  // ── Cofrinho automático = base + liberado desde a base − saídas + rendimento ──
  const saidasTotal = (manual.saidas ?? []).reduce((s, x) => s + (x.valor || 0), 0);
  const liberadoDesde = manual.baseTs > 0 ? (fluxoMP?.liberadoDesde ?? 0) : 0;
  const diasBase = manual.baseTs > 0 ? Math.max(0, (Date.now() - manual.baseTs) / 86400000) : 0;
  const taxaDia = manual.cdiAnual > 0 ? (manual.cdiAnual / 100) * 1.2 / 365 : 0;
  const saldoMedio = manual.cofrinhoBase + liberadoDesde / 2;         // aporte entra gradual
  const rendimento = manual.baseTs > 0 ? saldoMedio * taxaDia * diasBase : 0;
  const cofrinhoAtual = manual.cofrinhoBase + liberadoDesde - saidasTotal + rendimento;
  const semBase = manual.baseTs === 0;

  return (
    <div className="dash">
      <div className="dash-top">
        <div className="dash-top-left">
          <h2 style={{ fontSize: "1.15rem", fontWeight: 800 }}>Financeiro</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={atualizar} disabled={loading}>
            {loading ? "Atualizando..." : "⟳ Atualizar"}
          </button>
        </div>
        <DateRangePicker from={range.from} to={range.to} onApply={(from, to) => setRange({ from, to })} />
      </div>

      {/* Saldo da conta + Cofrinho (manual — o MP não expõe pela API) */}
      {/* Cofrinho automático + saldo da conta */}
      <div className="panel">
        <div className="panel-head" style={{ marginBottom: 12 }}>
          <span className="panel-title">Cofrinho & Saldo</span>
          {!editBase ? (
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => { setBaseIn({ cofrinho: manual.cofrinhoBase ? String(manual.cofrinhoBase) : "", cdi: manual.cdiAnual ? String(manual.cdiAnual) : "", saldo: manual.saldoConta ? String(manual.saldoConta) : "" }); setEditBase(true); }}>
              {semBase ? "＋ Definir base" : "Re-sincronizar base"}
            </button>
          ) : (
            <span style={{ display: "flex", gap: 6 }}>
              <button type="button" className="btn btn-success btn-xs" onClick={salvarBase}>Salvar base</button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEditBase(false)}>Cancelar</button>
            </span>
          )}
        </div>

        {editBase ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 4 }}>
            <label style={{ fontSize: ".75rem", color: "var(--muted)" }}>Cofrinho hoje (R$)
              <input type="number" step="0.01" placeholder="Ex: 1298,07" value={baseIn.cofrinho} onChange={(e) => setBaseIn({ ...baseIn, cofrinho: e.target.value })} style={inpBase} />
            </label>
            <label style={{ fontSize: ".75rem", color: "var(--muted)" }}>CDI anual (%)
              <input type="number" step="0.01" placeholder="Ex: 15" value={baseIn.cdi} onChange={(e) => setBaseIn({ ...baseIn, cdi: e.target.value })} style={inpBase} />
            </label>
            <label style={{ fontSize: ".75rem", color: "var(--muted)" }}>Saldo na conta (R$)
              <input type="number" step="0.01" placeholder="Ex: 0" value={baseIn.saldo} onChange={(e) => setBaseIn({ ...baseIn, saldo: e.target.value })} style={inpBase} />
            </label>
            <div style={{ gridColumn: "1/-1", fontSize: ".72rem", color: "var(--muted)" }}>
              Ao salvar, fixo o valor de agora como base — daí pra frente eu somo os repasses liberados e o rendimento sozinho, e você só lança as <b>saídas</b>. Re-sincronize quando quiser (zera as saídas).
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <div style={{ flex: "2 1 280px", borderRadius: 14, padding: "18px 20px", background: "radial-gradient(900px 300px at 0% 0%, rgba(167,139,250,.12), transparent), var(--surface2)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: ".7rem", textTransform: "uppercase", letterSpacing: ".06em", color: "var(--muted)", fontWeight: 700 }}>Cofrinho (estimado)</div>
              <div style={{ fontSize: "2rem", fontWeight: 800, color: "var(--purple)", lineHeight: 1.1, marginTop: 4 }}>{fmtBRL(cofrinhoAtual)}</div>
              <div style={{ fontSize: ".72rem", color: "var(--muted)", marginTop: 2 }}>
                {semBase ? "defina a base pra começar" : `base ${br(isoOf(new Date(manual.baseTs)))} · rende 120% do CDI`}
              </div>
              {!semBase && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14, fontSize: ".74rem" }}>
                  {[
                    ["base", fmtBRL(manual.cofrinhoBase), "var(--muted)"],
                    ["+ liberado", fmtBRL(liberadoDesde), "var(--green)"],
                    ["− saídas", fmtBRL(saidasTotal), "var(--red)"],
                    ["+ rendimento", fmtBRL(rendimento), "var(--purple)"],
                  ].map(([lbl, val, cor]) => (
                    <span key={lbl} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "4px 10px" }}>
                      <span style={{ color: "var(--muted)" }}>{lbl} </span><b style={{ color: cor }}>{val}</b>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div style={{ flex: "1 1 170px", borderRadius: 14, padding: "18px 20px", background: "var(--surface2)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ fontSize: ".7rem", textTransform: "uppercase", letterSpacing: ".06em", color: "var(--muted)", fontWeight: 700 }}>Saldo na conta</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--green)", marginTop: 4 }}>{fmtBRL(manual.saldoConta)}</div>
              <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>disponível · manual</div>
            </div>
          </div>
        )}

        {/* Saídas (saques/transferências) */}
        {!semBase && (
          <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 8 }}>Saídas (saques / transferências)</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
              <input type="date" value={novaSaida.data} onChange={(e) => setNovaSaida({ ...novaSaida, data: e.target.value })} className="date-input" />
              <input type="number" step="0.01" placeholder="Valor" value={novaSaida.valor} onChange={(e) => setNovaSaida({ ...novaSaida, valor: e.target.value })} style={{ ...inpBase, width: 110, marginTop: 0 }} />
              <input type="text" placeholder="Descrição / conta (opcional)" value={novaSaida.desc} onChange={(e) => setNovaSaida({ ...novaSaida, desc: e.target.value })} style={{ ...inpBase, flex: "1 1 160px", marginTop: 0, fontWeight: 400, fontSize: ".85rem" }} />
              <button type="button" className="btn btn-ghost btn-xs" onClick={addSaida}>＋ Lançar</button>
            </div>
            {(manual.saidas ?? []).length > 0 && (
              <div className="table-wrapper" style={{ border: "1px solid var(--border)" }}>
                <table className="tbl-modern">
                  <thead><tr><th>Data</th><th style={{ textAlign: "left" }}>Descrição</th><th>Valor</th><th></th></tr></thead>
                  <tbody>
                    {[...(manual.saidas ?? [])].sort((a, b) => (b.data ?? "").localeCompare(a.data ?? "")).map((s) => (
                      <tr key={s.id}>
                        <td style={{ color: "var(--muted)" }}>{br(s.data)}</td>
                        <td style={{ textAlign: "left" }}>{s.desc || "—"}</td>
                        <td style={{ color: "var(--red)", fontWeight: 700 }}>− {fmtBRL(s.valor)}</td>
                        <td><button type="button" className="btn btn-danger btn-xs" onClick={() => removeSaida(s.id)}>Excluir</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Fluxo REAL do Mercado Pago (inclui Pix) via /v1/payments/search */}
      {fluxoMP?.ok && (
        <div>
          <div className="panel-head" style={{ marginBottom: 8 }}>
            <span className="panel-title">Mercado Pago</span>
            <span className="panel-sub">direto do MP · inclui Pix e vendas</span>
          </div>
          <div className="kpi-grid">
            <div className="kpi k-warn"><div className="k-lbl">A receber</div><div className="k-val" style={{ color: "var(--yellow)" }}>{fmtBRL(fluxoMP.aReceber ?? 0)}</div><div className="k-sub">{fluxoMP.pendentes ?? 0} futuros · já sem devoluções/retidos</div></div>
            <div className="kpi k-pos"><div className="k-lbl">Já liberado (90d)</div><div className="k-val" style={{ color: "var(--green)" }}>{fmtBRL(fluxoMP.liberado ?? 0)}</div><div className="k-sub">líquido que já caiu (últimos 90 dias)</div></div>
          </div>
          {(fluxoMP.count ?? 0) === 0 && (
            <div style={{ padding: "8px 12px", background: "rgba(100,116,139,.12)", border: "1px solid var(--border)", borderRadius: 8, fontSize: ".76rem", color: "var(--muted)", marginTop: 10 }}>
              O MP respondeu, mas trouxe <b>0 pagamentos</b> (total reportado: {fluxoMP.totalMp ?? 0}). Provável que o <b>MP_ACCESS_TOKEN seja de outra aplicação/conta</b> que não é a que recebe as vendas. Precisa ser o token de <b>produção da conta VaZXPress</b> (a mesma que recebe no Mercado Pago).
            </div>
          )}

          {/* Conferência por pedido (para bater com o app do MP) */}
          {(fluxoMP.count ?? 0) > 0 && (
            <div style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-ghost btn-xs" onClick={carregarDiag}>
                {diagOpen ? "Conferência por pedido — atualizar" : "Conferência por pedido (vs MP)"}
              </button>
              {diagOpen && diagPend && (
                <>
                  <div style={{ fontSize: ".72rem", color: "var(--muted)", margin: "8px 0 6px" }}>
                    {diagPend.length} pedido(s) a receber. Compare o total de cada dia com o calendário do Mercado Pago — as linhas destacadas são parceladas (costumam ter custo de liberação que o MP desconta).
                  </div>
                  <div className="table-wrapper" style={{ maxHeight: 340, overflow: "auto" }}>
                    <table className="tbl-modern">
                      <thead><tr>
                        <th>Dia</th><th style={{ textAlign: "left" }}>Pagamento</th><th>Tipo</th><th>Parc.</th><th style={{ textAlign: "right" }}>Líquido (app)</th>
                      </tr></thead>
                      <tbody>
                        {diagPend.map((p) => (
                          <tr key={p.id} style={p.parcelas > 1 ? { background: "rgba(247,201,72,.07)" } : undefined}>
                            <td style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{p.dia.split("-").reverse().join("/")}</td>
                            <td style={{ textAlign: "left", fontFamily: "monospace", fontSize: ".68rem", color: "var(--muted)" }}>{p.id}</td>
                            <td style={{ color: "var(--muted)", fontSize: ".72rem" }}>{p.tipo}</td>
                            <td style={{ fontWeight: p.parcelas > 1 ? 700 : 400, color: p.parcelas > 1 ? "#f7c948" : "var(--muted)" }}>{p.parcelas}x</td>
                            <td style={{ textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{fmtBRL(p.liquido)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sem acesso ao MP mostra o total a receber estimado dos pedidos do ML */}
      {(!fluxoMP || !fluxoMP.ok) && (
        <div>
          <div className="panel-head" style={{ marginBottom: 8 }}>
            <span className="panel-title">A receber (total)</span>
            <span className="panel-sub">todos os repasses futuros dos pedidos do ML</span>
          </div>
          <div className="kpi-grid">
            <div className="kpi k-warn"><div className="k-lbl">A receber (total)</div><div className="k-val" style={{ color: "var(--yellow)" }}>{fmtBRL(globalCF.aReceber)}</div><div className="k-sub">{globalCF.pedidos} pedido(s) a liberar</div></div>
          </div>
          {fluxoMP && !fluxoMP.ok && (
            <div style={{ padding: "8px 12px", background: "rgba(100,116,139,.12)", border: "1px solid var(--border)", borderRadius: 8, fontSize: ".76rem", color: "var(--muted)", marginTop: 10 }}>
              Ainda não li o fluxo direto do Mercado Pago
              {fluxoMP.error === "sem_mp_token" ? " (falta configurar o MP_ACCESS_TOKEN na Vercel)" : fluxoMP.status ? ` (HTTP ${fluxoMP.status})` : ""}.
              O valor acima é <b>estimado dos seus pedidos do ML</b> (sem Pix). Assim que o MP responder, este bloco vira o número real.
            </div>
          )}
        </div>
      )}

      {/* Reconstruído pelos pedidos do ML — detalhe do período selecionado */}
      <div className="panel-head" style={{ marginBottom: -4 }}>
        <span className="panel-title">Pelos pedidos do ML — período</span>
        <span className="panel-sub">detalhe estimado por pedido (pode diferir do saldo do MP)</span>
      </div>
      <div className="kpi-grid">
        <div className="kpi k-warn"><div className="k-lbl">A receber (período)</div><div className="k-val" style={{ color: "var(--yellow)" }}>{fmtBRL(resumo.aReceber)}</div><div className="k-sub">líquido, ainda não liberado</div></div>
        <div className="kpi k-pos"><div className="k-lbl">Já liberado (período)</div><div className="k-val" style={{ color: "var(--green)" }}>{fmtBRL(resumo.liberado)}</div><div className="k-sub">repasse já na data</div></div>
        <div className="kpi k-acc"><div className="k-lbl">Σ Líquido do período</div><div className="k-val">{fmtBRL(resumo.liquido)}</div><div className="k-sub">{resumo.count} pedido(s)</div></div>
        <div className="kpi k-neg"><div className="k-lbl">Bruto do período</div><div className="k-val">{fmtBRL(resumo.bruto)}</div><div className="k-sub">antes de taxas/frete</div></div>
      </div>

      {resumo.semData > 0 && (
        <div style={{ padding: "8px 12px", background: "rgba(100,116,139,.12)", border: "1px solid var(--border)", borderRadius: 8, fontSize: ".78rem", color: "var(--muted)" }}>
          {fmtBRL(resumo.semData)} em pedidos ainda sem data de repasse definida pelo Mercado Pago (aparecem como “sem data” na lista).
        </div>
      )}

      {/* Próximos repasses (agenda) */}
      <div className="panel">
        <div className="panel-head" style={{ marginBottom: 12 }}>
          <span className="panel-title">Próximos repasses</span>
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
        <div className="panel-title" style={{ marginBottom: 10 }}>Repasses por pedido</div>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Carregando…</div>
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
                  <th style={{ textAlign: "left" }}>Repasse em</th>
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
