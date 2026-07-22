"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { impostoNaData, type EstoqueMovimento, type MovimentoTipo, type Product } from "@/lib/domain/types";
import { movIdRemessa, remessaTemBaixa, type Remessa } from "@/lib/domain/remessas";
import { addMovimento, deleteMovimento, deleteProduct, ignorarRemessaFull, reabrirRemessaFull, upsertProduct, watchMovimentos, watchRemessasIgnoradas } from "@/lib/firebase/data";
import { fmtBRL } from "@/lib/domain/calc";
import Modal from "@/components/Modal";
import type { UserData } from "@/components/useUserData";
import { authedFetch } from "@/lib/api/authed-fetch";
import { useAccess } from "@/components/tabs/AccessGuard";

type MlItem = { available: number; sold: number; status: string; price: number; regularPrice: number; hasPromo: boolean; logistic: string };
type EstoqueML = Record<string, MlItem>;
type Forecast = { vendas: Record<string, number>; dias: number };

function ehFullLogistic(l: string) {
  return l === "fulfillment";
}

// dias-alvo de cobertura pra sugestão de reposição
const DIAS_ALVO = 30;

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

// Anúncios (MLBs) do produto com os dados do ML de cada um.
type AnuncioML = { mlb: string; item: MlItem | null };
function anunciosDe(p: Product, estoqueML: EstoqueML): AnuncioML[] {
  return mlbsDe(p).map((m) => ({ mlb: normMlb(m), item: estoqueML[normMlb(m)] ?? null }));
}

// Estoque do ML por logística: qtd = Full (fulfillment); proprio = anúncio
// próprio (não-Full). ehFull = tem anúncio no Full. temDado = ML já respondeu.
function fullDe(p: Product, estoqueML: EstoqueML): { qtd: number; proprio: number; ehFull: boolean; temDado: boolean } {
  let qtd = 0, proprio = 0, ehFull = false, temDado = false;
  for (const { item } of anunciosDe(p, estoqueML)) {
    if (!item) continue;
    temDado = true;
    if (ehFullLogistic(item.logistic)) { ehFull = true; qtd += item.available; }
    else proprio += item.available;
  }
  return { qtd, proprio, ehFull, temDado };
}

// Full considerado "baixo" sugere reabastecer com o estoque de casa.
const FULL_BAIXO = 5;

// Faixa de preços dos anúncios (por anúncio, sem média). Retorna min/max/único.
function precosDe(p: Product, estoqueML: EstoqueML): { min: number; max: number; temPromo: boolean; count: number } {
  const precos: number[] = [];
  let temPromo = false;
  for (const { item } of anunciosDe(p, estoqueML)) {
    if (!item || !item.price) continue;
    precos.push(item.price);
    if (item.hasPromo) temPromo = true;
  }
  if (!precos.length) return { min: 0, max: 0, temPromo: false, count: 0 };
  return { min: Math.min(...precos), max: Math.max(...precos), temPromo, count: precos.length };
}

type PrevisaoProduto = {
  precoMin: number;
  precoMax: number;
  casa: number;
  full: number;
  proprio: number;
  ehFull: boolean;
  total: number;
  mediaDiaria: number;
  cobertura: number;    // dias até acabar o total (Infinity = sem vendas ou sem estoque)
  valorPotencial: number;
  reporQtd: number;     // unidades pra levar o Full a cobrir DIAS_ALVO (só produtos no Full)
};

function previsaoDe(p: Product, estoqueML: EstoqueML, forecast: Forecast): PrevisaoProduto {
  const casa = Math.max(p.qtdLocal ?? 0, 0);
  const { qtd: full, proprio, ehFull } = fullDe(p, estoqueML);
  const total = casa + full + proprio;
  const { min: precoMin, max: precoMax } = precosDe(p, estoqueML);
  // Venda potencial: cada anúncio pelo SEU preço (Full + próprio); o estoque de
  // casa pelo maior preço dos anúncios (sem média entre anúncios diferentes).
  let potencialAnuncios = 0;
  for (const { item } of anunciosDe(p, estoqueML)) {
    if (item) potencialAnuncios += item.available * item.price;
  }
  const valorPotencial = potencialAnuncios + casa * (precoMax || precoMin);
  const mediaDiaria = forecast.dias > 0 ? (forecast.vendas[p.id] ?? 0) / forecast.dias : 0;
  const cobertura = mediaDiaria > 0 && total > 0 ? total / mediaDiaria : Infinity;
  // Reposição só faz sentido pra quem está no Full.
  const reporQtd = ehFull && mediaDiaria > 0 ? Math.max(0, Math.ceil(mediaDiaria * DIAS_ALVO) - full) : 0;
  return { precoMin, precoMax, casa, full, proprio, ehFull, total, mediaDiaria, cobertura, valorPotencial, reporQtd };
}

export default function EstoqueTab({ uid, data }: { uid: string; data: UserData }) {
  const { canEdit } = useAccess();
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState("");
  const [estoqueML, setEstoqueML] = useState<EstoqueML>({});
  const [forecast, setForecast] = useState<Forecast>({ vendas: {}, dias: DIAS_ALVO });
  const [loadingML, setLoadingML] = useState(false);
  const [movimentos, setMovimentos] = useState<EstoqueMovimento[]>([]);
  const [movModal, setMovModal] = useState<{ product: Product; tipo: MovimentoTipo } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [impostoMassa, setImpostoMassa] = useState(false);

  const carregarEstoque = useCallback(async () => {
    setLoadingML(true);
    try {
      const [rMl, rFc] = await Promise.all([
        authedFetch("/api/ml/estoque-ml", { cache: "no-store" }),
        authedFetch(`/api/ml/estoque-forecast?dias=${DIAS_ALVO}`, { cache: "no-store" }),
      ]);
      if (rMl.ok) setEstoqueML((await rMl.json()).estoque ?? {});
      if (rFc.ok) { const j = await rFc.json(); setForecast({ vendas: j.vendas ?? {}, dias: j.dias ?? DIAS_ALVO }); }
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
  const unCasa = data.products.reduce((s, p) => s + (p.qtdLocal ?? 0), 0);
  // Só conta como Full o que é realmente fulfillment.
  const unFull = Object.values(estoqueML).reduce((s, v) => s + (ehFullLogistic(v.logistic) ? v.available : 0), 0);
  // Valor parado = (casa + Full + próprio) × custo médio.
  const valorEstoque = data.products.reduce((s, p) => {
    const casa = Math.max(p.qtdLocal ?? 0, 0);
    const { qtd: full, proprio } = fullDe(p, estoqueML);
    return s + (casa + full + proprio) * custoMedioDe(p);
  }, 0);
  // Produtos NO FULL com estoque baixo E unidades em casa pra reabastecer.
  const reabastecer = data.products.filter((p) => {
    const f = fullDe(p, estoqueML);
    return f.ehFull && f.qtd <= FULL_BAIXO && (p.qtdLocal ?? 0) > 0;
  });
  // Venda potencial = todo o estoque × preço de venda atual do ML.
  const valorPotencialVenda = data.products.reduce((s, p) => s + previsaoDe(p, estoqueML, forecast).valorPotencial, 0);

  function onAdd() {
    setEditProduct({ id: newId(), name: "", custo: "", sku: "", imposto: "", mlbs: [""], ativo: true });
  }

  return (
    <div className="dash">
      {/* Header */}
      <div className="dash-top">
        <div className="dash-top-left">
          <h2 style={{ fontSize: "1.15rem", fontWeight: 800 }}>Estoque de Produtos</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={carregarEstoque} disabled={loadingML}>
            {loadingML ? "Atualizando..." : "⟳ Atualizar Full (ML)"}
          </button>
        </div>
        {canEdit && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setImpostoMassa(true)}>
              Imposto em massa
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={onAdd}>＋ Novo Produto</button>
          </div>
        )}
      </div>

      {/* Resumo */}
      <div className="kpi-grid">
        <div className="kpi k-acc"><div className="k-lbl">Produtos</div><div className="k-val">{total}</div><div className="k-sub">{ativos} ativos</div></div>
        <div className="kpi k-pos"><div className="k-lbl">Valor em estoque</div><div className="k-val" style={{ color: "var(--green)" }}>{fmtBRL(valorEstoque)}</div><div className="k-sub">(casa + Full) × custo médio</div></div>
        <div className="kpi k-warn"><div className="k-lbl">Em casa</div><div className="k-val" style={{ color: "var(--yellow)" }}>{unCasa} un</div><div className="k-sub">controle manual</div></div>
        <div className="kpi k-pos"><div className="k-lbl">No Full (ML)</div><div className="k-val" style={{ color: unFull > 0 ? "var(--green)" : "var(--muted)" }}>{unFull} un</div><div className="k-sub">ao vivo do Mercado Livre</div></div>
        <div className="kpi k-acc"><div className="k-lbl">Venda potencial</div><div className="k-val">{fmtBRL(valorPotencialVenda)}</div><div className="k-sub">estoque × preço ML atual</div></div>
      </div>

      {/* Busca */}
      <input
        type="text" placeholder="Buscar por nome, SKU ou código MLB…" value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", color: "var(--text)", fontSize: ".9rem", outline: "none", boxSizing: "border-box" }}
      />

      {reabastecer.length > 0 && (
        <div style={{ padding: "9px 13px", background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.35)", borderRadius: 8, fontSize: ".8rem", color: "#f7c948" }}>
          <b>Full baixo</b> em {reabastecer.length} produto(s) — você tem unidades em casa pra enviar:{" "}
          {reabastecer.slice(0, 6).map((p) => p.name || "sem nome").join(", ")}{reabastecer.length > 6 ? "…" : ""}
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
                  <th style={{ textAlign: "right" }}>Em casa</th>
                  <th style={{ textAlign: "right" }}>Full (ML)</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th style={{ textAlign: "right" }}>Custo médio</th>
                  <th style={{ textAlign: "right" }}>Preço venda</th>
                  <th style={{ textAlign: "right" }}>Imposto</th>
                  <th style={{ textAlign: "center" }}>Movimentar</th>
                  <th style={{ textAlign: "right" }}>Ações</th>
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

      <PrevisaoPanel products={filtered} estoqueML={estoqueML} forecast={forecast} />

      {canEdit && <RemessasFull movimentos={movimentos} />}

      {impostoMassa && (
        <ImpostoMassaModal
          uid={uid}
          produtos={filtered}
          escopoBusca={search.trim()}
          onClose={() => setImpostoMassa(false)}
        />
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

      {movModal && (
        <MovimentoModal
          product={movModal.product}
          tipo={movModal.tipo}
          estoqueML={estoqueML}
          onClose={() => setMovModal(null)}
          onSaved={() => setMovModal(null)}
        />
      )}
    </div>
  );
}

const TIPO_LABEL: Record<MovimentoTipo, string> = {
  entrada: "Entrada",
  saldo_inicial: "Custo do Full",
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
  const anuncios = anunciosDe(product, estoqueML);
  const { qtd: full, proprio, ehFull } = fullDe(product, estoqueML);
  const casa = product.qtdLocal ?? 0;
  const custoMedio = custoMedioDe(product);
  const totalUn = casa + full + proprio;
  const fullBaixo = ehFull && full <= FULL_BAIXO;
  const { min: precoMin, max: precoMax, temPromo } = precosDe(product, estoqueML);

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
                  : <span style={{ color: "var(--red)", fontSize: ".7rem" }}>sem SKU</span>}
                {anuncios.map(({ mlb, item }) => (
                  <span key={mlb} style={{ fontSize: ".7rem", background: "var(--surface2)", border: "1px solid var(--border)", padding: "1px 6px", borderRadius: 5, color: "var(--muted)" }}>
                    {mlb}
                    {item && item.price > 0 && <b style={{ color: "var(--green)", marginLeft: 4 }}>{fmtBRL(item.price)}</b>}
                    {item && item.hasPromo && <span style={{ marginLeft: 4, fontSize: ".62rem", color: "#f7c948", fontWeight: 700 }}>promo</span>}
                    {item && <span style={{ marginLeft: 4, color: ehFullLogistic(item.logistic) ? "#4f8ef7" : "var(--muted)" }}>{ehFullLogistic(item.logistic) ? "Full" : "próprio"}</span>}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </td>
        <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap", color: casa > 0 ? "var(--yellow)" : "var(--muted)" }}>{casa} un</td>
        <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap", color: !ehFull ? "var(--muted)" : fullBaixo ? "var(--red)" : "var(--green)" }}>
          {ehFull ? `${full} un` : "—"}
          {fullBaixo && casa > 0 && <span title="Envie de casa pro Full" style={{ display: "block", fontSize: ".62rem", color: "#f7c948" }}>reabastecer</span>}
          {proprio > 0 && <span title="Anúncio próprio (não é Full)" style={{ display: "block", fontSize: ".62rem", color: "var(--muted)", fontWeight: 400 }}>{proprio} un próprio</span>}
        </td>
        <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{totalUn} un</td>
        <td style={{ textAlign: "right", whiteSpace: "nowrap", color: custoMedio > 0 ? "var(--text)" : "var(--muted)", fontWeight: 600 }}>
          {custoMedio > 0 ? fmtBRL(custoMedio) : "—"}
          {product.custoMedio == null && custoMedio > 0 && <span style={{ display: "block", fontSize: ".62rem", color: "var(--muted)" }}>manual</span>}
        </td>
        <td style={{ textAlign: "right", color: precoMax > 0 ? "var(--green)" : "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>
          {precoMax > 0 ? (precoMin === precoMax ? fmtBRL(precoMax) : `${fmtBRL(precoMin)}–${fmtBRL(precoMax)}`) : "—"}
          {temPromo && <span style={{ display: "block", fontSize: ".62rem", color: "#f7c948" }}>promoção</span>}
        </td>
        <td style={{ textAlign: "right", whiteSpace: "nowrap", color: imposto > 0 ? "var(--red)" : "var(--muted)" }}>{imposto > 0 ? `${imposto.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "—"}</td>
        <td>
          <div style={{ display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-success btn-xs" title="Entrada (compra)" onClick={() => onMov("entrada")}>＋ Entrada</button>
            <button type="button" className="btn btn-ghost btn-xs" title="Enviar de casa pro Full (baixa, não é venda)" onClick={() => onMov("saida_full")}>Enviar Full</button>
            {ehFull && full > 0 && (
              <button
                type="button"
                className={custoMedio > 0 ? "btn btn-ghost btn-xs" : "btn btn-warning btn-xs"}
                title="Informar o custo das unidades que já estão no Full, pra o lucro sair certo"
                onClick={() => onMov("saldo_inicial")}
              >
                {custoMedio > 0 ? "Custo Full" : "Custear Full"}
              </button>
            )}
          </div>
        </td>
        <td>
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-warning btn-xs" title="Editar produto" onClick={onEdit}>Editar</button>
            <button type="button" className="btn btn-danger btn-xs" title="Remover produto" onClick={() => { if (!confirm(`Remover "${product.name}"?`)) return; deleteProduct("", product.id).catch(() => {}); }}>Excluir</button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={9} style={{ background: "var(--bg)", padding: "10px 14px" }}>
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
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => onMov("saldo_inicial")}>Custo do Full</button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => onMov("ajuste")}>Ajuste / perda</button>
        </div>
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
                const isCompra = m.tipo === "entrada" || m.tipo === "saldo_inicial";
                const sign = isCompra ? "+" : m.tipo === "saida_full" ? "−" : (m.quantidade >= 0 ? "+" : "−");
                const cor = isCompra ? "var(--green)" : m.tipo === "saida_full" ? "var(--yellow)" : (m.quantidade >= 0 ? "var(--green)" : "var(--red)");
                return (
                  <tr key={m.id}>
                    <td style={{ color: "var(--muted)" }}>{m.data}</td>
                    <td style={{ textAlign: "left" }}><span style={{ color: cor, fontWeight: 700 }}>{TIPO_LABEL[m.tipo]}</span></td>
                    <td style={{ color: cor, fontWeight: 700 }}>{sign}{Math.abs(m.quantidade)}</td>
                    <td>{(m.tipo === "entrada" || m.tipo === "saldo_inicial") && m.custoUnit != null ? fmtBRL(m.custoUnit) : "—"}</td>
                    <td style={{ textAlign: "left", color: "var(--muted)", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.obs || "—"}</td>
                    <td>
                      <button type="button" className="btn btn-danger btn-xs" title="Excluir movimentação" onClick={() => { if (!confirm("Excluir esta movimentação? O custo médio será recalculado.")) return; deleteMovimento(m.id, product.id).catch(() => {}); }}>Excluir</button>
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

function MovimentoModal({ product, tipo, estoqueML, onClose, onSaved }: { product: Product; tipo: MovimentoTipo; estoqueML: EstoqueML; onClose: () => void; onSaved: () => void }) {
  const isEntrada = tipo === "entrada";
  const isSaldo = tipo === "saldo_inicial";
  const isAjuste = tipo === "ajuste";
  const precisaCusto = isEntrada || isSaldo;

  const { qtd: full, proprio } = fullDe(product, estoqueML);
  const casa = product.qtdLocal ?? 0;
  const avgAtual = custoMedioDe(product);

  // Saldo inicial serve pra custear o que JÁ ESTÁ no Full: pré-preenche com a
  // quantidade que o ML mostra no Full, pra você só confirmar o custo.
  const [qtd, setQtd] = useState(isSaldo && full > 0 ? String(full) : "");
  const [custo, setCusto] = useState(precisaCusto ? (product.custoMedio ? String(product.custoMedio) : product.custo || "") : "");
  const [data, setData] = useState(todayISO());
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);

  const titulo = isEntrada ? "＋ Entrada (compra)" : isSaldo ? "Custo do que está no Full" : tipo === "saida_full" ? "Envio pro Full" : "Ajuste de estoque";

  const qNum = parseNum(qtd);
  const cNum = parseNum(custo);

  // ENTRADA: blenda a compra nova contra tudo que você tem (casa+Full+próprio).
  const estoqueAtual = casa + full + proprio;
  const novoAvgEntrada = qNum > 0 && estoqueAtual + qNum > 0
    ? (estoqueAtual * avgAtual + qNum * cNum) / (estoqueAtual + qNum)
    : avgAtual;

  // SALDO INICIAL (Full): as unidades do Full ainda não têm custo. Blenda elas,
  // ao custo informado, contra o que está FORA do Full (casa + próprio), que já
  // reflete o custo médio atual. Sem estoque fora do Full, o custo do Full vira
  // o próprio custo médio. Antes o saldo SOBRESCREVIA o custo médio — errado
  // quando já havia estoque em casa com custo.
  const foraDoFull = casa + proprio;
  const novoAvgSaldo = qNum > 0
    ? (avgAtual > 0 && foraDoFull > 0
        ? (foraDoFull * avgAtual + qNum * cNum) / (foraDoFull + qNum)
        : cNum)
    : avgAtual;

  const novoAvg = isEntrada ? novoAvgEntrada : novoAvgSaldo;

  async function handleSave() {
    if (!qNum || (!isAjuste && qNum <= 0)) { alert("Informe a quantidade."); return; }
    if (precisaCusto && cNum <= 0) { alert("Informe o custo unitário."); return; }
    setSaving(true);
    try {
      await addMovimento({
        id: newMovId(),
        productId: product.id,
        tipo,
        quantidade: isAjuste ? qNum : Math.abs(qNum),
        custoUnit: precisaCusto ? cNum : undefined,
        data,
        obs: obs.trim() || undefined,
        // Entrada e saldo do Full gravam o custo médio recalculado.
      }, precisaCusto ? novoAvg : undefined);
      onSaved();
    } catch (err: unknown) {
      alert("Erro ao salvar movimentação: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <div className="modal-title">{titulo}</div>
      <div className="modal-sub">{product.name || "Produto"} · estoque atual: <b>{estoqueAtual} un</b>{avgAtual > 0 && <> · custo médio {fmtBRL(avgAtual)}</>}</div>

      <div className="config-field">
        <label>{isAjuste ? "Quantidade (use − para baixa)" : "Quantidade (unidades)"}</label>
        <input type="number" step="1" placeholder={isAjuste ? "Ex: -3" : "Ex: 40"} value={qtd} onChange={(e) => setQtd(e.target.value)} />
      </div>

      {precisaCusto && (
        <div className="config-field">
          <label>Custo unitário {isSaldo ? "das unidades no Full" : "desta compra"} (R$)</label>
          <input type="number" min="0" step="0.01" placeholder="Ex: 11.50" value={custo} onChange={(e) => setCusto(e.target.value)} />
          {qNum > 0 && cNum > 0 && (
            <div className="hint">
              Custo médio {isSaldo ? "depois de custear o Full" : "após esta entrada"}: <b style={{ color: "var(--green)" }}>{fmtBRL(novoAvg)}</b>
              {avgAtual > 0 && Math.abs(novoAvg - avgAtual) > 0.001 && <> (era {fmtBRL(avgAtual)})</>}
            </div>
          )}
        </div>
      )}

      {isSaldo && (
        <div style={{ margin: "4px 0 12px", padding: "8px 12px", borderRadius: 8, background: "rgba(79,142,247,.08)", border: "1px solid rgba(79,142,247,.2)", fontSize: ".78rem", color: "var(--muted)" }}>
          {full > 0
            ? <>O ML mostra <b>{full} un</b> deste produto no Full sem custo lançado. Informe quanto você pagou por unidade — isso <b>entra no custo médio</b> pra o lucro sair certo quando elas venderem. Não soma no “em casa” (já estão fora).</>
            : <>Use pra custear unidades que <b>já estavam no estoque</b> antes de você começar a lançar (ex.: o que está no Full). Entra na média do custo, mas <b>não soma no “em casa”</b>.</>}
        </div>
      )}

      {tipo === "saida_full" && (
        <div style={{ margin: "4px 0 12px", padding: "8px 12px", borderRadius: 8, background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.25)", fontSize: ".78rem", color: "var(--muted)" }}>
          Baixa por <b>envio ao Full</b> — sai de casa e vai pro Full, mas <b>não é venda</b>. Não afeta o lucro; o custo só entra quando o produto vende.
        </div>
      )}

      <div className="config-field">
        <label>Data</label>
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: ".9rem", outline: "none" }} />
      </div>

      <div className="config-field">
        <label>Observação (opcional)</label>
        <input type="text" placeholder="Ex: fornecedor João, NF 123" value={obs} onChange={(e) => setObs(e.target.value)} />
      </div>

      <div className="modal-btns">
        <button type="button" className="btn btn-success" onClick={handleSave} disabled={saving}>{saving ? "Salvando…" : "Lançar"}</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}

function coberturaFmt(dias: number): { txt: string; cor: string } {
  if (!Number.isFinite(dias)) return { txt: "—", cor: "var(--muted)" };
  const d = Math.round(dias);
  const cor = d <= 7 ? "var(--red)" : d <= 15 ? "var(--yellow)" : "var(--green)";
  return { txt: `${d}d`, cor };
}

function PrevisaoPanel({ products, estoqueML, forecast }: { products: Product[]; estoqueML: EstoqueML; forecast: Forecast }) {
  const linhas = products
    .map((p) => ({ p, f: previsaoDe(p, estoqueML, forecast) }))
    .filter(({ f }) => f.total > 0 || f.mediaDiaria > 0 || f.precoMax > 0)
    .sort((a, b) => b.f.valorPotencial - a.f.valorPotencial);

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <span className="panel-title">Previsão de vendas e reposição</span>
        <span className="panel-sub">preço atual do ML · média dos últimos {forecast.dias} dias · repor p/ cobrir {DIAS_ALVO} dias</span>
      </div>
      {linhas.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: ".82rem", padding: "8px 0" }}>Sem dados de estoque/vendas ainda. Lance entradas e aguarde vendas para a previsão aparecer.</div>
      ) : (
        <div className="table-wrapper" style={{ border: "none" }}>
          <table className="tbl-modern">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Produto</th>
                <th style={{ textAlign: "right" }}>Preço ML</th>
                <th style={{ textAlign: "right" }}>Estoque total</th>
                <th style={{ textAlign: "right" }}>Vendas/dia</th>
                <th style={{ textAlign: "right" }}>Cobertura</th>
                <th style={{ textAlign: "right" }}>Repor (Full)</th>
                <th style={{ textAlign: "right" }}>Venda potencial</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(({ p, f }) => {
                const cob = coberturaFmt(f.cobertura);
                const emCasa = Math.min(f.reporQtd, f.casa);
                return (
                  <tr key={p.id}>
                    <td style={{ textAlign: "left", fontWeight: 600 }}>{p.name || "Sem nome"}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{f.precoMax > 0 ? (f.precoMin === f.precoMax ? fmtBRL(f.precoMax) : `${fmtBRL(f.precoMin)}–${fmtBRL(f.precoMax)}`) : "—"}</td>
                    <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{f.total} un</td>
                    <td style={{ textAlign: "right", color: f.mediaDiaria > 0 ? "var(--text)" : "var(--muted)" }}>{f.mediaDiaria > 0 ? f.mediaDiaria.toFixed(1) : "—"}</td>
                    <td style={{ textAlign: "right", color: cob.cor, fontWeight: 700 }}>{cob.txt}</td>
                    <td style={{ textAlign: "right" }}>
                      {f.reporQtd > 0 ? (
                        <span style={{ color: "var(--yellow)", fontWeight: 700 }}>
                          {f.reporQtd} un
                          {emCasa > 0 && (
                            <span style={{ display: "block", fontSize: ".64rem", color: "var(--muted)", fontWeight: 400 }}>
                              {emCasa} em casa{f.reporQtd > emCasa ? ` · comprar ${f.reporQtd - emCasa}` : ""}
                            </span>
                          )}
                        </span>
                      ) : <span style={{ color: "var(--muted)" }}>ok</span>}
                    </td>
                    <td style={{ textAlign: "right", color: "var(--green)", fontWeight: 700, whiteSpace: "nowrap" }}>{fmtBRL(f.valorPotencial)}</td>
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

export function ProductModal({ product: initial, isNew, onClose, onSave }: { product: Product; isNew: boolean; onClose: () => void; onSave: (p: Product) => Promise<void> }) {
  const [p, setP] = useState<Product>({ ...initial, mlbs: mlbsDe(initial).length ? mlbsDe(initial) : [""] });
  // Custo do estoque atual (custo médio efetivo). É o ponto de partida do blend.
  const [custoStr, setCustoStr] = useState(
    initial.custoMedio != null ? String(Math.round(initial.custoMedio * 100) / 100) : (initial.custo ?? ""),
  );
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
    // O custo digitado vira o custo médio efetivo (base do estoque atual).
    const saveObj: Product = { ...p, mlbs: cleaned, mlb: cleaned[0] ?? "", custo: custoStr };
    if (custoStr.trim()) saveObj.custoMedio = parseNum(custoStr);
    else delete saveObj.custoMedio;

    /**
     * O cálculo do lucro dá prioridade às faixas de vigência. Se o produto já
     * tem faixas, mexer só no campo `imposto` não teria efeito nenhum — então
     * a alteração vira uma faixa valendo de hoje, sem tocar no passado.
     */
    const pctNovo = parseNum(p.imposto ?? "0");
    const faixasAtuais = p.impostoFaixas ?? [];
    if (faixasAtuais.length && pctNovo !== impostoNaData({ impostoFaixas: faixasAtuais }, todayISO())) {
      const faixas = faixasAtuais.filter((f) => f.desde !== todayISO());
      faixas.push({ desde: todayISO(), pct: pctNovo });
      faixas.sort((a, b) => a.desde.localeCompare(b.desde));
      saveObj.impostoFaixas = faixas;
    }
    setSaving(true);
    try {
      await onSave(saveObj);
    } catch (err: unknown) {
      alert("Erro ao salvar produto: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <div className="modal-title">{isNew ? "Novo Produto" : "Editar Produto"}</div>

      <div className="config-field">
        <label>Nome do produto</label>
        <input type="text" placeholder="Ex: Kit Erva Mate Trot's 1,25kg" value={p.name} onChange={(e) => set({ name: e.target.value })} />
      </div>

      <div className="config-field">
        <label>SKU (código interno)</label>
        <input type="text" placeholder="Ex: 250" value={p.sku ?? ""} onChange={(e) => set({ sku: e.target.value })} />
        <div className="hint">Deve ser <strong>idêntico</strong> ao <code>sku</code> que aparece nos pedidos do ML.</div>
      </div>

      <div className="config-field">
        <label>Anúncios / Códigos MLB</label>
        {mlbs.map((m, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input type="text" placeholder="Ex: MLB1234567890" value={m} onChange={(e) => setMlb(i, e.target.value)} style={{ flex: 1 }} />
            {mlbs.length > 1 && (
              <button type="button" className="btn btn-danger btn-xs" onClick={() => removeMlb(i)} style={{ flexShrink: 0 }}>Remover</button>
            )}
          </div>
        ))}
        <button type="button" className="btn btn-ghost btn-xs" onClick={addMlb} style={{ marginTop: 2 }}>＋ Adicionar anúncio (MLB)</button>
        <div className="hint">Vários anúncios do mesmo produto (preços diferentes, mesmo custo). Todos vinculam as vendas a este produto.</div>
      </div>

      <div className="config-field">
        <label>Custo do estoque atual — R$/unidade (inclui o que já está no Full)</label>
        <input type="number" min="0" step="0.01" placeholder="Ex: 13.80" value={custoStr} onChange={(e) => setCustoStr(e.target.value)} />
        <div className="hint">Informe o custo das unidades que você <strong>já tem hoje</strong> (galpão + Full). A cada <strong>＋ Entrada</strong>, esse custo é ajustado sozinho pela média — vai ficando certinho.</div>
      </div>

      <div className="config-field">
        <label>Imposto sobre a venda (%)</label>
        <input type="number" min="0" step="0.01" placeholder="Ex: 8" value={p.imposto ?? ""} onChange={(e) => set({ imposto: e.target.value })} />
        <div className="hint">
          Percentual de imposto pago sobre o valor da venda.
          {!!p.impostoFaixas?.length && (
            <> Vigências: {[...p.impostoFaixas]
              .sort((a, b) => a.desde.localeCompare(b.desde))
              .map((f) => `${f.pct}% desde ${f.desde.split("-").reverse().join("/")}`)
              .join(" · ")}. Alterar aqui cria uma vigência a partir de hoje, sem mexer no passado.</>
          )}
        </div>
      </div>

      <div style={{ margin: "4px 0 12px", padding: "8px 12px", borderRadius: 8, background: "rgba(79,142,247,.08)", border: "1px solid rgba(79,142,247,.2)", fontSize: ".78rem", color: "var(--muted)" }}>
        <strong>Preço de venda</strong> e <strong>retorno</strong>, além de ADS e Envio Full, são puxados automaticamente do Mercado Livre — não precisa cadastrar.
      </div>

      <div className="config-field">
        <label>Status</label>
        <select
          value={p.ativo ? "ativo" : "inativo"}
          onChange={(e) => set({ ativo: e.target.value === "ativo" })}
          style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: ".9rem", outline: "none" }}
        >
          <option value="ativo">Ativo (em estoque)</option>
          <option value="inativo">Inativo (fora de estoque)</option>
        </select>
      </div>

      <div className="modal-btns">
        <button type="button" className="btn btn-success" onClick={handleSave} disabled={saving}>{saving ? "Salvando…" : "Salvar Produto"}</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}

// ── Imposto em massa ──────────────────────────────────────────────────────
/**
 * O imposto fica no cadastro do produto e o lucro o aplica na hora de ler.
 * Ou seja, mudar aqui muda também o lucro dos meses já fechados — por isso o
 * aviso é explícito antes de gravar.
 */
function ImpostoMassaModal({ uid, produtos, escopoBusca, onClose }: {
  uid: string; produtos: Product[]; escopoBusca: string; onClose: () => void;
}) {
  const [valor, setValor] = useState("4");
  const [desde, setDesde] = useState(todayISO());
  const [salvando, setSalvando] = useState(false);
  const [feito, setFeito] = useState(0);

  const pct = parseNum(valor);
  const jaTem = produtos.filter((p) => parseNum(p.imposto ?? "0") > 0);

  async function aplicar() {
    if (!Number.isFinite(pct) || pct < 0) { alert("Informe um percentual válido."); return; }
    if (!desde) { alert("Informe a data de início."); return; }
    setSalvando(true);
    try {
      let n = 0;
      for (const p of produtos) {
        /**
         * Substitui a faixa da mesma data e mantém as demais: assim dá pra
         * corrigir a alíquota sem perder o histórico de vigências.
         */
        const faixas = (p.impostoFaixas ?? []).filter((f) => f.desde !== desde);
        faixas.push({ desde, pct });
        faixas.sort((a, b) => a.desde.localeCompare(b.desde));
        await upsertProduct(uid, {
          ...p,
          impostoFaixas: faixas,
          // `imposto` segue como a alíquota vigente hoje (compat e exibição).
          imposto: String(impostoNaData({ imposto: p.imposto, impostoFaixas: faixas }, todayISO())),
        });
        n += 1;
        setFeito(n);
      }
      onClose();
    } catch (e) {
      alert("Erro ao aplicar imposto: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <div className="modal-title">Imposto em massa</div>
      <div className="modal-sub">aplica o mesmo percentual em vários produtos de uma vez</div>

      <div className="config-field">
        <label>Imposto (%)</label>
        <input
          type="number" min="0" step="0.01" value={valor}
          onChange={(e) => setValor(e.target.value)}
          style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 16, outline: "none" }}
        />
      </div>

      <div className="config-field">
        <label>Vale a partir de</label>
        <input
          type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
          style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 16, outline: "none" }}
        />
      </div>

      <div style={{
        marginTop: 12, padding: "10px 12px", borderRadius: 8, fontSize: ".82rem", lineHeight: 1.55,
        background: "var(--surface2)", border: "1px solid var(--border)",
      }}>
        Vai aplicar <b>{pct}%</b> em <b>{produtos.length} produto{produtos.length === 1 ? "" : "s"}</b>
        {escopoBusca ? <> — só os que aparecem na busca “{escopoBusca}”.</> : <> — todos os da lista.</>}
        {jaTem.length > 0 && (
          <div style={{ marginTop: 6, color: "#f7c948" }}>
            {jaTem.length} já {jaTem.length === 1 ? "tem" : "têm"} imposto e será{jaTem.length === 1 ? "" : "ão"} sobrescrito
            {jaTem.length === 1 ? "" : "s"}.
          </div>
        )}
      </div>

      <div style={{
        marginTop: 10, padding: "10px 12px", borderRadius: 8, fontSize: ".82rem", lineHeight: 1.55,
        background: "rgba(34,197,94,.1)", border: "1px solid rgba(34,197,94,.35)", color: "var(--green)",
      }}>
        Vendas <b>antes de {desde.split("-").reverse().join("/")}</b> continuam sem esse imposto —
        o lucro dos meses já fechados não muda.
      </div>

      <div className="modal-btns">
        <button type="button" className="btn btn-success" onClick={aplicar} disabled={salvando}>
          {salvando ? `Aplicando… ${feito}/${produtos.length}` : `Aplicar em ${produtos.length}`}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={salvando}>Cancelar</button>
      </div>
    </Modal>
  );
}

// ── Remessas pro Full: baixa a partir do que o ML recebeu ─────────────────
function RemessasFull({ movimentos }: { movimentos: EstoqueMovimento[] }) {
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
  // Total que será baixado — já com as correções que o usuário digitou.
  const totalDaRemessa = (r: Remessa) =>
    r.produtos.reduce((s, p) => {
      if (!p.productId) return s;
      return s + Math.max(Math.round(Number(qtds[`${r.remessa}|${p.productId}`] ?? p.qtd) || 0), 0);
    }, 0);
  const jaBaixada = (r: Remessa) => remessaTemBaixa(r, movimentos);
  // Resolvida = deu baixa por aqui, ou foi marcada como lançada à mão.
  const resolvida = (r: Remessa) => jaBaixada(r) || ignoradas.has(r.remessa);
  const pendentes = remessas.filter((r) => !resolvida(r));
  const resolvidas = remessas.filter(resolvida);

  async function darBaixa(r: Remessa) {
    const alvos = r.produtos.filter((p) => p.productId);
    if (!alvos.length) { alert("Nenhum produto desta remessa está cadastrado no Estoque."); return; }
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
          background: "rgba(239,68,68,.12)", border: "1px solid rgba(239,68,68,.4)",
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
                  </div>
                  {feita ? (
                    <span style={{
                      color: "var(--green)", fontSize: ".75rem", fontWeight: 700,
                      background: "rgba(34,197,94,.12)", border: "1px solid rgba(34,197,94,.35)",
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
                  const chave = `${r.remessa}|${p.productId}`;
                  const valor = qtds[chave] ?? String(p.qtd);
                  const dif = Math.round(Number(valor) || 0) - p.qtd;
                  return (
                    <div key={p.inventory} style={{
                      display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 12px",
                      alignItems: "center", padding: "7px 0",
                      borderTop: "1px solid rgba(255,255,255,.04)",
                    }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: ".84rem", fontWeight: 500 }}>
                          {p.nome || p.inventory}
                        </div>
                        <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>
                          {p.productId
                            ? <>ML recebeu {p.qtd} un{dif !== 0 && !feita && (
                                <span style={{ color: "#f7c948", fontWeight: 600 }}>
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
                          border: `1px solid ${dif !== 0 && !feita && p.productId ? "rgba(245,158,11,.5)" : "var(--border)"}`,
                          borderRadius: 8, color: "var(--text)", outline: "none",
                        }}
                        value={valor}
                        disabled={feita || !p.productId}
                        onChange={(e) => setQtds((s) => ({ ...s, [chave]: e.target.value }))}
                      />
                    </div>
                  );
                })}

                {!!semCadastro.length && (
                  <div style={{
                    fontSize: ".75rem", color: "#f7c948", marginTop: 10, padding: "7px 10px",
                    background: "rgba(245,158,11,.1)", borderRadius: 8, lineHeight: 1.5,
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
