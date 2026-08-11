"use client";

import { useEffect, useMemo, useState } from "react";
import type { AdsAlteracao } from "@/lib/domain/types";
import type { Product } from "@/lib/domain/types";
import { addAdsAlteracao, deleteAdsAlteracao, watchAdsAlteracoes } from "@/lib/firebase/data";
import { useAccess } from "@/components/tabs/AccessGuard";

type Campanha = { id: string; name: string; status: string };

function fmtQuando(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Registro manual de alterações de campanha ("subi o ROAS pra 20x") — não é
 * dado do Mercado Livre, é o vendedor documentando a PRÓPRIA mudança pra
 * saber quando mexeu da última vez em cada campanha. O filtro por produto é
 * o motivo de existir: cada entrada já grava productId/campaignId prontos
 * (não recalculados depois), então filtrar é só comparar o campo, mesmo que
 * o vínculo campanha↔produto mude no ML depois.
 */
export default function AdsChangelogPanel({ campanhas, products }: { campanhas: Campanha[]; products: Product[] }) {
  const { canEditTab, displayName } = useAccess();
  const canEdit = canEditTab("ads");

  const [entries, setEntries] = useState<AdsAlteracao[]>([]);
  useEffect(() => watchAdsAlteracoes(setEntries), []);

  const [campaignId, setCampaignId] = useState("");
  const [productId, setProductId] = useState("");
  const [nota, setNota] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [filtroProduto, setFiltroProduto] = useState("");

  const produtosOrdenados = useMemo(() => [...products].sort((a, b) => a.name.localeCompare(b.name)), [products]);
  const campanhasOrdenadas = useMemo(() => [...campanhas].sort((a, b) => a.name.localeCompare(b.name)), [campanhas]);

  async function salvar() {
    const campanha = campanhas.find((c) => c.id === campaignId);
    const produto = products.find((p) => p.id === productId);
    if (!campanha) { alert("Selecione a campanha."); return; }
    if (!produto) { alert("Selecione o produto — é o que permite filtrar depois."); return; }
    if (!nota.trim()) { alert("Descreva a alteração (ex.: \"subi o ROAS pra 20x\")."); return; }
    setSalvando(true);
    try {
      await addAdsAlteracao({
        campaignId: campanha.id, campaignName: campanha.name,
        productId: produto.id, productName: produto.name,
        nota: nota.trim(), createdByName: displayName,
      });
      setNota("");
    } catch (err) {
      alert("Erro ao salvar: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSalvando(false);
    }
  }

  const filtradas = filtroProduto ? entries.filter((e) => e.productId === filtroProduto) : entries;

  return (
    <div className="dash" style={{ gap: 16 }}>
      {canEdit && (
        <div className="panel">
          <div className="panel-head" style={{ marginBottom: 6 }}>
            <span className="panel-title">Registrar alteração</span>
            <span className="panel-sub">campanha + produto + o que você mudou</span>
          </div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <div className="config-field">
              <label>Campanha</label>
              <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                <option value="">Selecione…</option>
                {campanhasOrdenadas.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.status ? ` (${c.status})` : ""}</option>
                ))}
              </select>
              {campanhas.length === 0 && (
                <div className="hint">Nenhuma campanha carregada ainda — abra a aba &quot;Publicidade&quot; uma vez pra buscar do Mercado Livre.</div>
              )}
            </div>
            <div className="config-field">
              <label>Produto</label>
              <select value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Selecione…</option>
                {produtosOrdenados.map((p) => (
                  <option key={p.id} value={p.id}>{p.name || "Sem nome"}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="config-field" style={{ marginTop: 10 }}>
            <label>O que você alterou</label>
            <input
              type="text" placeholder='Ex: "subi o ROAS pra 20x"' value={nota}
              onChange={(e) => setNota(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") salvar(); }}
            />
          </div>
          <button type="button" className="btn btn-success btn-sm" style={{ marginTop: 10 }} onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : "＋ Registrar"}
          </button>
        </div>
      )}

      <div className="panel">
        <div className="panel-head" style={{ marginBottom: 6 }}>
          <span className="panel-title">Histórico</span>
          <span className="panel-sub">{filtradas.length} registro{filtradas.length === 1 ? "" : "s"}</span>
        </div>

        <div className="config-field" style={{ maxWidth: 320 }}>
          <label>Filtrar por produto</label>
          <select value={filtroProduto} onChange={(e) => setFiltroProduto(e.target.value)}>
            <option value="">Todos os produtos</option>
            {produtosOrdenados.map((p) => (
              <option key={p.id} value={p.id}>{p.name || "Sem nome"}</option>
            ))}
          </select>
        </div>

        {filtradas.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: ".84rem", padding: "16px 0" }}>
            {filtroProduto ? "Nenhuma alteração registrada pra este produto ainda." : "Nenhuma alteração registrada ainda."}
          </div>
        ) : (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {filtradas.map((e) => (
              <div key={e.id} style={{
                background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10,
                padding: "10px 14px", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap",
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: ".86rem" }}>{e.productName}</span>
                    <span style={{ fontSize: ".7rem", color: "var(--muted)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "1px 7px" }}>
                      {e.campaignName}
                    </span>
                  </div>
                  <div style={{ fontSize: ".84rem", color: "var(--text)" }}>{e.nota}</div>
                  <div style={{ fontSize: ".7rem", color: "var(--muted)", marginTop: 4 }}>
                    {fmtQuando(e.createdAt)} · {e.createdByName || e.createdBy}
                  </div>
                </div>
                {canEdit && (
                  <button
                    type="button" className="btn btn-ghost btn-xs"
                    onClick={() => { if (confirm("Excluir este registro?")) deleteAdsAlteracao(e.id).catch(() => {}); }}
                  >
                    Excluir
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
