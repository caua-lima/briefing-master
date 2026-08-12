"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FULL_COLETA_STATUS_LABEL, type EstoqueMovimento, type FullColeta, type Product } from "@/lib/domain/types";
import { movIdRemessa, type Remessa } from "@/lib/domain/remessas";
import { addFullColeta, addMovimento, atualizarStatusFullColeta, deleteFullColeta, watchFullColetas } from "@/lib/firebase/data";
import { ehTerminal, podeCancelar, proximaTransicao, sugerirVinculoRecebimento } from "@/lib/domain/full-coletas";
import { authedFetch } from "@/lib/api/authed-fetch";

// Poll de remessas em segundo plano — casado com o cache de 5min do lado do
// servidor (app/api/ml/gestao-full/route.ts) pra não gastar chamada extra à
// API do ML: a maioria dos polls só bate no cache.
const POLL_REMESSAS_MS = 5 * 60 * 1000;

/**
 * Avisa o time (push) que uma coleta foi agendada ou recebida — melhor
 * esforço, fire-and-forget: se a notificação falhar, a coleta já foi
 * gravada normalmente, só ninguém foi avisado por push (ainda aparece na
 * Central de Notificações de qualquer forma, já que o evento é criado antes
 * do envio — ver app/api/notify/full-coleta/route.ts).
 */
function notificarColeta(coletaId: string, productName: string, quantidade: number, tipo: "agendada" | "recebida", dataAgendada?: string) {
  authedFetch("/api/notify/full-coleta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coletaId, productName, quantidade, tipo, dataAgendada }),
  }).catch(() => {});
}

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
 * Coletas agendadas pro Full — registro MANUAL na criação/cancelamento (a
 * API pública do Mercado Livre não expõe "agendado"/"em trânsito"/"código de
 * autorização" pra Full doméstico — só pro programa cross-border "Fully by
 * Mercado Libre" via POST /marketplace/fbm/inbounds, que não se aplica aqui;
 * confirmado pesquisando a documentação oficial, não é suposição). A partir
 * daí, tudo que a API REAL entrega (recebimento confirmado, via
 * /api/ml/gestao-full) é 100% automático: detecta a remessa que bate,
 * confirma o recebimento, dá a baixa no estoque e notifica o time sozinho —
 * sem precisar de clique.
 */
export default function ColetasAgendadas({ products, canEdit, movimentos }: { products: Product[]; canEdit: boolean; movimentos: EstoqueMovimento[] }) {
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

  const buscarRemessas = useCallback(async () => {
    setBuscandoRemessas(true);
    try {
      const r = await authedFetch("/api/ml/gestao-full", { cache: "no-store" });
      if (r.ok) { const j = await r.json(); setRemessas(j.remessas ?? []); }
    } catch { /* melhor esforço — sem isso, só não aparece sugestão de vínculo */ }
    setBuscandoRemessas(false);
  }, []);
  // Falso positivo comprovado (mesmo padrão de RemessasFull/AdsTab): fetch no
  // mount — buscarRemessas() faz setState de forma assíncrona.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { buscarRemessas(); }, [buscarRemessas]);
  // Poll em segundo plano — detecta remessa recebida sem precisar reabrir a
  // aba. Server já cacheia 5min, então isto não gasta chamada extra na
  // maioria das vezes.
  useEffect(() => {
    const id = setInterval(buscarRemessas, POLL_REMESSAS_MS);
    return () => clearInterval(id);
  }, [buscarRemessas]);

  const jaVinculadas = useMemo(() => new Set(coletas.filter((c) => c.remessaVinculada).map((c) => c.remessaVinculada!)), [coletas]);
  // Marca coleta já em processamento pra não disparar duas vezes enquanto o
  // listener do Firestore ainda não voltou com o status novo (a escrita de
  // addMovimento é idempotente por id — movIdRemessa — mas evita round-trips
  // e push duplicado à toa).
  const autoProcessando = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!canEdit) return; // sem permissão de editar Estoque, nem tenta escrever
    for (const c of coletas) {
      if (c.status !== "em_transporte") continue;
      if (autoProcessando.current.has(c.id)) continue;
      const sugestao = sugerirVinculoRecebimento(c, remessas, jaVinculadas);
      if (!sugestao) continue;
      // Já tem baixa gravada pra esta remessa+produto (ex.: alguém já deu
      // baixa manual em RemessasFull antes do auto-match rodar) — só marca
      // recebido e vincula, não duplica o movimento.
      const jaTemBaixa = movimentos.some((m) => m.id === movIdRemessa(sugestao.remessa, c.productId));
      autoProcessando.current.add(c.id);
      (async () => {
        try {
          await atualizarStatusFullColeta(c.id, "recebido", sugestao.remessa);
          if (!jaTemBaixa) {
            await addMovimento({
              id: movIdRemessa(sugestao.remessa, c.productId),
              productId: c.productId,
              tipo: "saida_full",
              quantidade: sugestao.qtdRecebida,
              data: sugestao.data,
              obs: `Confirmado automaticamente: remessa Full #${sugestao.remessa} bateu com a coleta agendada pra ${fmtData(c.dataAgendada)} (${c.quantidade} un).`,
            });
          }
          notificarColeta(c.id, c.productName, c.quantidade, "recebida");
        } catch {
          autoProcessando.current.delete(c.id); // libera pra tentar de novo no próximo poll
        }
      })();
    }
  }, [coletas, remessas, jaVinculadas, movimentos, canEdit]);

  async function registrar() {
    const produto = products.find((p) => p.id === productId);
    const qtd = Math.round(Number(quantidade.replace(",", ".")) || 0);
    if (!produto) { alert("Selecione o produto."); return; }
    if (qtd <= 0) { alert("Informe a quantidade."); return; }
    if (!dataAgendada) { alert("Informe a data prevista da coleta."); return; }
    setSalvando(true);
    try {
      const id = await addFullColeta({ productId: produto.id, productName: produto.name, quantidade: qtd, dataAgendada, obs: obs.trim() || undefined });
      notificarColeta(id, produto.name, qtd, "agendada", dataAgendada);
      setQuantidade(""); setObs("");
    } catch (err) {
      alert("Erro ao registrar: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSalvando(false);
    }
  }

  const ativas = coletas.filter((c) => !ehTerminal(c.status)).sort((a, b) => a.dataAgendada.localeCompare(b.dataAgendada));
  const finalizadas = coletas.filter((c) => ehTerminal(c.status)).sort((a, b) => b.dataAgendada.localeCompare(a.dataAgendada));
  const [mostrarFinalizadas, setMostrarFinalizadas] = useState(false);

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <span className="panel-title">Coletas agendadas</span>
        <span className="panel-sub">criação/cancelamento manual · recebimento e baixa 100% automáticos</span>
      </div>
      <div style={{ fontSize: ".78rem", color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Pesquisado direto na documentação oficial: o Mercado Livre não expõe API de agendamento de coleta, status
        &quot;em trânsito&quot; nem código de autorização pro Full doméstico (só existe pro programa cross-border &quot;Fully by
        Mercado Libre&quot;, que não é este). Agendar e cancelar a coleta são feitos direto no Mercado Livre (Seller
        Center) — a coleta é do próprio ML, não de uma transportadora à parte — e isso <b>continua manual</b> por não
        ter API. Registre aqui a mesma data que você marcou lá, só pra acompanhar. A partir daí é tudo automático: o
        app confere a cada 5 minutos (e sempre que a aba abre) se alguma remessa recebida bate com uma coleta em
        transporte e, quando bate, <b>confirma o recebimento, dá a baixa no estoque e avisa o time sozinho</b> — sem
        precisar de clique.
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
            <input type="text" placeholder="Ex: agendada no Seller Center" value={obs} onChange={(e) => setObs(e.target.value)} />
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
            // "recebido" só via confirmação (sugestão casada ou link manual
            // abaixo) — nunca pelo botão genérico, pra sempre passar pela
            // notificação e (quando possível) pelo vínculo com a remessa real.
            const proximo = c.status === "agendado" ? proximaTransicao(c.status) : null;
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
                  <div style={{ marginTop: 8, padding: "8px 10px", background: "rgba(54,179,126,.08)", border: "1px solid rgba(54,179,126,.3)", borderRadius: 8, fontSize: ".78rem" }}>
                    Bate com a remessa <b>#{sugestao.remessa}</b> recebida em {fmtData(sugestao.data)} ({sugestao.qtdRecebida} un)
                    {canEdit ? " — confirmando e dando baixa automaticamente…" : "."}
                  </div>
                )}
                {c.status === "em_transporte" && !sugestao && canEdit && (
                  <div style={{ marginTop: 8, fontSize: ".72rem", color: "var(--muted)" }}>
                    Nenhuma remessa recebida bate com esta coleta ainda — o app confere de novo sozinho a cada 5 min.
                    {" "}
                    <button type="button" onClick={buscarRemessas} disabled={buscandoRemessas} style={{ background: "none", border: "none", color: "var(--accent,#5b9bd5)", cursor: "pointer", textDecoration: "underline", fontSize: ".72rem", padding: 0 }}>
                      {buscandoRemessas ? "buscando…" : "conferir agora"}
                    </button>
                    {" · ou "}
                    <button
                      type="button"
                      onClick={() => {
                        if (!confirm("Marcar como recebido manualmente, sem vincular a uma remessa específica? Use só se tiver certeza — o app não vai conseguir confirmar contra o dado real do ML depois.")) return;
                        atualizarStatusFullColeta(c.id, "recebido").catch(() => {});
                        notificarColeta(c.id, c.productName, c.quantidade, "recebida");
                      }}
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
