"use client";

import { useCallback, useEffect, useState } from "react";
import type { Product } from "@/lib/domain/types";
import { deleteProduct, upsertProduct } from "@/lib/firebase/data";
import Modal from "@/components/Modal";
import type { UserData } from "@/components/useUserData";
import { authedFetch } from "@/lib/api/authed-fetch";

type EstoqueML = Record<string, { available: number; sold: number; status: string }>;

function newId() {
  return "p" + Date.now() + Math.random().toString(36).slice(2, 6);
}

function mlbsDe(p: Product): string[] {
  if (p.mlbs && p.mlbs.length) return p.mlbs;
  return p.mlb ? [p.mlb] : [];
}

function normMlb(s: string) {
  const up = s.trim().toUpperCase();
  return up.startsWith("MLB") ? up : up ? `MLB${up}` : "";
}

export default function EstoqueTab({ uid, data }: { uid: string; data: UserData }) {
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState("");
  const [estoqueML, setEstoqueML] = useState<EstoqueML>({});
  const [loadingML, setLoadingML] = useState(false);

  const carregarEstoque = useCallback(async () => {
    setLoadingML(true);
    try {
      const res = await authedFetch("/api/ml/estoque-ml", { cache: "no-store" });
      if (res.ok) setEstoqueML((await res.json()).estoque ?? {});
    } catch { /* ignora */ } finally { setLoadingML(false); }
  }, []);

  useEffect(() => { carregarEstoque(); }, [carregarEstoque]);

  const filtered = data.products.filter((p) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      (p.sku ?? "").toLowerCase().includes(q) ||
      mlbsDe(p).some((m) => m.toLowerCase().includes(q))
    );
  });

  const total = data.products.length;
  const ativos = data.products.filter((p) => p.ativo).length;
  const anuncios = data.products.reduce((s, p) => s + mlbsDe(p).length, 0);
  const semVinculo = data.products.filter((p) => !p.sku && mlbsDe(p).length === 0).length;
  const totalEstoque = Object.values(estoqueML).reduce((s, v) => s + v.available, 0);

  function onAdd() {
    setEditProduct({ id: newId(), name: "", custo: "", sku: "", imposto: "", mlbs: [""], ativo: true });
  }

  return (
    <div className="dash">
      {/* Header */}
      <div className="dash-top">
        <div className="dash-top-left">
          <h2 style={{ fontSize: "1.15rem", fontWeight: 800 }}>📦 Estoque de Produtos</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={carregarEstoque} disabled={loadingML}>
            {loadingML ? "⏳ Atualizando..." : "⟳ Atualizar estoque"}
          </button>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={onAdd}>＋ Novo Produto</button>
      </div>

      {/* Resumo */}
      <div className="kpi-grid">
        <div className="kpi k-acc"><div className="k-lbl">Produtos</div><div className="k-val">{total}</div></div>
        <div className="kpi k-pos"><div className="k-lbl">Ativos</div><div className="k-val" style={{ color: "var(--green)" }}>{ativos}</div></div>
        <div className="kpi k-warn"><div className="k-lbl">Anúncios (MLB)</div><div className="k-val" style={{ color: "var(--yellow)" }}>{anuncios}</div></div>
        <div className="kpi k-pos"><div className="k-lbl">Estoque (ML)</div><div className="k-val" style={{ color: totalEstoque > 0 ? "var(--green)" : "var(--muted)" }}>{totalEstoque} un</div></div>
      </div>

      {/* Busca */}
      <input
        type="text" placeholder="🔍 Buscar por nome, SKU ou código MLB…" value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", color: "var(--text)", fontSize: ".9rem", outline: "none", boxSizing: "border-box" }}
      />

      {semVinculo > 0 && (
        <div style={{ padding: "8px 12px", background: "rgba(247,201,72,.1)", border: "1px solid rgba(247,201,72,.3)", borderRadius: 8, fontSize: ".78rem", color: "#f7c948" }}>
          ⚠️ {semVinculo} produto(s) sem SKU nem MLB — não vão vincular às vendas.
        </div>
      )}

      {/* Lista */}
      <div className="panel">
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
            {search ? "Nenhum produto encontrado." : (<>Nenhum produto cadastrado.<br />Clique em <strong>＋ Novo Produto</strong>.</>)}
          </div>
        ) : (
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="tbl-modern">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Produto</th>
                  <th style={{ textAlign: "left" }}>Anúncios (MLB)</th>
                  <th>Estoque ML</th><th>Custo</th><th>Imposto</th>
                  <th style={{ textAlign: "left" }}>Status</th><th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <ProductRow key={p.id} product={p} uid={uid} estoqueML={estoqueML} onEdit={() => setEditProduct({ ...p, mlbs: mlbsDe(p) })} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editProduct && (
        <ProductModal
          product={editProduct}
          isNew={!data.products.some((p) => p.id === editProduct.id)}
          onClose={() => setEditProduct(null)}
          onSave={async (prod) => {
            try {
              await upsertProduct(uid, prod);
            } catch (err: unknown) {
              alert("Erro ao salvar produto: " + (err instanceof Error ? err.message : String(err)));
            } finally {
              setEditProduct(null);
            }
          }}
        />
      )}
    </div>
  );
}

function ProductRow({ product, uid, estoqueML, onEdit }: { product: Product; uid: string; estoqueML: EstoqueML; onEdit: () => void }) {
  const custo = parseFloat(product.custo) || 0;
  const imposto = parseFloat(product.imposto ?? "0") || 0;
  const mlbs = mlbsDe(product);
  const estoqueDe = (m: string) => estoqueML[normMlb(m)]?.available;
  const totalEstoque = mlbs.reduce((s, m) => s + (estoqueDe(m) ?? 0), 0);
  const temDado = mlbs.some((m) => estoqueDe(m) != null);

  return (
    <tr style={{ opacity: product.ativo ? 1 : 0.5 }}>
      <td style={{ textAlign: "left" }}>
        <div style={{ fontWeight: 600 }}>{product.name || <em style={{ color: "var(--muted)" }}>Sem nome</em>}</div>
        {product.sku ? (
          <span style={{ display: "inline-block", marginTop: 3, background: "rgba(79,142,247,.12)", color: "#4f8ef7", padding: "1px 7px", borderRadius: 6, fontWeight: 700, fontSize: ".7rem" }}>SKU {product.sku}</span>
        ) : (
          <span style={{ display: "inline-block", marginTop: 3, color: "var(--red)", fontSize: ".7rem" }}>⚠️ sem SKU</span>
        )}
      </td>
      <td style={{ textAlign: "left" }}>
        {mlbs.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 280 }}>
            {mlbs.map((m) => {
              const q = estoqueDe(m);
              return (
                <span key={m} style={{ fontSize: ".72rem", background: "var(--surface2)", border: "1px solid var(--border)", padding: "1px 7px", borderRadius: 5, color: "var(--muted)" }}>
                  {m}{q != null && <b style={{ color: q > 0 ? "var(--green)" : "var(--red)", marginLeft: 4 }}>{q}un</b>}
                </span>
              );
            })}
          </div>
        ) : <span style={{ color: "var(--red)", fontSize: ".72rem" }}>⚠️ sem MLB</span>}
      </td>
      <td style={{ fontWeight: 700, color: !temDado ? "var(--muted)" : totalEstoque > 0 ? "var(--green)" : "var(--red)" }}>
        {temDado ? `${totalEstoque} un` : "—"}
      </td>
      <td style={{ color: "var(--red)", fontWeight: 600 }}>R$ {custo.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
      <td style={{ color: imposto > 0 ? "var(--red)" : "var(--muted)" }}>
        {imposto > 0 ? `${imposto.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "—"}
      </td>
      <td style={{ textAlign: "left" }}>
        <span className={`tag ${product.ativo ? "tag-g" : "tag-r"}`}>{product.ativo ? "Ativo" : "Inativo"}</span>
      </td>
      <td>
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-warning btn-xs" onClick={onEdit}>✏️</button>
          <button type="button" className="btn btn-danger btn-xs" onClick={() => { if (!confirm(`Remover "${product.name}"?`)) return; deleteProduct(uid, product.id).catch(() => {}); }}>🗑</button>
        </div>
      </td>
    </tr>
  );
}

export function ProductModal({ product: initial, isNew, onClose, onSave }: { product: Product; isNew: boolean; onClose: () => void; onSave: (p: Product) => Promise<void> }) {
  const [p, setP] = useState<Product>({ ...initial, mlbs: mlbsDe(initial).length ? mlbsDe(initial) : [""] });
  const [saving, setSaving] = useState(false);

  function set(patch: Partial<Product>) {
    setP((prev) => ({ ...prev, ...patch }));
  }
  const mlbs = p.mlbs ?? [""];
  function setMlb(i: number, v: string) {
    set({ mlbs: mlbs.map((m, idx) => (idx === i ? v : m)) });
  }
  function addMlb() {
    set({ mlbs: [...mlbs, ""] });
  }
  function removeMlb(i: number) {
    const next = mlbs.filter((_, idx) => idx !== i);
    set({ mlbs: next.length ? next : [""] });
  }

  async function handleSave() {
    if (!p.name.trim()) { alert("Informe o nome do produto."); return; }
    const cleaned = mlbs.map((m) => m.trim()).filter(Boolean);
    setSaving(true);
    try {
      await onSave({ ...p, mlbs: cleaned, mlb: cleaned[0] ?? "" });
    } catch (err: unknown) {
      alert("Erro ao salvar produto: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <div className="modal-icon">📦</div>
      <div className="modal-title">{isNew ? "Novo Produto" : "Editar Produto"}</div>

      <div className="config-field">
        <label>📦 Nome do produto</label>
        <input type="text" placeholder="Ex: Kit Erva Mate Trot's 1,25kg" value={p.name} onChange={(e) => set({ name: e.target.value })} />
      </div>

      <div className="config-field">
        <label>🔑 SKU (código interno)</label>
        <input type="text" placeholder="Ex: 250" value={p.sku ?? ""} onChange={(e) => set({ sku: e.target.value })} />
        <div className="hint">⚠️ Deve ser <strong>idêntico</strong> ao <code>sku</code> que aparece nos pedidos do ML.</div>
      </div>

      <div className="config-field">
        <label>🏷️ Anúncios / Códigos MLB</label>
        {mlbs.map((m, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input type="text" placeholder="Ex: MLB1234567890" value={m} onChange={(e) => setMlb(i, e.target.value)} style={{ flex: 1 }} />
            {mlbs.length > 1 && (
              <button type="button" className="btn btn-danger btn-xs" onClick={() => removeMlb(i)} style={{ flexShrink: 0 }}>🗑</button>
            )}
          </div>
        ))}
        <button type="button" className="btn btn-ghost btn-xs" onClick={addMlb} style={{ marginTop: 2 }}>＋ Adicionar anúncio (MLB)</button>
        <div className="hint">Vários anúncios do mesmo produto (preços diferentes, mesmo custo). Todos vinculam as vendas a este produto.</div>
      </div>

      <div className="config-field">
        <label>💰 Custo do produto/unidade (R$)</label>
        <input type="number" min="0" step="0.01" placeholder="0.00" value={p.custo} onChange={(e) => set({ custo: e.target.value })} />
      </div>

      <div className="config-field">
        <label>🧾 Imposto sobre a venda (%)</label>
        <input type="number" min="0" step="0.01" placeholder="Ex: 8" value={p.imposto ?? ""} onChange={(e) => set({ imposto: e.target.value })} />
        <div className="hint">Percentual de imposto pago sobre o valor da venda.</div>
      </div>

      <div style={{ margin: "4px 0 12px", padding: "8px 12px", borderRadius: 8, background: "rgba(79,142,247,.08)", border: "1px solid rgba(79,142,247,.2)", fontSize: ".78rem", color: "var(--muted)" }}>
        🏷️ <strong>Preço de venda</strong> e 📥 <strong>retorno</strong>, além de 📢 ADS e 🚚 Envio Full, são puxados automaticamente do Mercado Livre — não precisa cadastrar.
      </div>

      <div className="config-field">
        <label>Status</label>
        <select
          value={p.ativo ? "ativo" : "inativo"}
          onChange={(e) => set({ ativo: e.target.value === "ativo" })}
          style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: ".9rem", outline: "none" }}
        >
          <option value="ativo">✅ Ativo (em estoque)</option>
          <option value="inativo">🔴 Inativo (fora de estoque)</option>
        </select>
      </div>

      <div className="modal-btns">
        <button type="button" className="btn btn-success" onClick={handleSave} disabled={saving}>{saving ? "Salvando…" : "💾 Salvar Produto"}</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>✕ Cancelar</button>
      </div>
    </Modal>
  );
}
