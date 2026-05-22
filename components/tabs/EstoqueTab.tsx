"use client";

import { useState } from "react";
import type { Product } from "@/lib/domain/types";
import { deleteProduct, upsertProduct } from "@/lib/firebase/data";
import Modal from "@/components/Modal";
import type { UserData } from "@/components/useUserData";

function newId() {
  return "p" + Date.now() + Math.random().toString(36).slice(2, 6);
}

function calcRetorno(preco: string, custo: string): string {
  const p = parseFloat(preco) || 0;
  const c = parseFloat(custo) || 0;
  if (!p) return "";
  return (p - c).toFixed(2);
}

export default function EstoqueTab({
  uid,
  data,
}: {
  uid: string;
  data: UserData;
}) {
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState("");

  const filtered = data.products.filter((p) => {
    const q = search.toLowerCase();
    return (
      !q ||
      p.name.toLowerCase().includes(q) ||
      (p.mlb ?? "").toLowerCase().includes(q) ||
      (p.sku ?? "").toLowerCase().includes(q)
    );
  });

  function onAdd() {
    setEditProduct({
      id: newId(),
      name: "",
      preco: "",
      retorno: "",
      custo: "",
      sku: "",
      ads: "",
      custo_envio_full: "",
      mlb: "",
      ativo: true,
    });
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700 }}>📦 Estoque de Produtos</h2>
        <button type="button" className="btn btn-primary btn-sm" onClick={onAdd}>
          ＋ Novo Produto
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <input
          type="text"
          placeholder="🔍 Buscar por nome, SKU ou código MLB…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            background: "var(--surface2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "9px 14px",
            color: "var(--text)",
            fontSize: ".9rem",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
          {search ? "Nenhum produto encontrado." : (
            <>
              Nenhum produto cadastrado.
              <br />
              Clique em <strong>＋ Novo Produto</strong>.
            </>
          )}
        </div>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th>SKU</th>
                <th>MLB</th>
                <th>Preço</th>
                <th>Custo</th>
                <th>Ads/un</th>
                <th>Envio Full/un</th>
                <th>Retorno Líq.</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <ProductRow
                  key={p.id}
                  product={p}
                  uid={uid}
                  onEdit={() => setEditProduct({ ...p })}
                />
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
              const message = err instanceof Error ? err.message : String(err);
              alert("Erro ao salvar produto: " + message);
            } finally {
              setEditProduct(null);
            }
          }}
        />
      )}
    </>
  );
}

function ProductRow({
  product,
  uid,
  onEdit,
}: {
  product: Product;
  uid: string;
  onEdit: () => void;
}) {
  const preco    = parseFloat(product.preco) || 0;
  const custo    = parseFloat(product.custo) || 0;
  const ads      = parseFloat(product.ads ?? "0") || 0;
  const envio    = parseFloat(product.custo_envio_full ?? "0") || 0;
  const retorno  = parseFloat(product.retorno) || preco - custo;

  return (
    <tr style={{ opacity: product.ativo ? 1 : 0.45 }}>
      <td className="td-name">{product.name || <em style={{ color: "var(--muted)" }}>Sem nome</em>}</td>
      <td style={{ color: "var(--muted)", fontSize: ".82rem" }}>
        {product.sku ? (
          <span style={{
            background: "rgba(79,142,247,.12)",
            color: "#4f8ef7",
            padding: "2px 7px",
            borderRadius: 6,
            fontWeight: 700,
            fontSize: ".78rem",
          }}>
            {product.sku}
          </span>
        ) : (
          <span style={{ color: "var(--red)", fontSize: ".75rem" }}>⚠️ sem SKU</span>
        )}
      </td>
      <td style={{ color: "var(--muted)", fontSize: ".82rem" }}>
        {product.mlb || "—"}
      </td>
      <td className="positive">
        R$ {preco.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
      </td>
      <td className="negative">
        R$ {custo.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
      </td>
      <td className="negative">
        R$ {ads.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
      </td>
      <td className="negative">
        R$ {envio.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
      </td>
      <td className={retorno >= 0 ? "positive" : "negative"}>
        R$ {retorno.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
      </td>
      <td>
        <span
          style={{
            display: "inline-block",
            fontSize: ".75rem",
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 12,
            background: product.ativo ? "rgba(34,197,94,.15)" : "rgba(239,68,68,.1)",
            color: product.ativo ? "var(--green)" : "var(--red)",
          }}
        >
          {product.ativo ? "✅ Ativo" : "🔴 Inativo"}
        </span>
      </td>
      <td>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className="btn btn-warning btn-xs" onClick={onEdit}>
            ✏️
          </button>
          <button
            type="button"
            className="btn btn-danger btn-xs"
            onClick={() => {
              if (!confirm(`Remover "${product.name}"?`)) return;
              deleteProduct(uid, product.id).catch(() => {});
            }}
          >
            🗑
          </button>
        </div>
      </td>
    </tr>
  );
}

export function ProductModal({
  product: initial,
  isNew,
  onClose,
  onSave,
}: {
  product: Product;
  isNew: boolean;
  onClose: () => void;
  onSave: (p: Product) => Promise<void>;
}) {
  const [p, setP] = useState<Product>({ ...initial });
  const [retornoManual, setRetornoManual] = useState(false);
  const [saving, setSaving] = useState(false);

  function set(patch: Partial<Product>) {
    setP((prev) => {
      const next = { ...prev, ...patch };
      if (!retornoManual && (patch.preco !== undefined || patch.custo !== undefined)) {
        next.retorno = calcRetorno(next.preco, next.custo);
      }
      return next;
    });
  }

  async function handleSave() {
    if (!p.name.trim()) {
      alert("Informe o nome do produto.");
      return;
    }
    setSaving(true);
    try {
      await onSave(p);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      alert("Erro ao salvar produto: " + message);
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
        <input
          type="text"
          placeholder="Ex: Kit Erva Mate Trot's 1,25kg"
          value={p.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>

      <div className="config-field">
        <label>🔑 SKU (código interno)</label>
        <input
          type="text"
          placeholder="Ex: 250"
          value={p.sku ?? ""}
          onChange={(e) => set({ sku: e.target.value })}
        />
        <div className="hint">
          ⚠️ Deve ser <strong>idêntico</strong> ao campo <code>sku</code> que aparece nos pedidos do ML
        </div>
      </div>

      <div className="config-field">
        <label>🏷️ Código MLB (Mercado Livre)</label>
        <input
          type="text"
          placeholder="Ex: MLB1234567890"
          value={p.mlb ?? ""}
          onChange={(e) => set({ mlb: e.target.value })}
        />
        <div className="hint">Opcional — apenas para referência visual</div>
      </div>

      <div className="config-field">
        <label>🏷️ Preço de venda (R$)</label>
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={p.preco}
          onChange={(e) => set({ preco: e.target.value })}
        />
      </div>

      <div className="config-field">
        <label>💰 Custo do produto/unidade (R$)</label>
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={p.custo}
          onChange={(e) => set({ custo: e.target.value })}
        />
      </div>

      <div className="config-field">
        <label>📢 Custo de Ads/unidade (R$)</label>
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={p.ads ?? ""}
          onChange={(e) => set({ ads: e.target.value })}
        />
        <div className="hint">Gasto médio em anúncios ML por unidade vendida deste produto</div>
      </div>

      <div className="config-field">
        <label>🚚 Custo Envio Full/unidade (R$)</label>
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={p.custo_envio_full ?? ""}
          onChange={(e) => set({ custo_envio_full: e.target.value })}
        />
        <div className="hint">
          Custo médio do frete Full cobrado pelo ML por unidade (consulte o relatório financeiro do ML)
        </div>
      </div>

      <div className="config-field">
        <label
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            flexWrap: "nowrap",
            whiteSpace: "nowrap",
            fontSize: "clamp(0.62rem, 1.2vw, 0.8rem)",
          }}
        >
          📥 Retorno líquido/unidade (R$)
          <span
            style={{
              fontSize: "inherit",
              color: "var(--muted)",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {retornoManual ? "(editado manualmente)" : "(calculado automaticamente)"}
          </span>
        </label>
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={p.retorno}
          onChange={(e) => {
            setRetornoManual(true);
            set({ retorno: e.target.value });
          }}
        />
        {retornoManual && (
          <button
            type="button"
            style={{
              marginTop: 4,
              fontSize: ".75rem",
              color: "var(--muted)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
            onClick={() => {
              setRetornoManual(false);
              setP((prev) => ({
                ...prev,
                retorno: calcRetorno(prev.preco, prev.custo),
              }));
            }}
          >
            ↺ Recalcular automaticamente
          </button>
        )}
      </div>

      <div className="config-field">
        <label>Status</label>
        <select
          value={p.ativo ? "ativo" : "inativo"}
          onChange={(e) => set({ ativo: e.target.value === "ativo" })}
          style={{
            background: "var(--surface2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "9px 12px",
            color: "var(--text)",
            fontSize: ".9rem",
            outline: "none",
          }}
        >
          <option value="ativo">✅ Ativo (em estoque)</option>
          <option value="inativo">🔴 Inativo (fora de estoque)</option>
        </select>
      </div>

      <div className="modal-btns">
        <button
          type="button"
          className="btn btn-success"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Salvando…" : "💾 Salvar Produto"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          ✕ Cancelar
        </button>
      </div>
    </Modal>
  );
}