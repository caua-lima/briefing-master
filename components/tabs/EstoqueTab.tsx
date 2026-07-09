"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { EstoqueMovimento, MovimentoTipo, Product } from "@/lib/domain/types";
import { addMovimento, deleteMovimento, deleteProduct, upsertProduct, watchMovimentos } from "@/lib/firebase/data";
import { fmtBRL } from "@/lib/domain/calc";
import Modal from "@/components/Modal";
import type { UserData } from "@/components/useUserData";
import { authedFetch } from "@/lib/api/authed-fetch";

type EstoqueML = Record<string, { available: number; sold: number; status: string }>;

function newId() {
  return "p" + Date.now() + Math.random().toString(36).slice(2, 6);
}
function newMovId() {
  return "mov" + Date.now() + Math.random().toString(36).slice(2, 6);
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseNum(s: string): number {
  const n = parseFloat(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function mlbsDe(p: Product): string[] {
  if (p.mlbs && p.mlbs.length) return p.mlbs;
  return p.mlb ? [p.mlb] : [];
}

function normMlb(s: string) {
  const up = s.trim().toUpperCase();
  return up.startsWith("MLB") ? up : up ? `MLB${up}` : "";
}

function custoMedioDe(p: Product): number {
  return p.custoMedio ?? parseNum(p.custo);
}

export default function EstoqueTab({ uid, data }: { uid: string; data: UserData }) {
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState("");
  const [estoqueML, setEstoqueML] = useState<EstoqueML>({});
  const [loadingML, setLoadingML] = useState(false);
  const [movimentos, setMovimentos] = useState<EstoqueMovimento[]>([]);
  const [movModal, setMovModal] = useState<{ product: Product; tipo: MovimentoTipo } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const carregarEstoque = useCallback(async () => {
    setLoadingML(true);
    try {
      const res = await authedFetch("/api/ml/estoque-ml", { cache: "no-store" });
      if (res.ok) setEstoqueML((await res.json()).estoque ?? {});
    } catch { /* ignora */ } finally { setLoadingML(false); }
  }, []);

  useEffect(() => { carregarEstoque(); }, [carregarEstoque]);
  useEffect(() => watchMovimentos(setMovimentos), []);

  const movsPorProduto = useMemo(() => {
    const map = new Map<string, EstoqueMovimento[]>();
    for (const m of movimentos) {
      const arr = map.get(m.productId) ?? [];
      arr.push(m);
      map.set(m.productId, arr);
    }
    return map;
  }, [movimentos]);

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
  const unGalpao = data.products.reduce((s, p) => s + (p.qtdLocal ?? 0), 0);
  const valorEstoque = data.products.reduce((s, p) => s + Math.max(p.qtdLocal ?? 0, 0) * custoMedioDe(p), 0);
  const unFull = Object.values(estoqueML).reduce((s, v) => s + v.available, 0);

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
            {loadingML ? "⏳ Atualizando..." : "⟳ Atualizar Full (ML)"}
          </button>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={onAdd}>＋ Novo Produto</button>
      </div>

      {/* Resumo */}
      <div className="kpi-grid">
        <div className="kpi k-acc"><div className="k-lbl">Produtos</div><div className="k-val">{total}</div><div className="k-sub">{ativos} ativos</div></div>
        <div className="kpi k-pos"><div className="k-lbl">Valor em estoque</div><div className="k-val" style={{ color: "var(--green)" }}>{fmtBRL(valorEstoque)}</div><div className="k-sub">galpão × custo médio</div></div>
        <div className="kpi k-warn"><div className="k-lbl">Estoque no galpão</div><div className="k-val" style={{ color: "var(--yellow)" }}>{unGalpao} un</div><div className="k-sub">controle manual</div></div>
        <div className="kpi k-pos"><div className="k-lbl">Estoque no Full (ML)</div><div className="k-val" style={{ color: unFull > 0 ? "var(--green)" : "var(--muted)" }}>{unFull} un</div><div className="k-sub">ao vivo do Mercado Livre</div></div>
      </div>

      {/* Busca */}
      <input
        type="text" placeholder="🔍 Buscar por nome, SKU ou código MLB…" value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", color: "var(--text)", fontSize: ".9rem", outline: "none", boxSizing: "border-box" }}
      />

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
                  <th>Galpão</th><th>Full (ML)</th><th>Total</th>
                  <th>Custo médio</th><th>Imposto</th>
                  <th>Movimentar</th><th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <ProductRow
                    key={p.id}
                    product={p}
                    uid={uid}
                    estoqueML={estoqueML}
                    movs={movsPorProduto.get(p.id) ?? []}
                    expanded={expanded === p.id}
                    onToggle={() => setExpanded((cur) => (cur === p.id ? null : p.id))}
                    onEdit={() => setEditProduct({ ...p, mlbs: mlbsDe(p) })}
                    onMov={(tipo) => setMovModal({ product: p, tipo })}
                  />
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

      {movModal && (
        <MovimentoModal
          product={movModal.product}
          tipo={movModal.tipo}
          onClose={() => setMovModal(null)}
          onSaved={() => setMovModal(null)}
        />
      )}
    </div>
  );
}

const TIPO_LABEL: Record<MovimentoTipo, string> = {
  entrada: "Entrada",
  saida_full: "Envio Full",
  ajuste: "Ajuste",
};

function ProductRow({
  product, estoqueML, movs, expanded, onToggle, onEdit, onMov,
}: {
  product: Product;
  uid: string;
  estoqueML: EstoqueML;
  movs: EstoqueMovimento[];
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onMov: (tipo: MovimentoTipo) => void;
}) {
  const imposto = parseNum(product.imposto ?? "0");
  const mlbs = mlbsDe(product);
  const estoqueDe = (m: string) => estoqueML[normMlb(m)]?.available;
  const full = mlbs.reduce((s, m) => s + (estoqueDe(m) ?? 0), 0);
  const temFull = mlbs.some((m) => estoqueDe(m) != null);
  const galpao = product.qtdLocal ?? 0;
  const custoMedio = custoMedioDe(product);
  const totalUn = galpao + (temFull ? full : 0);

  return (
    <>
      <tr style={{ opacity: product.ativo ? 1 : 0.5 }}>
        <td style={{ textAlign: "left" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button type="button" onClick={onToggle} title="Ver movimentações" style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: ".8rem", transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▶</button>
            <div>
              <div style={{ fontWeight: 600 }}>{product.name || <em style={{ color: "var(--muted)" }}>Sem nome</em>}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 3 }}>
                {product.sku
                  ? <span style={{ background: "rgba(79,142,247,.12)", color: "#4f8ef7", padding: "1px 7px", borderRadius: 6, fontWeight: 700, fontSize: ".7rem" }}>SKU {product.sku}</span>
                  : <span style={{ color: "var(--red)", fontSize: ".7rem" }}>⚠️ sem SKU</span>}
                {mlbs.map((m) => (
                  <span key={m} style={{ fontSize: ".7rem", background: "var(--surface2)", border: "1px solid var(--border)", padding: "1px 6px", borderRadius: 5, color: "var(--muted)" }}>{m}</span>
                ))}
              </div>
            </div>
          </div>
        </td>
        <td style={{ fontWeight: 700, color: galpao > 0 ? "var(--yellow)" : "var(--muted)" }}>{galpao} un</td>
        <td style={{ fontWeight: 700, color: !temFull ? "var(--muted)" : full > 0 ? "var(--green)" : "var(--red)" }}>{temFull ? `${full} un` : "—"}</td>
        <td style={{ fontWeight: 700 }}>{totalUn} un</td>
        <td style={{ color: custoMedio > 0 ? "var(--text)" : "var(--muted)", fontWeight: 600 }}>
          {custoMedio > 0 ? fmtBRL(custoMedio) : "—"}
          {product.custoMedio == null && custoMedio > 0 && <span style={{ display: "block", fontSize: ".62rem", color: "var(--muted)" }}>manual</span>}
        </td>
        <td style={{ color: imposto > 0 ? "var(--red)" : "var(--muted)" }}>{imposto > 0 ? `${imposto.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "—"}</td>
        <td>
          <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
            <button type="button" className="btn btn-success btn-xs" title="Entrada (compra)" onClick={() => onMov("entrada")}>＋ Entrada</button>
            <button type="button" className="btn btn-ghost btn-xs" title="Enviar pro Full (baixa, não é venda)" onClick={() => onMov("saida_full")}>➖ Full</button>
          </div>
        </td>
        <td>
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-warning btn-xs" title="Editar produto" onClick={onEdit}>✏️</button>
            <button type="button" className="btn btn-danger btn-xs" title="Remover produto" onClick={() => { if (!confirm(`Remover "${product.name}"?`)) return; deleteProduct("", product.id).catch(() => {}); }}>🗑</button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} style={{ background: "var(--bg)", padding: "10px 14px" }}>
            <MovimentosHistorico product={product} movs={movs} onMov={onMov} />
          </td>
        </tr>
      )}
    </>
  );
}

function MovimentosHistorico({ product, movs, onMov }: { product: Product; movs: EstoqueMovimento[]; onMov: (tipo: MovimentoTipo) => void }) {
  const ordenados = [...movs].sort((a, b) => (b.data ?? "").localeCompare(a.data ?? "") || (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: ".74rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em" }}>Movimentações</span>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => onMov("ajuste")}>⚖️ Ajuste / perda</button>
      </div>
      {ordenados.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: ".8rem", padding: "6px 0" }}>Nenhuma movimentação ainda. Use <b>＋ Entrada</b> para lançar a primeira compra.</div>
      ) : (
        <div className="table-wrapper" style={{ border: "1px solid var(--border)" }}>
          <table className="tbl-modern">
            <thead>
              <tr><th>Data</th><th style={{ textAlign: "left" }}>Tipo</th><th>Qtd</th><th>Custo un.</th><th style={{ textAlign: "left" }}>Obs</th><th></th></tr>
            </thead>
            <tbody>
              {ordenados.map((m) => {
                const sign = m.tipo === "entrada" ? "+" : m.tipo === "saida_full" ? "−" : (m.quantidade >= 0 ? "+" : "−");
                const cor = m.tipo === "entrada" ? "var(--green)" : m.tipo === "saida_full" ? "var(--yellow)" : (m.quantidade >= 0 ? "var(--green)" : "var(--red)");
                return (
                  <tr key={m.id}>
                    <td style={{ color: "var(--muted)" }}>{m.data}</td>
                    <td style={{ textAlign: "left" }}><span style={{ color: cor, fontWeight: 700 }}>{TIPO_LABEL[m.tipo]}</span></td>
                    <td style={{ color: cor, fontWeight: 700 }}>{sign}{Math.abs(m.quantidade)}</td>
                    <td>{m.tipo === "entrada" && m.custoUnit != null ? fmtBRL(m.custoUnit) : "—"}</td>
                    <td style={{ textAlign: "left", color: "var(--muted)", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.obs || "—"}</td>
                    <td>
                      <button type="button" className="btn btn-danger btn-xs" title="Excluir movimentação" onClick={() => { if (!confirm("Excluir esta movimentação? O custo médio será recalculado.")) return; deleteMovimento(m.id, product.id).catch(() => {}); }}>🗑</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MovimentoModal({ product, tipo, onClose, onSaved }: { product: Product; tipo: MovimentoTipo; onClose: () => void; onSaved: () => void }) {
  const isEntrada = tipo === "entrada";
  const isAjuste = tipo === "ajuste";
  const [qtd, setQtd] = useState("");
  const [custo, setCusto] = useState(isEntrada ? (product.custoMedio ? String(product.custoMedio) : product.custo || "") : "");
  const [data, setData] = useState(todayISO());
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);

  const titulo = isEntrada ? "＋ Entrada (compra)" : tipo === "saida_full" ? "➖ Envio pro Full" : "⚖️ Ajuste de estoque";
  const icon = isEntrada ? "📥" : tipo === "saida_full" ? "🚚" : "⚖️";

  const qNum = parseNum(qtd);
  const cNum = parseNum(custo);
  const qAtual = product.qtdLocal ?? 0;
  const avgAtual = custoMedioDe(product);
  const novoAvg = isEntrada && qNum > 0 ? (qAtual * avgAtual + qNum * cNum) / (qAtual + qNum) : avgAtual;

  async function handleSave() {
    if (!qNum || (!isAjuste && qNum <= 0)) { alert("Informe a quantidade."); return; }
    if (isEntrada && cNum <= 0) { alert("Informe o custo unitário da compra."); return; }
    setSaving(true);
    try {
      await addMovimento({
        id: newMovId(),
        productId: product.id,
        tipo,
        quantidade: isAjuste ? qNum : Math.abs(qNum),
        custoUnit: isEntrada ? cNum : undefined,
        data,
        obs: obs.trim() || undefined,
      });
      onSaved();
    } catch (err: unknown) {
      alert("Erro ao salvar movimentação: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <div className="modal-icon">{icon}</div>
      <div className="modal-title">{titulo}</div>
      <div className="modal-sub">{product.name || "Produto"} · galpão atual: <b>{qAtual} un</b>{avgAtual > 0 && <> · custo médio {fmtBRL(avgAtual)}</>}</div>

      <div className="config-field">
        <label>{isAjuste ? "🔢 Quantidade (use − para baixa)" : "🔢 Quantidade (unidades)"}</label>
        <input type="number" step="1" placeholder={isAjuste ? "Ex: -3" : "Ex: 40"} value={qtd} onChange={(e) => setQtd(e.target.value)} />
      </div>

      {isEntrada && (
        <div className="config-field">
          <label>💰 Custo unitário desta compra (R$)</label>
          <input type="number" min="0" step="0.01" placeholder="Ex: 11.50" value={custo} onChange={(e) => setCusto(e.target.value)} />
          {qNum > 0 && cNum > 0 && (
            <div className="hint">
              Custo médio após esta entrada: <b style={{ color: "var(--green)" }}>{fmtBRL(novoAvg)}</b>
              {avgAtual > 0 && <> (era {fmtBRL(avgAtual)})</>}
            </div>
          )}
        </div>
      )}

      {tipo === "saida_full" && (
        <div style={{ margin: "4px 0 12px", padding: "8px 12px", borderRadius: 8, background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.25)", fontSize: ".78rem", color: "var(--muted)" }}>
          🚚 Baixa por <b>envio ao Full</b> — sai do galpão, mas <b>não é venda</b>. Não afeta o lucro; o custo só entra quando o produto vende.
        </div>
      )}

      <div className="config-field">
        <label>📅 Data</label>
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: ".9rem", outline: "none" }} />
      </div>

      <div className="config-field">
        <label>📝 Observação (opcional)</label>
        <input type="text" placeholder="Ex: fornecedor João, NF 123" value={obs} onChange={(e) => setObs(e.target.value)} />
      </div>

      <div className="modal-btns">
        <button type="button" className="btn btn-success" onClick={handleSave} disabled={saving}>{saving ? "Salvando…" : "💾 Lançar"}</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>✕ Cancelar</button>
      </div>
    </Modal>
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
        <label>💰 Custo manual do produto/unidade (R$)</label>
        <input type="number" min="0" step="0.01" placeholder="0.00" value={p.custo} onChange={(e) => set({ custo: e.target.value })} />
        <div className="hint">Usado só como fallback. Com <strong>entradas</strong> lançadas, o CMV usa o <strong>custo médio</strong> calculado automaticamente.</div>
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
