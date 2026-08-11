"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { impostoNaData, type EstoqueMovimento, type MovimentoTipo, type Product } from "@/lib/domain/types";
import { addMovimento, deleteMovimento, deleteProduct, upsertProduct, watchMovimentos } from "@/lib/firebase/data";
import { fmtBRL } from "@/lib/domain/calc";
import { calcularCustoMedioEntrada, calcularCustoMedioSaldoInicial, getCoverageStatus } from "@/lib/domain/estoque";
import Modal from "@/components/Modal";
import type { UserData } from "@/components/useUserData";
import { authedFetch } from "@/lib/api/authed-fetch";
import { useAccess } from "@/components/tabs/AccessGuard";
import {
  ehFullLogistic, mlbsDe, custoMedioDe, anunciosDe, fullDe, foraDoFullDe, precosDe, previsaoDe,
  parseNum, todayISO, newId, newMovId, FULL_BAIXO, DIAS_ALVO,
  type EstoqueML, type Forecast,
} from "./estoque/helpers";
import VincularSkuModal from "./estoque/VincularSkuModal";
import ImpostoMassaModal from "./estoque/ImpostoMassaModal";
import RemessasFull from "./estoque/RemessasFull";
import PrevisaoPanel from "./estoque/PrevisaoPanel";

export default function EstoqueTab({ uid, data }: { uid: string; data: UserData }) {
  const { canEditTab } = useAccess();
  const canEdit = canEditTab("estoque");
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState("");
  const [estoqueML, setEstoqueML] = useState<EstoqueML>({});
  const [forecast, setForecast] = useState<Forecast>({ vendas: {}, dias: DIAS_ALVO });
  const [loadingML, setLoadingML] = useState(false);
  const [atualizadoEmML, setAtualizadoEmML] = useState<string | null>(null);
  const [movimentos, setMovimentos] = useState<EstoqueMovimento[]>([]);
  const [movModal, setMovModal] = useState<{ product: Product; tipo: MovimentoTipo } | null>(null);
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
      if (rMl.ok) {
        const j = await rMl.json();
        setEstoqueML(j.estoque ?? {});
        setAtualizadoEmML(j.atualizadoEm ?? null);
      }
      if (rFc.ok) { const j = await rFc.json(); setForecast({ vendas: j.vendas ?? {}, dias: j.dias ?? DIAS_ALVO }); }
    } catch { /* ignora */ } finally { setLoadingML(false); }
  }, []);

  // Falso positivo comprovado (auditoria Fase 9): fetch no mount —
  // carregarEstoque() faz setState de forma assíncrona.
  // eslint-disable-next-line react-hooks/set-state-in-effect
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
  // Valor parado = (Full + estoque fora do Full) × custo médio. O próprio não
  // soma com casa: é o mesmo estoque exposto no anúncio.
  // Produto com unidade em estoque mas SEM custo cadastrado contribui 0 pra
  // soma — sem contar quantos ficaram de fora, o card "Valor em estoque"
  // pareceria um total completo quando na verdade está subestimado (viola a
  // regra de nunca esconder que um número é incompleto).
  let produtosSemCustoComEstoque = 0;
  const valorEstoque = data.products.reduce((s, p) => {
    const casa = Math.max(p.qtdLocal ?? 0, 0);
    const { qtd: full, proprio } = fullDe(p, estoqueML);
    const qtdTotal = full + foraDoFullDe(casa, proprio);
    const custo = custoMedioDe(p);
    if (qtdTotal > 0 && custo <= 0) produtosSemCustoComEstoque++;
    return s + qtdTotal * custo;
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
    let ruptura = 0, critico = 0, repor = 0, encalhado = 0, valorEmRisco = 0, semCusto = 0;
    for (const p of data.products) {
      if (!p.ativo) continue;
      const f = previsaoDe(p, estoqueML, forecast);
      const vendasPeriodo = forecast.vendas[p.id] ?? 0;
      const coberturaDias = Number.isFinite(f.cobertura) ? f.cobertura : null;
      const status = getCoverageStatus(coberturaDias, f.total, vendasPeriodo);
      const custo = custoMedioDe(p);
      if (f.total <= 0) ruptura++;
      if (status === "critico") { critico++; valorEmRisco += f.total * custo; if (f.total > 0 && custo <= 0) semCusto++; }
      else if (status === "repor") repor++;
      else if (status === "encalhado") { encalhado++; valorEmRisco += f.total * custo; if (f.total > 0 && custo <= 0) semCusto++; }
    }
    return { ruptura, critico, repor, encalhado, valorEmRisco, semCusto };
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
          {atualizadoEmML && (
            <span className="tab-head-sub" title="Dado buscado ao vivo do ML nesta abertura — não é histórico">
              Full atualizado às {new Date(atualizadoEmML).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
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
        <div className="kpi k-pos">
          <div className="k-lbl">Valor em estoque</div>
          <div className="k-val" style={{ color: "var(--green)" }}>{fmtBRL(valorEstoque)}</div>
          <div className="k-sub">
            (casa + Full) × custo médio
            {produtosSemCustoComEstoque > 0 && (
              <> · <span style={{ color: "var(--yellow)" }}>{produtosSemCustoComEstoque} sem custo, fora deste total</span></>
            )}
          </div>
        </div>
        <div className="kpi k-warn"><div className="k-lbl">Em casa</div><div className="k-val" style={{ color: "var(--yellow)" }}>{unCasa} un</div><div className="k-sub">controle manual</div></div>
        <div className="kpi k-pos"><div className="k-lbl">No Full (ML)</div><div className="k-val" style={{ color: unFull > 0 ? "var(--green)" : "var(--muted)" }}>{unFull} un</div><div className="k-sub">ao vivo do Mercado Livre</div></div>
        <div className="kpi k-acc"><div className="k-lbl">Venda potencial</div><div className="k-val">{fmtBRL(valorPotencialVenda)}</div><div className="k-sub">estoque × preço ML atual</div></div>
        <div className="kpi k-neg"><div className="k-lbl">Em ruptura</div><div className="k-val" style={{ color: resumoCobertura.ruptura > 0 ? "var(--red)" : "var(--muted)" }}>{resumoCobertura.ruptura}</div><div className="k-sub">estoque total zerado</div></div>
        <div className="kpi k-neg"><div className="k-lbl">Cobertura crítica</div><div className="k-val" style={{ color: resumoCobertura.critico > 0 ? "var(--red)" : "var(--muted)" }}>{resumoCobertura.critico}</div><div className="k-sub">&lt; 7 dias de giro</div></div>
        <div className="kpi k-warn"><div className="k-lbl">Cobertura baixa</div><div className="k-val" style={{ color: resumoCobertura.repor > 0 ? "var(--yellow)" : "var(--muted)" }}>{resumoCobertura.repor}</div><div className="k-sub">7–15 dias, repor em breve</div></div>
        <div className="kpi k-warn"><div className="k-lbl">Capital parado</div><div className="k-val" style={{ color: resumoCobertura.encalhado > 0 ? "#F4B942" : "var(--muted)" }}>{resumoCobertura.encalhado}</div><div className="k-sub">sem venda no período</div></div>
        <div className="kpi k-neg">
          <div className="k-lbl">Valor em risco</div>
          <div className="k-val" style={{ color: resumoCobertura.valorEmRisco > 0 ? "var(--red)" : "var(--muted)" }}>{fmtBRL(resumoCobertura.valorEmRisco)}</div>
          <div className="k-sub">
            crítico + encalhado × custo médio
            {resumoCobertura.semCusto > 0 && (
              <> · <span style={{ color: "var(--yellow)" }}>{resumoCobertura.semCusto} sem custo, fora deste total</span></>
            )}
          </div>
        </div>
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
  product, estoqueML, expanded, onToggle, onEdit, onMov,
}: {
  product: Product;
  uid: string;
  estoqueML: EstoqueML;
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
  const totalUn = full + foraDoFullDe(casa, proprio);
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
        <td data-label="Em casa" style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap", color: casa > 0 ? "var(--yellow)" : "var(--muted)" }}>{casa} un</td>
        <td data-label="Full (ML)" style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap", color: !ehFull ? "var(--muted)" : fullBaixo ? "var(--red)" : "var(--green)" }}>
          {ehFull ? `${full} un` : "—"}
          {fullBaixo && casa > 0 && <span title="Envie de casa pro Full" style={{ display: "block", fontSize: ".62rem", color: "#F4B942" }}>reabastecer</span>}
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
            <button type="button" className="btn btn-warning btn-xs" title="Editar produto" onClick={onEdit}>Editar</button>
            <button type="button" className="btn btn-danger btn-xs" title="Remover produto" onClick={() => { if (!confirm(`Remover "${product.name}"?`)) return; deleteProduct("", product.id).catch(() => {}); }}>Excluir</button>
          </div>
        </td>
      </tr>
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
                      <button
                        type="button" className="btn btn-danger btn-xs" title="Excluir movimentação"
                        onClick={() => {
                          // A quantidade É recalculada do livro inteiro (recomputeProduto em
                          // lib/firebase/data.ts), mas o custo médio NÃO — ele é um blend
                          // incremental contra o estoque no momento do lançamento (inclusive
                          // o Full, que vem ao vivo do ML, não do livro), então não dá pra
                          // "desfazer" matematicamente sem saber o estoque de Full de quando
                          // o lançamento foi feito. Avisar isso é mais seguro do que prometer
                          // um recálculo que não acontece.
                          const aviso = isCompra
                            ? `Excluir esta movimentação?\n\nA quantidade em casa será recalculada, mas o CUSTO MÉDIO NÃO muda sozinho — esta movimentação tinha custo lançado (${m.custoUnit != null ? fmtBRL(m.custoUnit) : "—"}). Revise o custo médio do produto manualmente depois, se precisar.`
                            : "Excluir esta movimentação? A quantidade em casa será recalculada.";
                          if (!confirm(aviso)) return;
                          deleteMovimento(m.id, product.id).catch(() => {});
                        }}
                      >
                        Excluir
                      </button>
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

  // ENTRADA: blenda a compra nova contra tudo que você tem (Full + fora do
  // Full, onde fora do Full já é casa + anúncio próprio somados).
  const estoqueAtual = full + foraDoFullDe(casa, proprio);
  const novoAvgEntrada = calcularCustoMedioEntrada(estoqueAtual, avgAtual, qNum, cNum);

  // SALDO INICIAL (Full): as unidades do Full ainda não têm custo. Blenda elas,
  // ao custo informado, contra o que está FORA do Full (casa + próprio), que já
  // reflete o custo médio atual. Sem estoque fora do Full, o custo do Full vira
  // o próprio custo médio. Antes o saldo SOBRESCREVIA o custo médio — errado
  // quando já havia estoque em casa com custo.
  const foraDoFull = foraDoFullDe(casa, proprio);
  const novoAvgSaldo = calcularCustoMedioSaldoInicial(foraDoFull, avgAtual, qNum, cNum);

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
