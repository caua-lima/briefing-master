"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CUSTO_FAIXA_SENTINELA, custoNaData, impostoNaData, type EstoqueMovimento, type MovimentoTipo, type Product } from "@/lib/domain/types";
import { addMovimento, deleteMovimento, deleteProduct, upsertProduct, watchMovimentos } from "@/lib/firebase/data";
import { fmtBRL } from "@/lib/domain/calc";
import { getCoverageStatus, COVERAGE_STATUS_LABEL, type CoverageStatus } from "@/lib/domain/estoque";
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

/**
 * Estoque físico FORA do Full. Depende de o produto ter ou não anúncio no
 * Full:
 *
 * - SEM Full (100% agência/próprio): "em casa" (livro de movimentações) e o
 *   que o anúncio mostra são o MESMO estoque físico — o vendedor não manda
 *   nada pra um centro do ML, o produto fica com ele o tempo todo. Somar os
 *   dois contava a mesma unidade duas vezes, e piorava com o tempo: o livro
 *   de movimentações só SOBE com cada ＋Entrada e nunca desce sozinho quando
 *   uma venda acontece (venda não é uma movimentação registrada aqui) — só o
 *   anúncio, atualizado ao vivo pelo ML, reflete o saldo real. Corrigido a
 *   pedido do dono: "o número em Agências deve ser o mesmo que em estoque".
 *   A entrada continua servindo pra apurar o custo médio; só a QUANTIDADE usa
 *   o valor do anúncio.
 * - COM Full: "em casa" é estoque físico esperando envio — pool separado de
 *   verdade do que já está no centro do Full, então soma com o que estiver
 *   num anúncio próprio (se houver).
 */
function foraDoFullDe(casa: number, proprio: number, ehFull: boolean): number {
  return ehFull ? casa + proprio : proprio;
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
  const foraFull = foraDoFullDe(casa, proprio, ehFull);
  const total = full + foraFull;
  const { min: precoMin, max: precoMax } = precosDe(p, estoqueML);
  // Venda potencial: o Full pelo preço de cada anúncio (estoque separado); o
  // que está fora do Full uma vez só, pelo melhor preço (é o mesmo estoque
  // exposto no anúncio próprio, não soma de novo).
  let potencialFull = 0;
  let precoProprioMax = 0;
  for (const { item } of anunciosDe(p, estoqueML)) {
    if (!item) continue;
    if (ehFullLogistic(item.logistic)) potencialFull += item.available * item.price;
    else precoProprioMax = Math.max(precoProprioMax, item.price);
  }
  const valorPotencial = potencialFull + foraFull * (precoProprioMax || precoMax || precoMin);
  const mediaDiaria = forecast.dias > 0 ? (forecast.vendas[p.id] ?? 0) / forecast.dias : 0;
  const cobertura = mediaDiaria > 0 && total > 0 ? total / mediaDiaria : Infinity;
  // Reposição só faz sentido pra quem está no Full.
  const reporQtd = ehFull && mediaDiaria > 0 ? Math.max(0, Math.ceil(mediaDiaria * DIAS_ALVO) - full) : 0;
  return { precoMin, precoMax, casa, full, proprio, ehFull, total, mediaDiaria, cobertura, valorPotencial, reporQtd };
}

export default function EstoqueTab({ uid, data }: { uid: string; data: UserData }) {
  const { canEditTab } = useAccess();
  const canEdit = canEditTab("estoque");
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState("");
  const [estoqueML, setEstoqueML] = useState<EstoqueML>({});
  const [forecast, setForecast] = useState<Forecast>({ vendas: {}, dias: DIAS_ALVO });
  const [loadingML, setLoadingML] = useState(false);
  const [movimentos, setMovimentos] = useState<EstoqueMovimento[]>([]);
  const [movModal, setMovModal] = useState<{ product: Product; tipo: MovimentoTipo } | null>(null);
  const [agenciasProduct, setAgenciasProduct] = useState<Product | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded]);
  const [impostoMassa, setImpostoMassa] = useState(false);
  const [vincularSku, setVincularSku] = useState(false);

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
  // Sem Full, "em casa" é o mesmo estoque do anúncio (ver foraDoFullDe) — soma
  // o valor exibido de cada produto, não o livro de movimentações cru.
  const unCasa = data.products.reduce((s, p) => {
    const { proprio, ehFull } = fullDe(p, estoqueML);
    return s + (ehFull ? Math.max(p.qtdLocal ?? 0, 0) : proprio);
  }, 0);
  // Só conta como Full o que é realmente fulfillment.
  const unFull = Object.values(estoqueML).reduce((s, v) => s + (ehFullLogistic(v.logistic) ? v.available : 0), 0);
  // Valor parado = (Full + estoque fora do Full) × custo médio. O próprio não
  // soma com casa: é o mesmo estoque exposto no anúncio.
  const valorEstoque = data.products.reduce((s, p) => {
    const casa = Math.max(p.qtdLocal ?? 0, 0);
    const { qtd: full, proprio, ehFull } = fullDe(p, estoqueML);
    return s + (full + foraDoFullDe(casa, proprio, ehFull)) * custoMedioDe(p);
  }, 0);
  // Produtos NO FULL com estoque baixo E unidades em casa pra reabastecer.
  const reabastecer = data.products.filter((p) => {
    const f = fullDe(p, estoqueML);
    return f.ehFull && f.qtd <= FULL_BAIXO && (p.qtdLocal ?? 0) > 0;
  });
  // Venda potencial = todo o estoque × preço de venda atual do ML.
  const valorPotencialVenda = data.products.reduce((s, p) => s + previsaoDe(p, estoqueML, forecast).valorPotencial, 0);

  // Indicadores de reposição (Fase 5) — cobertura real via forecast, só
  // produtos ativos (produto descontinuado não precisa de alerta de compra).
  const resumoCobertura = useMemo(() => {
    let ruptura = 0, critico = 0, repor = 0, encalhado = 0, valorEmRisco = 0;
    for (const p of data.products) {
      if (!p.ativo) continue;
      const f = previsaoDe(p, estoqueML, forecast);
      const vendasPeriodo = forecast.vendas[p.id] ?? 0;
      const coberturaDias = Number.isFinite(f.cobertura) ? f.cobertura : null;
      const status = getCoverageStatus(coberturaDias, f.total, vendasPeriodo);
      if (f.total <= 0) ruptura++;
      if (status === "critico") { critico++; valorEmRisco += f.total * custoMedioDe(p); }
      else if (status === "repor") repor++;
      else if (status === "encalhado") { encalhado++; valorEmRisco += f.total * custoMedioDe(p); }
    }
    return { ruptura, critico, repor, encalhado, valorEmRisco };
  }, [data.products, estoqueML, forecast]);

  function onAdd() {
    setEditProduct({ id: newId(), name: "", custo: "", sku: "", imposto: "", mlbs: [""], ativo: true });
  }

  return (
    <div className="dash">
      {/* Header */}
      <div className="tab-head">
        <div className="tab-head-left">
          <h2 className="tab-title">Estoque de Produtos</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={carregarEstoque} disabled={loadingML}>
            {loadingML ? "Atualizando..." : "⟳ Atualizar Full (ML)"}
          </button>
        </div>
        {canEdit && (
          <div className="tab-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVincularSku(true)}>
              Vincular por SKU
            </button>
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
        <div className="kpi k-neg"><div className="k-lbl">Em ruptura</div><div className="k-val" style={{ color: resumoCobertura.ruptura > 0 ? "var(--red)" : "var(--muted)" }}>{resumoCobertura.ruptura}</div><div className="k-sub">estoque total zerado</div></div>
        <div className="kpi k-neg"><div className="k-lbl">Cobertura crítica</div><div className="k-val" style={{ color: resumoCobertura.critico > 0 ? "var(--red)" : "var(--muted)" }}>{resumoCobertura.critico}</div><div className="k-sub">&lt; 7 dias de giro</div></div>
        <div className="kpi k-warn"><div className="k-lbl">Cobertura baixa</div><div className="k-val" style={{ color: resumoCobertura.repor > 0 ? "var(--yellow)" : "var(--muted)" }}>{resumoCobertura.repor}</div><div className="k-sub">7–15 dias, repor em breve</div></div>
        <div className="kpi k-warn"><div className="k-lbl">Capital parado</div><div className="k-val" style={{ color: resumoCobertura.encalhado > 0 ? "var(--warning)" : "var(--muted)" }}>{resumoCobertura.encalhado}</div><div className="k-sub">sem venda no período</div></div>
        <div className="kpi k-neg"><div className="k-lbl">Valor em risco</div><div className="k-val" style={{ color: resumoCobertura.valorEmRisco > 0 ? "var(--red)" : "var(--muted)" }}>{fmtBRL(resumoCobertura.valorEmRisco)}</div><div className="k-sub">crítico + encalhado × custo médio</div></div>
      </div>

      {/* Busca */}
      <input
        className="search-inp" type="search" placeholder="Buscar por nome, SKU ou código MLB…" value={search}
        onChange={(e) => setSearch(e.target.value)} aria-label="Buscar produto"
      />

      {reabastecer.length > 0 && (
        <div className="note note-warn">
          <b>Full baixo</b> em {reabastecer.length} produto(s) — você tem unidades em casa pra enviar:{" "}
          {reabastecer.slice(0, 6).map((p) => p.name || "sem nome").join(", ")}{reabastecer.length > 6 ? "…" : ""}
        </div>
      )}

      {/* Lista */}
      <div className="panel">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <span className="empty-ico">📦</span>
            {search ? "Nenhum produto encontrado." : (<>Nenhum produto cadastrado.<br />Clique em <strong>＋ Novo Produto</strong>.</>)}
          </div>
        ) : (
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="tbl-modern tbl-cards">
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
                    expanded={expanded === p.id}
                    onToggle={() => setExpanded((cur) => (cur === p.id ? null : p.id))}
                    onEdit={() => setEditProduct({ ...p, mlbs: mlbsDe(p) })}
                    onMov={(tipo) => setMovModal({ product: p, tipo })}
                    onAgencias={() => setAgenciasProduct(p)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <PrevisaoPanel products={filtered} estoqueML={estoqueML} forecast={forecast} />

      {impostoMassa && (
        <ImpostoMassaModal
          uid={uid}
          produtos={filtered}
          escopoBusca={search.trim()}
          onClose={() => setImpostoMassa(false)}
        />
      )}

      {vincularSku && (
        <VincularSkuModal uid={uid} produtos={data.products} onClose={() => setVincularSku(false)} />
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

      {agenciasProduct && (
        <AgenciasModal
          product={agenciasProduct}
          estoqueML={estoqueML}
          onClose={() => setAgenciasProduct(null)}
        />
      )}

      {expanded && (() => {
        const p = data.products.find((x) => x.id === expanded);
        if (!p) return null;
        return (
          <div className="drawer-overlay" onClick={() => setExpanded(null)}>
            <div className="drawer-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Movimentações de ${p.name || "produto"}`}>
              <div className="drawer-head">
                <div>
                  <div className="drawer-title">{p.name || "Sem nome"}</div>
                  <div className="drawer-sub">custo médio {fmtBRL(custoMedioDe(p))} · {p.qtdLocal ?? 0} un. em casa</div>
                </div>
                <button type="button" className="drawer-close" onClick={() => setExpanded(null)} aria-label="Fechar histórico">✕</button>
              </div>
              <div className="drawer-body" style={{ padding: "12px 16px" }}>
                <MovimentosHistorico product={p} movs={movsPorProduto.get(p.id) ?? []} onMov={(tipo) => setMovModal({ product: p, tipo })} />
              </div>
            </div>
          </div>
        );
      })()}
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
  product, estoqueML, expanded, onToggle, onEdit, onMov, onAgencias,
}: {
  product: Product;
  uid: string;
  estoqueML: EstoqueML;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onMov: (tipo: MovimentoTipo) => void;
  onAgencias: () => void;
}) {
  const imposto = parseNum(product.imposto ?? "0");
  const anuncios = anunciosDe(product, estoqueML);
  const { qtd: full, proprio, ehFull } = fullDe(product, estoqueML);
  const casa = product.qtdLocal ?? 0;
  // Sem Full, "em casa" e "no anúncio" são o mesmo estoque físico (ver
  // foraDoFullDe) — mostra o valor do anúncio, que é o que reflete vendas de
  // verdade, em vez do livro de movimentações (que só sobe, nunca desce
  // sozinho quando vende).
  const casaExibida = ehFull ? casa : proprio;
  const custoMedio = custoMedioDe(product);
  const totalUn = full + foraDoFullDe(casa, proprio, ehFull);
  const fullBaixo = ehFull && full <= FULL_BAIXO;
  const { min: precoMin, max: precoMax, temPromo } = precosDe(product, estoqueML);

  return (
    <>
      <tr style={{ opacity: product.ativo ? 1 : 0.5 }}>
        <td style={{ textAlign: "left" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button type="button" onClick={onToggle} title="Ver movimentações" aria-label="Ver movimentações" aria-expanded={expanded} style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: ".8rem", transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▶</button>
            <div>
              <div style={{ fontWeight: 600 }}>{product.name || <em style={{ color: "var(--muted)" }}>Sem nome</em>}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 3 }}>
                {product.sku
                  ? <span style={{ background: "rgba(233,169,45,.12)", color: "#E9A92D", padding: "1px 7px", borderRadius: 6, fontWeight: 700, fontSize: ".7rem" }}>SKU {product.sku}</span>
                  : <span style={{ color: "var(--red)", fontSize: ".7rem" }}>sem SKU</span>}
                {anuncios.map(({ mlb, item }) => (
                  <span key={mlb} style={{ fontSize: ".7rem", background: "var(--surface2)", border: "1px solid var(--border)", padding: "1px 6px", borderRadius: 5, color: "var(--muted)" }}>
                    {mlb}
                    {item && item.price > 0 && <b style={{ color: "var(--green)", marginLeft: 4 }}>{fmtBRL(item.price)}</b>}
                    {item && item.hasPromo && <span style={{ marginLeft: 4, fontSize: ".62rem", color: "#F4B942", fontWeight: 700 }}>promo</span>}
                    {item && <span style={{ marginLeft: 4, color: ehFullLogistic(item.logistic) ? "#E9A92D" : "var(--muted)" }}>{ehFullLogistic(item.logistic) ? "Full" : "próprio"}</span>}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </td>
        <td data-label="Em casa" style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap", color: casaExibida > 0 ? "var(--yellow)" : "var(--muted)" }}>{casaExibida} un</td>
        <td data-label="Full (ML)" style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap", color: !ehFull ? "var(--muted)" : fullBaixo ? "var(--red)" : "var(--green)" }}>
          {ehFull ? `${full} un` : "—"}
          {fullBaixo && casa > 0 && <span title="Envie de casa pro Full" style={{ display: "block", fontSize: ".62rem", color: "var(--warning)" }}>reabastecer</span>}
          {proprio > 0 && <span title="Disponível no(s) anúncio(s) próprio(s) (envio por conta do vendedor/agência) — soma no Total ao lado, junto com o que está em casa" style={{ display: "block", fontSize: ".62rem", color: "var(--muted)", fontWeight: 400 }}>{proprio} no anúncio</span>}
        </td>
        <td data-label="Total" style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{totalUn} un</td>
        <td data-label="Custo médio" style={{ textAlign: "right", whiteSpace: "nowrap", color: custoMedio > 0 ? "var(--text)" : "var(--muted)", fontWeight: 600 }}>
          {custoMedio > 0 ? fmtBRL(custoMedio) : "—"}
          {product.custoMedio == null && custoMedio > 0 && <span style={{ display: "block", fontSize: ".62rem", color: "var(--muted)" }}>manual</span>}
        </td>
        <td data-label="Preço venda" style={{ textAlign: "right", color: precoMax > 0 ? "var(--green)" : "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>
          {precoMax > 0 ? (precoMin === precoMax ? fmtBRL(precoMax) : `${fmtBRL(precoMin)}–${fmtBRL(precoMax)}`) : "—"}
          {temPromo && <span style={{ display: "block", fontSize: ".62rem", color: "#F4B942" }}>promoção</span>}
        </td>
        <td data-label="Imposto" style={{ textAlign: "right", whiteSpace: "nowrap", color: imposto > 0 ? "var(--red)" : "var(--muted)" }}>{imposto > 0 ? `${imposto.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "—"}</td>
        <td data-label="Movimentar" data-cell="acoes">
          <div className="row-actions" style={{ justifyContent: "center" }}>
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
        <td data-label="Ações" data-cell="acoes">
          <div className="row-actions" style={{ justifyContent: "flex-end" }}>
            {proprio > 0 && (
              <button type="button" className="btn btn-ghost btn-xs" title="Ver o estoque de cada anúncio fora do Full (envio por conta sua/agência)" onClick={onAgencias}>Agências</button>
            )}
            <button type="button" className="btn btn-warning btn-xs" title="Editar produto" onClick={onEdit}>Editar</button>
            <button type="button" className="btn btn-danger btn-xs" title="Remover produto" onClick={() => { if (!confirm(`Remover "${product.name}"?`)) return; deleteProduct("", product.id).catch(() => {}); }}>Excluir</button>
          </div>
        </td>
      </tr>
    </>
  );
}

/**
 * Detalhamento dos anúncios fora do Full (envio por conta sua/agência) — só
 * leitura, o número já vem certo do próprio anúncio no ML (fullDe/anunciosDe
 * já leem isso pro "no anúncio" da linha); aqui é só abrir a quebra por MLB
 * pra quem trabalha com vários anúncios do mesmo produto via agência.
 */
function AgenciasModal({ product, estoqueML, onClose }: { product: Product; estoqueML: EstoqueML; onClose: () => void }) {
  const anuncios = anunciosDe(product, estoqueML).filter(({ item }) => item && !ehFullLogistic(item.logistic));
  const total = anuncios.reduce((s, { item }) => s + (item?.available ?? 0), 0);

  return (
    <Modal open onClose={onClose}>
      <div className="modal-title">Agências — {product.name || "Sem nome"}</div>
      <div className="modal-sub">Estoque de cada anúncio fora do Full · vem direto do Mercado Livre</div>

      {anuncios.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: ".85rem", margin: "12px 0" }}>
          Nenhum anúncio fora do Full pra este produto agora.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "12px 0" }}>
          {anuncios.map(({ mlb, item }) => (
            <div key={mlb} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 12px", background: "var(--surface2)", borderRadius: 8 }}>
              <div>
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: ".8rem", fontWeight: 700 }}>{mlb}</div>
                {!!item?.price && (
                  <div style={{ fontSize: ".76rem", color: "var(--green)" }}>
                    {fmtBRL(item.price)}{item.hasPromo && <span style={{ color: "#F4B942" }}> · promoção</span>}
                  </div>
                )}
              </div>
              <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>{item?.available ?? 0} un</div>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, marginTop: 4, borderTop: "1px solid var(--border)", fontWeight: 700 }}>
            <span>Total nas agências</span>
            <span>{total} un</span>
          </div>
        </div>
      )}

      <div style={{ fontSize: ".72rem", color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Atualize a quantidade direto no anúncio do Mercado Livre — este número acompanha sozinho, sem
        controle manual pra manter.
      </div>

      <div className="modal-btns">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
      </div>
    </Modal>
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
          <table className="tbl-modern tbl-cards">
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
                    <td data-label="Tipo" style={{ textAlign: "left" }}><span style={{ color: cor, fontWeight: 700 }}>{TIPO_LABEL[m.tipo]}</span></td>
                    <td data-label="Qtd" style={{ color: cor, fontWeight: 700 }}>{sign}{Math.abs(m.quantidade)}</td>
                    <td data-label="Custo un.">{(m.tipo === "entrada" || m.tipo === "saldo_inicial") && m.custoUnit != null ? fmtBRL(m.custoUnit) : "—"}</td>
                    <td data-label="Obs" style={{ textAlign: "left", color: "var(--muted)", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.obs || "—"}</td>
                    <td data-cell="acoes">
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

  const { qtd: full, proprio, ehFull } = fullDe(product, estoqueML);
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

  // ENTRADA: blenda a compra nova contra tudo que você tem (Full + fora do
  // Full, onde fora do Full já é casa + anúncio próprio somados).
  const estoqueAtual = full + foraDoFullDe(casa, proprio, ehFull);
  const novoAvgEntrada = qNum > 0 && estoqueAtual + qNum > 0
    ? (estoqueAtual * avgAtual + qNum * cNum) / (estoqueAtual + qNum)
    : avgAtual;

  // SALDO INICIAL (Full): as unidades do Full ainda não têm custo. Blenda elas,
  // ao custo informado, contra o que está FORA do Full (casa + próprio), que já
  // reflete o custo médio atual. Sem estoque fora do Full, o custo do Full vira
  // o próprio custo médio. Antes o saldo SOBRESCREVIA o custo médio — errado
  // quando já havia estoque em casa com custo.
  const foraDoFull = foraDoFullDe(casa, proprio, ehFull);
  const novoAvgSaldo = qNum > 0
    ? (avgAtual > 0 && foraDoFull > 0
        ? (foraDoFull * avgAtual + qNum * cNum) / (foraDoFull + qNum)
        : cNum)
    : avgAtual;

  const novoAvg = isEntrada ? novoAvgEntrada : novoAvgSaldo;

  async function handleSave() {
    if (!qNum || (!isAjuste && qNum <= 0)) { alert("Informe a quantidade."); return; }
    if (precisaCusto && cNum <= 0) { alert("Informe o custo unitário."); return; }
    if (!obs.trim()) { alert("Informe o motivo desta movimentação — fica registrado no histórico do produto."); return; }
    // Ajuste negativo tira estoque sem ser nem venda nem envio — a confirmação
    // extra existe pra não zerar produto por engano digitando o sinal errado.
    if (isAjuste && qNum < 0 && !confirm(`Confirma a baixa de ${Math.abs(qNum)} unidade(s) de "${product.name || "produto"}"?\n\nMotivo: ${obs.trim()}`)) {
      return;
    }
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
        <div style={{ margin: "4px 0 12px", padding: "8px 12px", borderRadius: 8, background: "rgba(233,169,45,.08)", border: "1px solid rgba(233,169,45,.2)", fontSize: ".78rem", color: "var(--muted)" }}>
          {full > 0
            ? <>O ML mostra <b>{full} un</b> deste produto no Full sem custo lançado. Informe quanto você pagou por unidade — isso <b>entra no custo médio</b> pra o lucro sair certo quando elas venderem. Não soma no “em casa” (já estão fora).</>
            : <>Use pra custear unidades que <b>já estavam no estoque</b> antes de você começar a lançar (ex.: o que está no Full). Entra na média do custo, mas <b>não soma no “em casa”</b>.</>}
        </div>
      )}

      {tipo === "saida_full" && (
        <div style={{ margin: "4px 0 12px", padding: "8px 12px", borderRadius: 8, background: "rgba(244,185,66,.08)", border: "1px solid rgba(244,185,66,.25)", fontSize: ".78rem", color: "var(--muted)" }}>
          Baixa por <b>envio ao Full</b> — sai de casa e vai pro Full, mas <b>não é venda</b>. Não afeta o lucro; o custo só entra quando o produto vende.
        </div>
      )}

      <div className="config-field">
        <label>Data</label>
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: ".9rem", outline: "none" }} />
      </div>

      <div className="config-field">
        <label>Motivo</label>
        <input type="text" placeholder="Ex: fornecedor João, NF 123 / quebra no transporte / contagem física" value={obs} onChange={(e) => setObs(e.target.value)} />
      </div>

      <div className="modal-btns">
        <button type="button" className="btn btn-success" onClick={handleSave} disabled={saving || !obs.trim()}>{saving ? "Salvando…" : "Lançar"}</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}

function coberturaFmt(dias: number): { txt: string; cor: string } {
  if (!Number.isFinite(dias)) return { txt: "—", cor: "var(--muted)" };
  const d = Math.round(dias);
  const cor = d <= 7 ? "var(--red)" : d <= 15 ? "var(--warning)" : "var(--green)";
  return { txt: `${d}d`, cor };
}

const STATUS_COBERTURA_COR: Record<CoverageStatus, string> = {
  critico: "var(--red)", repor: "var(--warning)", saudavel: "var(--green)",
  encalhado: "var(--warning)", "sem-giro": "var(--muted)",
};

// Planejamento da lista de reposição — só um "marcar como já resolvido",
// fica no navegador (localStorage), não precisa de Firestore/rule nova.
const PLANEJADOS_KEY = "briefing:estoque:planejados";
function lerPlanejados(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(PLANEJADOS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch { return new Set(); }
}
function gravarPlanejados(ids: Set<string>) {
  try { window.localStorage.setItem(PLANEJADOS_KEY, JSON.stringify(Array.from(ids))); } catch { /* storage indisponível */ }
}

const STATUS_PESO: Record<CoverageStatus, number> = { critico: 0, repor: 1, "sem-giro": 2, encalhado: 3, saudavel: 4 };

function PrevisaoPanel({ products, estoqueML, forecast }: { products: Product[]; estoqueML: EstoqueML; forecast: Forecast }) {
  const [planejados, setPlanejados] = useState<Set<string>>(new Set());
  useEffect(() => { setPlanejados(lerPlanejados()); }, []);
  function togglePlanejado(id: string) {
    setPlanejados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      gravarPlanejados(next);
      return next;
    });
  }

  /**
   * Sem filtro: produto recém-criado não tem estoque, venda nem preço, e
   * sumir da lista dava a impressão de que o cadastro não funcionou. Quem
   * ainda não tem dado cai no fim e diz o que está faltando.
   */
  const linhas = products
    .map((p) => {
      const f = previsaoDe(p, estoqueML, forecast);
      const vendasPeriodo = forecast.vendas[p.id] ?? 0;
      const coberturaDias = Number.isFinite(f.cobertura) ? f.cobertura : null;
      const status = getCoverageStatus(coberturaDias, f.total, vendasPeriodo);
      return { p, f, status };
    })
    .sort((a, b) =>
      STATUS_PESO[a.status] - STATUS_PESO[b.status]
      || b.f.valorPotencial - a.f.valorPotencial
      || b.f.total - a.f.total
      || (a.p.name || "").localeCompare(b.p.name || ""),
    );

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <span className="panel-title">Previsão de vendas e reposição</span>
        <span className="panel-sub">preço atual do ML · média dos últimos {forecast.dias} dias · repor p/ cobrir {DIAS_ALVO} dias</span>
      </div>
      {linhas.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: ".82rem", padding: "8px 0" }}>Nenhum produto cadastrado ainda.</div>
      ) : (
        <div className="table-wrapper" style={{ border: "none" }}>
          <table className="tbl-modern tbl-cards">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Produto</th>
                <th style={{ textAlign: "left" }}>Status</th>
                <th style={{ textAlign: "right" }}>Preço ML</th>
                <th style={{ textAlign: "right" }}>Estoque total</th>
                <th style={{ textAlign: "right" }}>Vendas/dia</th>
                <th style={{ textAlign: "right" }}>Cobertura</th>
                <th style={{ textAlign: "right" }}>Repor (Full)</th>
                <th style={{ textAlign: "right" }}>Custo estimado</th>
                <th style={{ textAlign: "right" }}>Venda potencial</th>
                <th style={{ textAlign: "center" }}>Planejado</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(({ p, f, status }) => {
                const cob = coberturaFmt(f.cobertura);
                const emCasa = Math.min(f.reporQtd, f.casa);
                const comprar = Math.max(0, f.reporQtd - emCasa);
                const custoEstimado = comprar * custoMedioDe(p);
                const planejado = planejados.has(p.id);
                return (
                  <tr key={p.id} style={{ opacity: planejado ? 0.55 : 1 }}>
                    <td style={{ textAlign: "left", fontWeight: 600 }}>
                      {p.name || "Sem nome"}
                      {mlbsDe(p).length === 0 ? (
                        <span style={{ display: "block", fontSize: ".66rem", fontWeight: 400, color: "var(--warning)" }}>
                          sem anúncio vinculado — use “Vincular por SKU”
                        </span>
                      ) : f.total === 0 && f.mediaDiaria === 0 ? (
                        <span style={{ display: "block", fontSize: ".66rem", fontWeight: 400, color: "var(--muted)" }}>
                          sem estoque nem venda ainda
                        </span>
                      ) : null}
                    </td>
                    <td data-label="Status" style={{ textAlign: "left", whiteSpace: "nowrap" }}>
                      <span className="severity-chip" style={{ color: STATUS_COBERTURA_COR[status], background: "transparent", border: `1px solid ${STATUS_COBERTURA_COR[status]}` }}>
                        {COVERAGE_STATUS_LABEL[status]}
                      </span>
                    </td>
                    <td data-label="Preço ML" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{f.precoMax > 0 ? (f.precoMin === f.precoMax ? fmtBRL(f.precoMax) : `${fmtBRL(f.precoMin)}–${fmtBRL(f.precoMax)}`) : "—"}</td>
                    <td data-label="Estoque total" style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{f.total} un</td>
                    <td data-label="Vendas/dia" style={{ textAlign: "right", color: f.mediaDiaria > 0 ? "var(--text)" : "var(--muted)" }}>{f.mediaDiaria > 0 ? f.mediaDiaria.toFixed(1) : "—"}</td>
                    <td data-label="Cobertura" style={{ textAlign: "right", color: cob.cor, fontWeight: 700 }}>{cob.txt}</td>
                    <td data-label="Repor (Full)" style={{ textAlign: "right" }}>
                      {f.reporQtd > 0 ? (
                        <span style={{ color: "var(--yellow)", fontWeight: 700 }}>
                          {f.reporQtd} un
                          {emCasa > 0 && (
                            <span style={{ display: "block", fontSize: ".64rem", color: "var(--muted)", fontWeight: 400 }}>
                              {emCasa} em casa{comprar > 0 ? ` · comprar ${comprar}` : ""}
                            </span>
                          )}
                        </span>
                      ) : <span style={{ color: "var(--muted)" }}>ok</span>}
                    </td>
                    <td data-label="Custo estimado" style={{ textAlign: "right", color: custoEstimado > 0 ? "var(--red)" : "var(--muted)", whiteSpace: "nowrap" }} title="Unidades a comprar (descontando o que já tem em casa) × custo médio">
                      {custoEstimado > 0 ? fmtBRL(custoEstimado) : "—"}
                    </td>
                    <td data-label="Venda potencial" style={{ textAlign: "right", color: "var(--green)", fontWeight: 700, whiteSpace: "nowrap" }}>{fmtBRL(f.valorPotencial)}</td>
                    <td data-label="Planejado" style={{ textAlign: "center" }}>
                      <input type="checkbox" checked={planejado} onChange={() => togglePlanejado(p.id)} aria-label={`Marcar ${p.name || "produto"} como reposição já planejada`} />
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

    // Mesmo padrão acima, pro custo médio: se o produto já tem faixas (já
    // passou por uma entrada), editar o custo à mão também vira uma faixa
    // valendo de hoje — sem isso, corrigir o custo aqui reescreveria a
    // margem de vendas já feitas, o mesmo problema que a entrada tinha.
    const custoNovo = custoStr.trim() ? parseNum(custoStr) : 0;
    const custoFaixasAtuais = p.custoMedioFaixas ?? [];
    if (custoFaixasAtuais.length && custoStr.trim() && custoNovo !== custoNaData({ custoMedio: p.custoMedio, custo: p.custo, custoMedioFaixas: custoFaixasAtuais }, todayISO())) {
      const faixas = custoFaixasAtuais.filter((f) => f.desde !== todayISO());
      faixas.push({ desde: todayISO(), custo: custoNovo });
      faixas.sort((a, b) => a.desde.localeCompare(b.desde));
      saveObj.custoMedioFaixas = faixas;
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
        <div className="hint">
          Informe o custo das unidades que você <strong>já tem hoje</strong> (galpão + Full). A cada <strong>＋ Entrada</strong>,
          esse custo é ajustado sozinho pela média, valendo só a partir dali — vendas já feitas continuam com a margem que tinham.
          {!!p.custoMedioFaixas?.filter((f) => f.desde !== CUSTO_FAIXA_SENTINELA).length && (
            <> Vigências: {[...p.custoMedioFaixas]
              .filter((f) => f.desde !== CUSTO_FAIXA_SENTINELA)
              .sort((a, b) => a.desde.localeCompare(b.desde))
              .map((f) => `${fmtBRL(f.custo)} desde ${f.desde.split("-").reverse().join("/")}`)
              .join(" · ")}.</>
          )}
        </div>
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

      <div style={{ margin: "4px 0 12px", padding: "8px 12px", borderRadius: 8, background: "rgba(233,169,45,.08)", border: "1px solid rgba(233,169,45,.2)", fontSize: ".78rem", color: "var(--muted)" }}>
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
// ── Vincular anúncio ao produto pelo SKU ──────────────────────────────────
/**
 * Puxa do ML o SKU de cada anúncio e sugere vincular ao produto de mesmo SKU.
 * Só sugere; a gravação acontece aqui no cliente, com a confirmação do dono,
 * porque é ele quem tem permissão de escrever no Estoque.
 */
type NovoSku = { mlb: string; titulo: string; skuAnuncio: string; exato: boolean };
type PlanoSku = {
  productId: string; name: string; sku: string;
  atuais: { mlb: string; titulo: string }[];
  novos: NovoSku[];
};
type ResumoSku = { produtos: number; anunciosDaConta: number; anunciosLidos: number; semSku: number; semMatch: number; aproximados: number; aVincular: number };

function VincularSkuModal({ uid, produtos, onClose }: { uid: string; produtos: Product[]; onClose: () => void }) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [plano, setPlano] = useState<PlanoSku[]>([]);
  const [resumo, setResumo] = useState<ResumoSku | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const [feito, setFeito] = useState(0);
  const [concluido, setConcluido] = useState(false);
  // Cada anúncio sugerido é escolhido individualmente: match aproximado pode
  // aproximar SKUs de produtos diferentes, e vincular errado bagunça o lucro.
  const [marcados, setMarcados] = useState<Set<string>>(new Set());

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await authedFetch("/api/ml/vincular-sku", { cache: "no-store" });
        const txt = await r.text();
        if (!vivo) return;
        if (!r.ok) { setErro(`HTTP ${r.status} — ${txt.slice(0, 300)}`); }
        else {
          const j = JSON.parse(txt) as { plano?: PlanoSku[]; resumo?: ResumoSku };
          const lista = j.plano ?? [];
          setPlano(lista);
          setResumo(j.resumo ?? null);
          // Exato já vem marcado; aproximado exige o seu aval.
          const iniciais = new Set<string>();
          for (const item of lista) {
            for (const n of item.novos) if (n.exato) iniciais.add(`${item.productId}|${n.mlb}`);
          }
          setMarcados(iniciais);
        }
      } catch (e) {
        if (vivo) setErro(`Falhou: ${String(e).slice(0, 200)}`);
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
  }, []);

  const alterna = (chave: string) => setMarcados((s) => {
    const novo = new Set(s);
    if (novo.has(chave)) novo.delete(chave); else novo.add(chave);
    return novo;
  });

  const totalMarcado = marcados.size;

  async function aplicar() {
    setAplicando(true);
    try {
      let n = 0;
      for (const item of plano) {
        const escolhidos = item.novos.filter((x) => marcados.has(`${item.productId}|${x.mlb}`));
        if (!escolhidos.length) continue;
        const prod = produtos.find((p) => p.id === item.productId);
        if (!prod) continue;
        // Une os anúncios atuais com os escolhidos, sem duplicar.
        const atuais = mlbsDe(prod).map(normMlb).filter(Boolean);
        const merged = Array.from(new Set([...atuais, ...escolhidos.map((x) => x.mlb)]));
        await upsertProduct(uid, { ...prod, mlbs: merged, mlb: merged[0] ?? "" });
        n += escolhidos.length;
        setFeito(n);
      }
      setConcluido(true);
    } catch (e) {
      alert("Erro ao vincular: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setAplicando(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <div className="modal-title">Vincular anúncios por SKU</div>
      <div className="modal-sub">liga cada produto ao anúncio do ML que tem o mesmo SKU</div>

      {carregando ? (
        <div style={{ padding: "24px 0", textAlign: "center", color: "var(--muted)" }}>
          Lendo os anúncios do Mercado Livre…
        </div>
      ) : erro ? (
        <div style={{
          margin: "12px 0", padding: 10, borderRadius: 8,
          background: "rgba(214,90,74,.12)", border: "1px solid rgba(214,90,74,.4)",
          fontFamily: "ui-monospace, monospace", fontSize: ".72rem", whiteSpace: "pre-wrap",
        }}>{erro}</div>
      ) : concluido ? (
        <div style={{
          margin: "12px 0", padding: "12px 14px", borderRadius: 8,
          background: "rgba(54,179,126,.1)", border: "1px solid rgba(54,179,126,.4)",
          color: "var(--green)", fontSize: ".86rem",
        }}>
          <b>{feito} produto{feito === 1 ? "" : "s"} vinculado{feito === 1 ? "" : "s"}.</b> Os dados do ML
          já passam a bater com esses anúncios.
        </div>
      ) : (
        <>
          {resumo && (
            <div style={{
              display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0",
              fontSize: ".76rem", color: "var(--muted)",
            }}>
              <span style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 9px" }}>
                {resumo.anunciosLidos} anúncios lidos
              </span>
              <span style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 9px" }}>
                <b style={{ color: "var(--green)" }}>{resumo.aVincular}</b> vínculo(s) a criar
              </span>
              {resumo.semSku > 0 && (
                <span style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 9px" }}>
                  {resumo.semSku} produto(s) sem SKU
                </span>
              )}
              {resumo.semMatch > 0 && (
                <span style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 9px" }}>
                  {resumo.semMatch} sem anúncio de mesmo SKU
                </span>
              )}
              {resumo.aproximados > 0 && (
                <span style={{ background: "var(--warning-soft)", border: "1px solid rgba(255,138,31,.4)", borderRadius: 6, padding: "4px 9px", color: "var(--warning)" }}>
                  {resumo.aproximados} aproximado(s) — confira antes
                </span>
              )}
            </div>
          )}

          {plano.length === 0 ? (
            <div style={{ padding: "16px 0", fontSize: ".86rem", color: "var(--muted)", lineHeight: 1.6 }}>
              Nada a vincular — todo produto com SKU já está ligado ao anúncio correspondente.
              {!!resumo?.semSku && <> Os {resumo.semSku} produto(s) sem SKU precisam do código preenchido na ficha para casar.</>}
            </div>
          ) : (
            <div style={{ maxHeight: 340, overflow: "auto", margin: "4px 0 12px" }}>
              {plano.map((item) => (
                <div key={item.productId} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                    <span style={{ fontWeight: 600, fontSize: ".86rem" }}>{item.name || "—"}</span>
                    <span style={{ fontSize: ".72rem", color: "var(--muted)", fontFamily: "monospace" }}>SKU {item.sku}</span>
                  </div>

                  {item.atuais.length > 0 && (
                    <div style={{ fontSize: ".72rem", color: "var(--muted)", marginTop: 3 }}>
                      já vinculado: {item.atuais.map((a) => a.mlb).join(", ")}
                    </div>
                  )}

                  {item.novos.map((n) => {
                    const chave = `${item.productId}|${n.mlb}`;
                    const on = marcados.has(chave);
                    return (
                      <label key={n.mlb} style={{
                        display: "flex", gap: 8, alignItems: "flex-start", marginTop: 6,
                        padding: "6px 8px", borderRadius: 6, cursor: "pointer",
                        background: on ? "rgba(54,179,126,.08)" : "var(--surface2)",
                        border: `1px solid ${on ? "rgba(54,179,126,.35)" : "var(--border)"}`,
                      }}>
                        <input
                          type="checkbox" checked={on} onChange={() => alterna(chave)}
                          style={{ marginTop: 3, flexShrink: 0 }}
                        />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ fontFamily: "monospace", fontSize: ".76rem", color: "var(--text)" }}>{n.mlb}</span>
                          {!n.exato && (
                            <span style={{ marginLeft: 6, fontSize: ".64rem", fontWeight: 700, color: "var(--warning)", background: "var(--warning-soft)", padding: "1px 5px", borderRadius: 4 }}>
                              APROXIMADO
                            </span>
                          )}
                          {n.titulo && (
                            <span style={{ display: "block", fontSize: ".73rem", color: "var(--muted)" }}>{n.titulo.slice(0, 52)}</span>
                          )}
                          <span style={{ display: "block", fontSize: ".68rem", color: "var(--muted)", fontFamily: "monospace" }}>
                            SKU no ML: {n.skuAnuncio || "—"}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="modal-btns">
        {!concluido && plano.length > 0 && !erro && (
          <button type="button" className="btn btn-success" onClick={aplicar} disabled={aplicando || carregando || totalMarcado === 0}>
            {aplicando ? `Vinculando… ${feito}` : `Vincular ${totalMarcado} anúncio(s)`}
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={aplicando}>
          {concluido ? "Fechar" : "Cancelar"}
        </button>
      </div>
    </Modal>
  );
}

function ImpostoMassaModal({ uid, produtos, escopoBusca, onClose }: {
  uid: string; produtos: Product[]; escopoBusca: string; onClose: () => void;
}) {
  const [valor, setValor] = useState("4");
  const [desde, setDesde] = useState(todayISO());
  const [salvando, setSalvando] = useState(false);
  const [feito, setFeito] = useState(0);
  // Todos marcados de início: o caso comum é aplicar em tudo, e desmarcar é
  // mais rápido do que marcar produto por produto.
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(produtos.map((p) => p.id)));

  const pct = parseNum(valor);
  const alvos = produtos.filter((p) => marcados.has(p.id));
  const jaTem = alvos.filter((p) => parseNum(p.imposto ?? "0") > 0);

  const alterna = (id: string) => setMarcados((s) => {
    const novo = new Set(s);
    if (novo.has(id)) novo.delete(id); else novo.add(id);
    return novo;
  });

  async function aplicar() {
    if (!Number.isFinite(pct) || pct < 0) { alert("Informe um percentual válido."); return; }
    if (!desde) { alert("Informe a data de início."); return; }
    if (!alvos.length) { alert("Selecione ao menos um produto."); return; }
    setSalvando(true);
    try {
      let n = 0;
      for (const p of alvos) {
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

      <div className="config-field" style={{ marginTop: 4 }}>
        <label style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
          <span>Produtos ({alvos.length} de {produtos.length})</span>
          <span style={{ display: "flex", gap: 8 }}>
            <button
              type="button" className="btn btn-ghost btn-xs"
              onClick={() => setMarcados(new Set(produtos.map((p) => p.id)))}
            >
              todos
            </button>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMarcados(new Set())}>
              nenhum
            </button>
          </span>
        </label>
        <div style={{
          maxHeight: 220, overflow: "auto", borderRadius: 8,
          border: "1px solid var(--border)", background: "var(--surface2)", padding: 6,
        }}>
          {produtos.map((p) => {
            const on = marcados.has(p.id);
            const atual = parseNum(p.imposto ?? "0");
            return (
              <label key={p.id} style={{
                display: "flex", gap: 8, alignItems: "center", padding: "6px 8px",
                borderRadius: 6, cursor: "pointer", background: on ? "rgba(233,169,45,.1)" : undefined,
              }}>
                <input type="checkbox" checked={on} onChange={() => alterna(p.id)} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: ".84rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name || "Sem nome"}
                </span>
                <span style={{ fontSize: ".74rem", color: atual > 0 ? "#F4B942" : "var(--muted)", whiteSpace: "nowrap" }}>
                  {atual > 0 ? `hoje ${atual}%` : "sem imposto"}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div style={{
        marginTop: 12, padding: "10px 12px", borderRadius: 8, fontSize: ".82rem", lineHeight: 1.55,
        background: "var(--surface2)", border: "1px solid var(--border)",
      }}>
        Vai aplicar <b>{pct}%</b> em <b>{alvos.length} produto{alvos.length === 1 ? "" : "s"}</b>
        {escopoBusca ? <> — a lista mostra só os da busca “{escopoBusca}”.</> : <>.</>}
        {jaTem.length > 0 && (
          <div style={{ marginTop: 6, color: "var(--warning)" }}>
            {jaTem.length === 1
              ? "1 deles já tem imposto e será sobrescrito."
              : `${jaTem.length} deles já têm imposto e serão sobrescritos.`}
          </div>
        )}
      </div>

      <div style={{
        marginTop: 10, padding: "10px 12px", borderRadius: 8, fontSize: ".82rem", lineHeight: 1.55,
        background: "rgba(54,179,126,.1)", border: "1px solid rgba(54,179,126,.35)", color: "var(--green)",
      }}>
        Vendas <b>antes de {desde.split("-").reverse().join("/")}</b> continuam sem esse imposto —
        o lucro dos meses já fechados não muda.
      </div>

      <div className="modal-btns">
        <button type="button" className="btn btn-success" onClick={aplicar} disabled={salvando || alvos.length === 0}>
          {salvando ? `Aplicando… ${feito}/${alvos.length}` : `Aplicar em ${alvos.length}`}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={salvando}>Cancelar</button>
      </div>
    </Modal>
  );
}
