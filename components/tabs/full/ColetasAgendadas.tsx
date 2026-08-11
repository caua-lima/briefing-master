"use client";

import { useEffect, useMemo, useState } from "react";
import { FULL_COLETA_STATUS_LABEL, type FullColeta, type Product } from "@/lib/domain/types";
import type { Remessa } from "@/lib/domain/remessas";
import { addFullColeta, atualizarStatusFullColeta, deleteFullColeta, watchFullColetas } from "@/lib/firebase/data";
import { ehTerminal, podeCancelar, proximaTransicao, sugerirVinculoRecebimento } from "@/lib/domain/full-coletas";
import { authedFetch } from "@/lib/api/authed-fetch";

const STATUS_COR: Record<FullColeta["status"], { cor: string; bg: string }> = {
  agendado: { cor: "var(--accent,#5b9bd5)", bg: "rgba(91,155,213,.12)" },
  em_transporte: { cor: "#F4B942", bg: "rgba(244,185,66,.12)" },
  recebido: { cor: "var(--green)", bg: "rgba(54,179,126,.12)" },
  cancelado: { cor: "var(--muted)", bg: "rgba(185,181,166,.14)" },
};

function fmtData(iso: string): string {
  return iso ? iso.split("-").reverse().join("/") : "—";
}

/**
 * Coletas agendadas pro Full — registro MANUAL. A API pública do Mercado
 * Livre não expõe "agendado"/"em trânsito" (só o recebimento já processado,
 * que RemessasFull já busca) — por isso o ciclo de vida é controlado por
 * quem usa o app, com uma sugestão (não automática) de qual remessa real
 * corresponde a cada coleta em transporte.
 */
export default function ColetasAgendadas({ products, canEdit }: { products: Product[]; canEdit: boolean }) {
  const [coletas, setColetas] = useState<FullColeta[]>([]);
  useEffect(() => watchFullColetas(setColetas), []);

  const [productId, setProductId] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [dataAgendada, setDataAgendada] = useState("");
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [remessas, setRemessas] = useState<Remessa[]>([]);
  const [buscandoRemessas, setBuscandoRemessas] = useState(false);

  const produtosOrdenados = useMemo(() => [...products].sort((a, b) => a.name.localeCompare(b.name)), [products]);

  async function buscarRemessas() {
    setBuscandoRemessas(true);
    try {
      const r = await authedFetch("/api/ml/gestao-full", { cache: "no-store" });
      if (r.ok) { const j = await r.json(); setRemessas(j.remessas ?? []); }
    } catch { /* melhor esforço — sem isso, só não aparece sugestão de vínculo */ }
    setBuscandoRemessas(false);
  }
  // Falso positivo comprovado (mesmo padrão de RemessasFull/AdsTab): fetch no
  // mount — buscarRemessas() faz setState de forma assíncrona.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { buscarRemessas(); }, []);

  async function registrar() {
    const produto = products.find((p) => p.id === productId);
    const qtd = Math.round(Number(quantidade.replace(",", ".")) || 0);
    if (!produto) { alert("Selecione o produto."); return; }
    if (qtd <= 0) { alert("Informe a quantidade."); return; }
    if (!dataAgendada) { alert("Informe a data prevista da coleta."); return; }
    setSalvando(true);
    try {
      await addFullColeta({ productId: produto.id, productName: produto.name, quantidade: qtd, dataAgendada, obs: obs.trim() || undefined });
      setQuantidade(""); setObs("");
    } catch (err) {
      alert("Erro ao registrar: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSalvando(false);
    }
  }

  const jaVinculadas = useMemo(() => new Set(coletas.filter((c) => c.remessaVinculada).map((c) => c.remessaVinculada!)), [coletas]);

  const ativas = coletas.filter((c) => !ehTerminal(c.status)).sort((a, b) => a.dataAgendada.localeCompare(b.dataAgendada));
  const finalizadas = coletas.filter((c) => ehTerminal(c.status)).sort((a, b) => b.dataAgendada.localeCompare(a.dataAgendada));
  const [mostrarFinalizadas, setMostrarFinalizadas] = useState(false);

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <span className="panel-title">Coletas agendadas</span>
        <span className="panel-sub">registro manual — o Mercado Livre não informa isso via API</span>
      </div>
      <div style={{ fontSize: ".78rem", color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
        A API pública do Mercado Livre não expõe coleta agendada nem status &quot;em trânsito&quot; — só o recebimento já
        processado (que a seção &quot;Remessas pro Full&quot; abaixo já busca). Registre aqui quando agendar a coleta com a
        transportadora pra acompanhar o ciclo até chegar — quando bater com uma remessa real recebida, o app sugere o
        vínculo, mas não aplica sozinho.
      </div>

      {canEdit && (
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginBottom: 12 }}>
          <div className="config-field">
            <label>Produto</label>
            <select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Selecione…</option>
              {produtosOrdenados.map((p) => (<option key={p.id} value={p.id}>{p.name || "Sem nome"}</option>))}
            </select>
          </div>
          <div className="config-field">
            <label>Quantidade</label>
            <input type="number" min="1" step="1" placeholder="Ex: 40" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
          </div>
          <div className="config-field">
            <label>Data prevista da coleta</label>
            <input type="date" value={dataAgendada} onChange={(e) => setDataAgendada(e.target.value)} />
          </div>
          <div className="config-field">
            <label>Observação (opcional)</label>
            <input type="text" placeholder="Ex: transportadora X" value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
        </div>
      )}
      {canEdit && (
        <button type="button" className="btn btn-success btn-sm" onClick={registrar} disabled={salvando} style={{ marginBottom: 16 }}>
          {salvando ? "Salvando…" : "＋ Registrar coleta"}
        </button>
      )}

      {ativas.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: ".84rem", padding: "8px 0" }}>Nenhuma coleta agendada ou em transporte no momento.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {ativas.map((c) => {
            const sugestao = c.status === "em_transporte"
              ? sugerirVinculoRecebimento(c, remessas, jaVinculadas)
              : null;
            const proximo = proximaTransicao(c.status);
            const cor = STATUS_COR[c.status];
            return (
              <div key={c.id} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, fontSize: ".86rem" }}>{c.productName}</span>
                      <span style={{ fontSize: ".68rem", fontWeight: 700, color: cor.cor, background: cor.bg, padding: "1px 8px", borderRadius: 5 }}>
                        {FULL_COLETA_STATUS_LABEL[c.status]}
                      </span>
                    </div>
                    <div style={{ fontSize: ".78rem", color: "var(--muted)", marginTop: 3 }}>
                      {c.quantidade} un · previsto pra {fmtData(c.dataAgendada)}{c.obs ? ` · ${c.obs}` : ""}
                    </div>
                  </div>
                  {canEdit && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {proximo && (
                        <button type="button" className="btn btn-ghost btn-xs" onClick={() => atualizarStatusFullColeta(c.id, proximo).catch(() => {})}>
                          Marcar {FULL_COLETA_STATUS_LABEL[proximo].toLowerCase()}
                        </button>
                      )}
                      {podeCancelar(c.status) && (
                        <button
                          type="button" className="btn btn-ghost btn-xs"
                          onClick={() => { if (confirm("Cancelar esta coleta?")) atualizarStatusFullColeta(c.id, "cancelado").catch(() => {}); }}
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {sugestao && (
                  <div style={{ marginTop: 8, padding: "8px 10px", background: "rgba(54,179,126,.08)", border: "1px solid rgba(54,179,126,.3)", borderRadius: 8, fontSize: ".78rem", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span>
                      Bate com a remessa <b>#{sugestao.remessa}</b> recebida em {fmtData(sugestao.data)} ({sugestao.qtdRecebida} un) — confirmar que é esta?
                    </span>
                    {canEdit && (
                      <button type="button" className="btn btn-success btn-xs" onClick={() => atualizarStatusFullColeta(c.id, "recebido", sugestao.remessa).catch(() => {})}>
                        Confirmar recebimento
                      </button>
                    )}
                  </div>
                )}
                {c.status === "em_transporte" && !sugestao && canEdit && (
                  <div style={{ marginTop: 8, fontSize: ".72rem", color: "var(--muted)" }}>
                    Nenhuma remessa recebida bate com esta coleta ainda.
                    {" "}
                    <button type="button" onClick={buscarRemessas} disabled={buscandoRemessas} style={{ background: "none", border: "none", color: "var(--accent,#5b9bd5)", cursor: "pointer", textDecoration: "underline", fontSize: ".72rem", padding: 0 }}>
                      {buscandoRemessas ? "buscando…" : "buscar de novo"}
                    </button>
                    {" · ou "}
                    <button
                      type="button"
                      onClick={() => { if (confirm("Marcar como recebido manualmente, sem vincular a uma remessa específica?")) atualizarStatusFullColeta(c.id, "recebido").catch(() => {}); }}
                      style={{ background: "none", border: "none", color: "var(--accent,#5b9bd5)", cursor: "pointer", textDecoration: "underline", fontSize: ".72rem", padding: 0 }}
                    >
                      marcar recebido manualmente
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {finalizadas.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMostrarFinalizadas((v) => !v)}>
            {mostrarFinalizadas ? "Ocultar" : "Ver"} {finalizadas.length} coleta{finalizadas.length === 1 ? "" : "s"} recebida{finalizadas.length === 1 ? "" : "s"}/cancelada{finalizadas.length === 1 ? "" : "s"}
          </button>
          {mostrarFinalizadas && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              {finalizadas.map((c) => {
                const cor = STATUS_COR[c.status];
                return (
                  <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "6px 12px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: ".78rem", flexWrap: "wrap" }}>
                    <span>
                      <b>{c.productName}</b> · {c.quantidade} un · {fmtData(c.dataAgendada)}
                      {c.remessaVinculada && <span style={{ color: "var(--muted)" }}> · remessa #{c.remessaVinculada}</span>}
                    </span>
                    <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontWeight: 700, color: cor.cor }}>{FULL_COLETA_STATUS_LABEL[c.status]}</span>
                      {canEdit && (
                        <button type="button" className="btn btn-ghost btn-xs" onClick={() => { if (confirm("Excluir este registro?")) deleteFullColeta(c.id).catch(() => {}); }}>Excluir</button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
