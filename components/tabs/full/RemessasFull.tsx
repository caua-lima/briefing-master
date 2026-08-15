"use client";

import { useEffect, useState } from "react";
import type { EstoqueMovimento } from "@/lib/domain/types";
import { movIdRemessa, remessaTemBaixa, type Remessa } from "@/lib/domain/remessas";
import { addMovimento, ignorarRemessaFull, reabrirRemessaFull, watchRemessasIgnoradas } from "@/lib/firebase/data";
import { authedFetch } from "@/lib/api/authed-fetch";
import { fmtBRL } from "@/lib/domain/calc";

// ── Remessas pro Full: baixa a partir do que o ML recebeu ─────────────────
export default function RemessasFull({ movimentos }: { movimentos: EstoqueMovimento[] }) {
  const [dados, setDados] = useState<{ opStatus?: number; opErro?: string; remessas?: Remessa[]; dias?: number; janela?: { from: string; to: string } } | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [qtds, setQtds] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState("");
  const [erro, setErro] = useState("");
  const [ignoradas, setIgnoradas] = useState<Set<string>>(new Set());
  const [mostrarResolvidas, setMostrarResolvidas] = useState(false);

  useEffect(() => watchRemessasIgnoradas(setIgnoradas), []);

  async function marcarResolvida(remessa: string) {
    try {
      await ignorarRemessaFull(remessa);
    } catch (e) {
      alert(
        "Não consegui marcar como resolvida. Se o erro fala em permissão, " +
        "as regras do Firestore precisam ser republicadas com a coleção full_remessas.\n\n" +
        (e instanceof Error ? e.message : String(e)),
      );
    }
  }

  async function buscar() {
    setAberto(true);
    setCarregando(true);
    setErro("");
    try {
      const r = await authedFetch("/api/ml/gestao-full", { cache: "no-store" });
      const txt = await r.text();
      if (!r.ok) setErro(`HTTP ${r.status} — ${txt.slice(0, 300)}`);
      else setDados(JSON.parse(txt));
    } catch (e) {
      setErro(`Falhou: ${String(e).slice(0, 200)}`);
    }
    setCarregando(false);
  }

  const todas = dados?.remessas ?? [];
  // Envio seu tira estoque de casa; transferência entre centros do ML, não.
  const remessas = todas.filter((r) => !r.ehTransferencia);
  const transferencias = todas.filter((r) => r.ehTransferencia);
  // Produto específico já com baixa gravada nesta remessa (não a remessa
  // inteira). Sem isso, reabrir a página depois de uma baixa parcial (falhou
  // no meio do loop) reapresentava TODOS os produtos editáveis com o valor
  // default do ML — reenviar sobrescreveria uma correção que já tinha dado
  // certo, voltando ela pro valor recebido em vez do que você digitou.
  const movDoProduto = (r: Remessa, productId: string) =>
    productId ? movimentos.find((m) => m.id === movIdRemessa(r.remessa, productId)) : undefined;
  // Total que será baixado agora — só o que falta, já com as correções digitadas.
  const totalDaRemessa = (r: Remessa) =>
    r.produtos.reduce((s, p) => {
      if (!p.productId || movDoProduto(r, p.productId)) return s;
      return s + Math.max(Math.round(Number(qtds[`${r.remessa}|${p.productId}`] ?? p.qtd) || 0), 0);
    }, 0);
  const jaBaixada = (r: Remessa) => remessaTemBaixa(r, movimentos);
  // Resolvida = deu baixa por aqui, ou foi marcada como lançada à mão.
  const resolvida = (r: Remessa) => jaBaixada(r) || ignoradas.has(r.remessa);
  const pendentes = remessas.filter((r) => !resolvida(r));
  const resolvidas = remessas.filter(resolvida);

  async function darBaixa(r: Remessa) {
    // Pula quem já tem baixa gravada: reenviar de novo é inofensivo (mesmo id,
    // sobrescreve com o mesmo valor), mas melhor nem tocar no que já está certo.
    const alvos = r.produtos.filter((p) => p.productId && !movDoProduto(r, p.productId));
    if (!alvos.length) { alert("Nada pendente: os produtos com cadastro já têm baixa nesta remessa."); return; }
    setSalvando(r.remessa);
    try {
      for (const p of alvos) {
        const chave = `${r.remessa}|${p.productId}`;
        const qtd = Math.round(Number(qtds[chave] ?? p.qtd) || 0);
        if (qtd <= 0) continue;
        const dif = qtd - p.qtd;
        await addMovimento({
          id: movIdRemessa(r.remessa, p.productId),
          productId: p.productId,
          tipo: "saida_full",
          quantidade: qtd,
          data: r.data,
          obs: `Remessa Full #${r.remessa} · ML recebeu ${p.qtd}${dif !== 0 ? ` · você informou ${qtd} (${dif > 0 ? "+" : ""}${dif})` : ""}`,
        });
      }
    } catch (e) {
      alert("Erro ao dar baixa: " + (e instanceof Error ? e.message : String(e)));
    }
    setSalvando("");
  }

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <span className="panel-title">Remessas pro Full</span>
        <span className="panel-sub">baixa de estoque a partir do que o Mercado Livre recebeu</span>
      </div>
      <div style={{ fontSize: ".8rem", color: "var(--muted)", marginBottom: 10, lineHeight: 1.55 }}>
        Busca as remessas que chegaram no Full e dá baixa no estoque de casa. A quantidade vem
        preenchida com o que o ML recebeu — <b>ajuste para o que você enviou</b> se houver diferença.
        Cada remessa só dá baixa uma vez.
      </div>

      <button type="button" className="btn btn-ghost btn-sm" onClick={buscar} disabled={carregando}>
        {carregando ? "Buscando…" : aberto ? "Buscar de novo" : "Buscar remessas"}
      </button>

      {erro && (
        <div style={{
          marginTop: 10, padding: 8, borderRadius: 6,
          background: "rgba(214,90,74,.12)", border: "1px solid rgba(214,90,74,.4)",
          fontFamily: "ui-monospace, monospace", fontSize: ".7rem", whiteSpace: "pre-wrap",
        }}>{erro}</div>
      )}

      {aberto && !carregando && !erro && (
        <div style={{ marginTop: 12 }}>
          {remessas.length === 0 && (
            <div style={{ fontSize: ".8rem", color: "var(--muted)" }}>
              Nenhuma remessa nos últimos {dados?.dias ?? 25} dias.
            </div>
          )}

          {remessas.length > 0 && pendentes.length === 0 && (
            <div style={{ fontSize: ".82rem", color: "var(--green)", marginBottom: 10 }}>
              Nenhuma remessa pendente — tudo que chegou já foi resolvido.
            </div>
          )}

          {!!dados?.janela && (
            <div style={{ fontSize: ".74rem", color: "var(--muted)", marginBottom: 10 }}>
              Buscando de {dados.janela.from.split("-").reverse().join("/")} a{" "}
              {dados.janela.to.split("-").reverse().join("/")}. Uma remessa só aparece
              depois que o ML processa o recebimento — o que leva alguns dias depois da coleta.
            </div>
          )}

          {pendentes.length > 1 && (
            <div style={{ marginBottom: 10 }}>
              <button
                type="button" className="btn btn-ghost btn-sm"
                onClick={async () => {
                  if (!confirm(`Marcar ${pendentes.length} remessas como já resolvidas? Não mexe no estoque.`)) return;
                  for (const r of pendentes) await marcarResolvida(r.remessa);
                }}
              >
                Marcar as {pendentes.length} como já lançadas
              </button>
            </div>
          )}

          {pendentes.map((r) => {
            const feita = jaBaixada(r);
            const semCadastro = r.produtos.filter((p) => !p.productId);
            return (
              <div key={r.remessa} style={{
                background: "var(--surface2)", border: `1px solid ${feita ? "var(--border)" : "rgba(59,130,246,.35)"}`,
                borderRadius: 12, padding: 14, marginBottom: 12,
              }}>
                {/* Cabeçalho da remessa */}
                <div style={{
                  display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center",
                  justifyContent: "space-between", paddingBottom: 10, marginBottom: 10,
                  borderBottom: "1px solid var(--border)",
                }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                    <span style={{
                      fontFamily: "ui-monospace, monospace", fontSize: ".82rem", fontWeight: 700,
                      background: "var(--surface)", border: "1px solid var(--border)",
                      borderRadius: 6, padding: "3px 8px",
                    }}>#{r.remessa}</span>
                    <span style={{ color: "var(--muted)", fontSize: ".8rem" }}>
                      {r.data.split("-").reverse().join("/")}
                    </span>
                    <span style={{ color: "var(--muted)", fontSize: ".8rem" }}>
                      {r.produtos.length} produto{r.produtos.length === 1 ? "" : "s"} · {r.recebido} un recebidas
                    </span>
                    {/* Taxa da coleta: custo real que o ML cobra pra levar do seu
                        galpão ao centro do Full. null = a API não devolveu —
                        mostrado como "sem custo informado", nunca como R$ 0,00. */}
                    <span
                      title={r.custo != null
                        ? "Taxa que o Mercado Livre cobrou por esta coleta — entra no Resultado líquido da DRE."
                        : "O Mercado Livre não devolveu o custo desta coleta pela API. Não mostro R$ 0,00 pra não subestimar o custo."}
                      style={{
                        fontSize: ".75rem", fontWeight: 700, borderRadius: 6, padding: "2px 8px", cursor: "help",
                        color: r.custo != null ? "var(--red)" : "var(--muted)",
                        background: r.custo != null ? "var(--red-bg)" : "var(--surface)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      {r.custo != null ? `coleta ${fmtBRL(r.custo)}` : "coleta sem custo informado"}
                    </span>
                  </div>
                  {feita ? (
                    <span style={{
                      color: "var(--green)", fontSize: ".75rem", fontWeight: 700,
                      background: "rgba(54,179,126,.12)", border: "1px solid rgba(54,179,126,.35)",
                      borderRadius: 999, padding: "3px 10px",
                    }}>✓ baixa dada</span>
                  ) : (
                    <span style={{ fontSize: ".8rem", color: "var(--muted)" }}>
                      dar baixa de <b style={{ color: "var(--text)" }}>{totalDaRemessa(r)} un</b>
                    </span>
                  )}
                </div>

                {/* Produtos */}
                {r.produtos.map((p) => {
                  const movExistente = movDoProduto(r, p.productId);
                  const chave = `${r.remessa}|${p.productId}`;
                  const valor = movExistente ? String(movExistente.quantidade) : (qtds[chave] ?? String(p.qtd));
                  const dif = Math.round(Number(valor) || 0) - p.qtd;
                  return (
                    <div key={p.inventory} style={{
                      display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 12px",
                      alignItems: "center", padding: "7px 0",
                      borderTop: "1px solid rgba(255,255,255,.04)",
                      opacity: movExistente ? 0.65 : 1,
                    }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: ".84rem", fontWeight: 500 }}>
                          {p.nome || p.inventory}
                        </div>
                        <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>
                          {movExistente
                            ? <span style={{ color: "var(--green)" }}>✓ já baixado: {movExistente.quantidade} un</span>
                            : p.productId
                              ? <>ML recebeu {p.qtd} un{dif !== 0 && (
                                  <span style={{ color: "var(--warning)", fontWeight: 600 }}>
                                    {" · "}{dif > 0 ? `+${dif}` : dif} a mais que o recebido
                                  </span>
                                )}</>
                              : <span style={{ color: "var(--red)" }}>sem cadastro no Estoque — não dá baixa</span>}
                        </div>
                      </div>
                      <input
                        type="number"
                        inputMode="numeric"
                        aria-label={`Unidades de ${p.nome || p.inventory}`}
                        style={{
                          width: 84, fontSize: 16, textAlign: "right", padding: "7px 9px",
                          background: p.productId ? "var(--surface)" : "transparent",
                          border: `1px solid ${dif !== 0 && !movExistente && p.productId ? "rgba(255,138,31,.5)" : "var(--border)"}`,
                          borderRadius: 8, color: "var(--text)", outline: "none",
                        }}
                        value={valor}
                        disabled={!!movExistente || !p.productId}
                        onChange={(e) => setQtds((s) => ({ ...s, [chave]: e.target.value }))}
                      />
                    </div>
                  );
                })}

                {!!semCadastro.length && (
                  <div style={{
                    fontSize: ".75rem", color: "var(--warning)", marginTop: 10, padding: "7px 10px",
                    background: "var(--warning-soft)", borderRadius: 8, lineHeight: 1.5,
                  }}>
                    {semCadastro.length === 1 ? "Um produto desta remessa não está" : `${semCadastro.length} produtos desta remessa não estão`}
                    {" "}no Estoque. A baixa vai cobrir só o resto.
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn btn-success btn-sm"
                    style={{ flex: "1 1 200px" }}
                    disabled={salvando === r.remessa}
                    onClick={() => darBaixa(r)}
                  >
                    {salvando === r.remessa ? "Dando baixa…" : `Dar baixa de ${totalDaRemessa(r)} unidades`}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    title="Some da lista sem mexer no estoque — para remessa que você já lançou à mão"
                    onClick={() => marcarResolvida(r.remessa)}
                  >
                    Já lancei
                  </button>
                </div>
              </div>
            );
          })}

          {resolvidas.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setMostrarResolvidas((v) => !v)}
              >
                {mostrarResolvidas ? "Ocultar" : "Ver"} {resolvidas.length} remessa
                {resolvidas.length === 1 ? "" : "s"} já resolvida{resolvidas.length === 1 ? "" : "s"}
              </button>

              {mostrarResolvidas && resolvidas.map((r) => (
                <div key={r.remessa} style={{
                  display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center",
                  padding: "8px 12px", marginTop: 8, borderRadius: 8,
                  background: "var(--surface2)", border: "1px solid var(--border)",
                  fontSize: ".78rem", color: "var(--muted)",
                }}>
                  <b style={{ fontFamily: "monospace", color: "var(--text)" }}>#{r.remessa}</b>
                  <span>{r.data.split("-").reverse().join("/")} · {r.recebido} un</span>
                  <span style={{ color: "var(--green)" }}>
                    {jaBaixada(r) ? "✓ baixa dada aqui" : "✓ lançada à mão"}
                  </span>
                  {!jaBaixada(r) && (
                    <button
                      type="button" className="btn btn-ghost btn-xs" style={{ marginLeft: "auto" }}
                      onClick={() => reabrirRemessaFull(r.remessa)}
                    >
                      reabrir
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {!!transferencias.length && (
            <div style={{ marginTop: 6, fontSize: ".76rem", color: "var(--muted)", lineHeight: 1.5 }}>
              <b style={{ color: "var(--text)" }}>+{transferencias.reduce((s, t) => s + t.recebido, 0)} unidades</b>{" "}
              chegaram em {transferencias.length} transferência{transferencias.length === 1 ? "" : "s"} entre centros
              do ML. São unidades de remessas anteriores que o ML redirecionou — já saíram da sua casa,
              então não geram baixa.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
