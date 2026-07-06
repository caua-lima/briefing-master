"use client";

import { useState } from "react";
import type { Product } from "@/lib/domain/types";
import { deleteProduct, upsertProduct } from "@/lib/firebase/data";
import Modal from "@/components/Modal";
import type { UserData } from "@/components/useUserData";

function newId() {
  return "p" + Date.now() + Math.random().toString(36).slice(2, 6);
}

function mlbsDe(p: Product): string[] {
  if (p.mlbs && p.mlbs.length) return p.mlbs;
  return p.mlb ? [p.mlb] : [];
}

export default function EstoqueTab({ uid, data }: { uid: string; data: UserData }) {
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState("");

  const filtered = data.products.filter((p) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      (p.sku ?? "").toLowerCase().includes(q) ||
      mlbsDe(p).some((m) => m.toLowerCase().includes(q))
    );
  });

  function onAdd() {
    setEditProduct({ id: newId(), name: "", custo: "", sku: "", imposto: "", mlbs: [""], ativo: true });
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700 }}>📦 Estoque de Produtos</h2>
        <button type="button" className="btn btn-primary btn-sm" onClick={onAdd}>＋ Novo Produto</button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <input
          type="text" placeholder="🔍 Buscar por nome, SKU ou código MLB…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 14px", color: "var(--text)", fontSize: ".9rem", outline: "none", boxSizing: "border-box" }}
        />
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
          {search ? "Nenhum produto encontrado." : (<>Nenhum produto cadastrado.<br />Clique em <strong>＋ Novo Produto</strong>.</>)}
        </div>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Produto</th><th>SKU</th><th>Anúncios (MLB)</th><th>Custo</th><th>Imposto %</th><th>Status</th><th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <ProductRow key={p.id} product={p} uid={uid} onEdit={() => setEditProduct({ ...p, mlbs: mlbsDe(p) })} />
              ))}
            </tbody>
          </table>
        </div>
      )}

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
    </>
  );
}

function ProductRow({ product, uid, onEdit }: { product: Product; uid: string; onEdit: () => void }) {
  const custo = parseFloat(product.custo) || 0;
  const imposto = parseFloat(product.imposto ?? "0") || 0;
  const mlbs = mlbsDe(product);

  return (
    <tr style={{ opacity: product.ativo ? 1 : 0.45 }}>
      <td className="td-name">{product.name || <em style={{ color: "var(--muted)" }}>Sem nome</em>}</td>
      <td style={{ color: "var(--muted)", fontSize: ".82rem" }}>
        {product.sku ? (
          <span style={{ background: "rgba(79,142,247,.12)", color: "#4f8ef7", padding: "2px 7px", borderRadius: 6, fontWeight: 700, fontSize: ".78rem" }}>{product.sku}</span>
        ) : (
          <span style={{ color: "var(--red)", fontSize: ".75rem" }}>⚠️ sem SKU</span>
        )}
      </td>
      <td style={{ color: "var(--muted)", fontSize: ".78rem" }}>
        {mlbs.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {mlbs.map((m) => (
              <span key={m} style={{ background: "var(--surface2)", border: "1px solid var(--border)", padding: "1px 6px", borderRadius: 5 }}>{m}</span>
            ))}
          </div>
        ) : "—"}
      </td>
      <td className="negative">R$ {custo.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
      <td className={imposto > 0 ? "negative" : ""} style={{ color: imposto > 0 ? undefined : "var(--muted)" }}>
        {imposto > 0 ? `${imposto.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "—"}
      </td>
      <td>
        <span style={{ display: "inline-block", fontSize: ".75rem", fontWeight: 700, padding: "2px 8px", borderRadius: 12, background: product.ativo ? "rgba(34,197,94,.15)" : "rgba(239,68,68,.1)", color: product.ativo ? "var(--green)" : "var(--red)" }}>
          {product.ativo ? "✅ Ativo" : "🔴 Inativo"}
        </span>
      </td>
      <td>
        <div style={{ display: "flex", gap: 6 }}>
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
