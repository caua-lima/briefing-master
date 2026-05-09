"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  archiveDay,
  clearDraft,
  saveDraft,
  upsertProduct,
} from "@/lib/firebase/data";
import {
  colorClass,
  computeAd,
  computeSummary,
  fmtBRL,
  formatDateBR,
  parseBRNumber,
  todayStr,
  totalCustosDia,
} from "@/lib/domain/calc";
import type { Listing, Product } from "@/lib/domain/types";
import MetaDiaria from "@/components/MetaDiaria";
import Modal from "@/components/Modal";
import { ProductModal } from "@/components/tabs/EstoqueTab";
import type { UserData } from "@/components/useUserData";

// `retorno` = liquido por unidade ja descontado o custo do produto.
// Auto-calc: preco - custo. Usuario pode ajustar manualmente.
function calcRetorno(preco: string, custo: string): string {
  const p = parseBRNumber(preco);
  const c = parseBRNumber(custo);
  return p ? (p - c).toFixed(2) : "";
}

const DEFAULT_AD: Listing = {
  name: "",
  preco: "",
  retorno: "",
  custo: "",
  vendas: "",
  ads: "",
};

export default function HojeTab({
  uid,
  data,
}: {
  uid: string;
  data: UserData;
}) {
  const [ads, setAds] = useState<Listing[]>(() =>
    data.draft?.ads?.length ? data.draft.ads : [{ ...DEFAULT_AD }]
  );
  const [showResults, setShowResults] = useState(false);
  const [showOntem, setShowOntem] = useState(() =>
    !!(data.draft?.ads?.length && data.draft.date && data.draft.date !== todayStr())
  );
  const [ontemDate, setOntemDate] = useState<string | null>(() =>
    data.draft?.ads?.length && data.draft.date && data.draft.date !== todayStr() ? data.draft.date : null
  );
  const [showFechar, setShowFechar] = useState(false);
  const [fecharDate, setFecharDate] = useState(todayStr());
  const [showLancar, setShowLancar] = useState(false);
  const lastSavedRef = useRef<string>("");
  const [hydrated] = useState(true);

  // Auto-save draft (debounced, persists across devices via Firestore)
  useEffect(() => {
    if (!hydrated) return;
    const sig = JSON.stringify(ads);
    if (sig === lastSavedRef.current) return;
    lastSavedRef.current = sig;
    const handle = setTimeout(() => {
      saveDraft(uid, { date: todayStr(), ads }).catch(() => {});
    }, 350);
    return () => clearTimeout(handle);
  }, [ads, hydrated, uid]);

  const summary = useMemo(() => computeSummary(ads), [ads]);
  const custosDia = useMemo(
    () => totalCustosDia(data.costs, todayStr()),
    [data.costs],
  );
  const lLiqFinal = summary.totalLiquido - custosDia;
  const margemFinal =
    summary.totalFaturamento > 0
      ? (lLiqFinal / summary.totalFaturamento) * 100
      : 0;

  function updateAd(idx: number, patch: Partial<Listing>) {
    setAds((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  }
  function removeAd(idx: number) {
    setAds((prev) => prev.filter((_, i) => i !== idx));
  }

  function onCalculate() {
    if (!ads.length) {
      alert("Adicione pelo menos um anúncio.");
      return;
    }
    setShowResults(true);
    setTimeout(() => {
      document
        .getElementById("results-section")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  function onClearAll() {
    if (!confirm("Apagar dados de hoje? O histórico é mantido.")) return;
    setAds([{ ...DEFAULT_AD }]);
    setShowResults(false);
    clearDraft(uid).catch(() => {});
  }

  async function onArchiveOntem() {
    if (!data.draft) { setShowOntem(false); return; }
    const day = computeSummary(data.draft.ads || []);
    await archiveDay(uid, {
      date: data.draft.date,
      ...day,
      raw: data.draft.ads || [],
    });
    await clearDraft(uid);
    setAds([{ ...DEFAULT_AD }]);
    setShowResults(false);
    setShowOntem(false);
    setOntemDate(null);
  }

  function onKeepOntem() {
    setShowOntem(false);
    setOntemDate(null);
  }

  async function onConfirmarFechar() {
    if (!fecharDate) { alert("Selecione uma data."); return; }
    if (!ads.length) { alert("Sem dados para arquivar."); return; }
    const exists = data.days.some((d) => d.date === fecharDate);
    if (
      exists &&
      !confirm(`Já existe um registro para ${formatDateBR(fecharDate)}. Deseja substituir?`)
    ) return;
    const s = computeSummary(ads);
    await archiveDay(uid, { date: fecharDate, ...s, raw: ads });
    await clearDraft(uid);
    setAds([{ ...DEFAULT_AD }]);
    setShowResults(false);
    setShowFechar(false);
  }

  return (
    <>
      <MetaDiaria goals={data.goals} fat={summary.totalFaturamento} />

      <div className="top-actions">
        <div className="left-btns">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowLancar(true)}
          >
            🛒 Lançar Venda
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() =>
              setAds((prev) => [...prev, { ...DEFAULT_AD }])
            }
          >
            ＋ Anúncio Manual
          </button>
          <button
            type="button"
            className="btn btn-success"
            onClick={onCalculate}
          >
            ⚡ Calcular Tudo
          </button>
        </div>
        <button
          type="button"
          className="btn btn-warning"
          onClick={() => {
            if (!ads.length) {
              alert("Adicione pelo menos um anúncio antes de fechar o dia.");
              return;
            }
            setFecharDate(todayStr());
            setShowFechar(true);
          }}
        >
          📁 Fechar o Dia
        </button>
        <button type="button" className="btn btn-danger" onClick={onClearAll}>
          🗑 Limpar Tudo
        </button>
      </div>

      <div>
        {ads.map((a, idx) => (
          <AdCard
            key={idx}
            num={idx + 1}
            ad={a}
            onChange={(p) => updateAd(idx, p)}
            onRemove={() => removeAd(idx)}
          />
        ))}
      </div>

      {showResults && (
        <section id="results-section" className="results-section">
          <h2>📊 Resultado por Anúncio</h2>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Anúncio</th>
                  <th>Faturamento</th>
                  <th>CMV</th>
                  <th>L. Bruto</th>
                  <th>Ads</th>
                  <th>L. Líquido</th>
                  <th>Margem</th>
                  <th>ROAS</th>
                </tr>
              </thead>
              <tbody>
                {ads.map((raw, i) => {
                  const r = computeAd(raw);
                  const roasTxt = r.roas !== null ? `${r.roas.toFixed(2)}x` : "—";
                  const roasCls =
                    r.roas !== null
                      ? r.roas >= 1 ? "positive" : "negative"
                      : "neutral";
                  return (
                    <tr key={i}>
                      <td className="td-name">{r.name}</td>
                      <td className="positive">{fmtBRL(r.faturamento)}</td>
                      <td className="negative">{fmtBRL(r.cmv)}</td>
                      <td className={colorClass(r.bruto)}>{fmtBRL(r.bruto)}</td>
                      <td className="negative">{fmtBRL(r.ads)}</td>
                      <td className={colorClass(r.liquido)}>{fmtBRL(r.liquido)}</td>
                      <td
                        className={
                          r.margem >= 10 ? "positive" : r.margem > 0 ? "neutral" : "negative"
                        }
                      >
                        {r.margem.toFixed(1)}%
                      </td>
                      <td className={roasCls}>{roasTxt}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {custosDia > 0 && (
            <div
              style={{
                marginTop: 12,
                padding: "12px 16px",
                background: "rgba(239,68,68,.07)",
                border: "1px solid rgba(239,68,68,.25)",
                borderRadius: 10,
                fontSize: ".85rem",
                color: "#ef4444",
              }}
            >
              💸 <strong>Custos Operacionais do Dia:</strong>{" "}
              {data.costs
                .filter(
                  (c) =>
                    c.freq === "diario" ||
                    (c.freq === "avulso" && c.data === todayStr()),
                )
                .map((c) => `${c.nome}: ${fmtBRL(parseFloat(c.valor) || 0)}`)
                .join(" · ")}{" "}
              &nbsp;→&nbsp; <strong>Total: −{fmtBRL(custosDia)}</strong>
            </div>
          )}

          <div className="summary-grid">
            <div className="summary-card card-receita">
              <div className="card-label">💵 Faturamento Total</div>
              <div className="card-value positive">
                {fmtBRL(summary.totalFaturamento)}
              </div>
              <div className="card-sub">CMV: {fmtBRL(summary.totalCMV)}</div>
            </div>
            <div className="summary-card card-bruto">
              <div className="card-label">💼 Lucro Bruto</div>
              <div className={`card-value ${colorClass(summary.totalBruto)}`}>
                {fmtBRL(summary.totalBruto)}
              </div>
              <div className="card-sub">Antes dos Ads</div>
            </div>
            <div className="summary-card card-liquido">
              <div className="card-label">✅ Lucro Líquido</div>
              <div className={`card-value ${colorClass(lLiqFinal)}`}>
                {fmtBRL(lLiqFinal)}
              </div>
              <div className="card-sub">
                Margem: {margemFinal.toFixed(1)}%
                {custosDia > 0 ? ` · Custos op: −${fmtBRL(custosDia)}` : ""}
              </div>
            </div>
            <div className="summary-card card-roas">
              <div className="card-label">📢 ROAS Total</div>
              <div
                className={`card-value ${
                  summary.totalRoas !== null
                    ? summary.totalRoas >= 1 ? "positive" : "negative"
                    : "neutral"
                }`}
              >
                {summary.totalRoas !== null
                  ? `${summary.totalRoas.toFixed(2)}x`
                  : "—"}
              </div>
              <div className="card-sub">Faturamento ÷ Ads</div>
            </div>
          </div>
        </section>
      )}

      {/* Modal: yesterday draft */}
      <Modal open={showOntem} onClose={onKeepOntem}>
        <div className="modal-icon">📅</div>
        <div className="modal-title">Dados de ontem detectados</div>
        <p className="modal-sub">
          Os dados são de{" "}
          <strong>{ontemDate ? formatDateBR(ontemDate) : ""}</strong>. Deseja
          arquivar no histórico e começar hoje?
        </p>
        <div className="modal-btns">
          <button type="button" className="btn btn-success" onClick={onArchiveOntem}>
            ✅ Arquivar e limpar
          </button>
          <button type="button" className="btn btn-ghost" onClick={onKeepOntem}>
            📂 Manter
          </button>
        </div>
      </Modal>

      {/* Modal: close day */}
      <Modal open={showFechar} onClose={() => setShowFechar(false)}>
        <div className="modal-icon">📁</div>
        <div className="modal-title">Fechar o Dia</div>
        <p className="modal-sub">
          Arquiva os dados atuais no histórico para a data escolhida.
        </p>
        <div className="config-field">
          <label>📅 Data do dia</label>
          <input
            type="date"
            value={fecharDate}
            onChange={(e) => setFecharDate(e.target.value)}
          />
        </div>
        <div style={{ marginTop: 4, fontSize: ".82rem", color: "var(--muted)" }}>
          {fecharDate ? (
            <>
              Arquivar: <strong>{formatDateBR(fecharDate)}</strong> ·
              Faturamento: <strong>{fmtBRL(summary.totalFaturamento)}</strong> ·
              L.Líquido: <strong>{fmtBRL(summary.totalLiquido)}</strong>
            </>
          ) : null}
        </div>
        <div className="modal-btns">
          <button type="button" className="btn btn-success" onClick={onConfirmarFechar}>
            ✅ Arquivar e Limpar
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setShowFechar(false)}>
            ✕ Cancelar
          </button>
        </div>
      </Modal>

      {/* Modal: launch sale */}
      {showLancar && (
        <LancarVendaModal
          uid={uid}
          products={data.products}
          onClose={() => setShowLancar(false)}
          onAdd={(listing) => {
            setAds((prev) => [...prev, listing]);
            setShowLancar(false);
          }}
        />
      )}
    </>
  );
}

// ─── Lançar Venda Modal ────────────────────────────────────────
function LancarVendaModal({
  uid,
  products,
  onClose,
  onAdd,
}: {
  uid: string;
  products: Product[];
  onClose: () => void;
  onAdd: (l: Listing) => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [ads, setAds] = useState("");
  const [vendas, setVendas] = useState("");
  const [retorno, setRetorno] = useState("");
  const [retornoManual, setRetornoManual] = useState(false);
  const [showNewProduct, setShowNewProduct] = useState(false);
  const [newProductBlank, setNewProductBlank] = useState<Product | null>(null);

  const activeProducts = products.filter((p) => p.ativo);
  const filtered = activeProducts.filter((p) => {
    const q = search.toLowerCase();
    return (
      !q ||
      p.name.toLowerCase().includes(q) ||
      (p.mlb ?? "").toLowerCase().includes(q)
    );
  });

  function selectProduct(p: Product) {
    setSelected(p);
    setRetorno(p.retorno || "");
    setRetornoManual(false);
  }

  function handleAdd() {
    if (!selected) { alert("Selecione um produto."); return; }
    if (!vendas || parseFloat(vendas) <= 0) { alert("Informe o número de vendas."); return; }
    if (!ads) { alert("Informe o gasto com Ads."); return; }
    onAdd({
      name: selected.name,
      preco: selected.preco,
      retorno: retornoManual ? retorno : selected.retorno,
      custo: selected.custo,
      vendas,
      ads,
      mlb: selected.mlb,
      productId: selected.id,
    });
  }

  if (showNewProduct && newProductBlank) {
    return (
      <ProductModal
        product={newProductBlank}
        isNew
        onClose={() => setShowNewProduct(false)}
        onSave={async (prod: Product) => {
          await upsertProduct(uid, prod);
          selectProduct(prod);
          setShowNewProduct(false);
        }}
      />
    );
  }

  return (
    <Modal open onClose={onClose} wide>
      <div className="modal-icon">🛒</div>
      <div className="modal-title">Lançar Venda</div>

      {!selected ? (
        <>
          <p className="modal-sub">Busque um produto pelo nome ou código MLB</p>
          <input
            type="text"
            placeholder="🔍 Nome ou MLB…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
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
              marginBottom: 12,
            }}
          />
          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ textAlign: "center", padding: "20px 0", color: "var(--muted)" }}>
                <p style={{ marginBottom: 12 }}>
                  {activeProducts.length === 0
                    ? "Nenhum produto em estoque."
                    : "Nenhum produto encontrado."}
                </p>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setNewProductBlank({
                      id: "p" + Date.now() + Math.random().toString(36).slice(2, 6),
                      name: search,
                      preco: "",
                      retorno: "",
                      custo: "",
                      mlb: "",
                      ativo: true,
                    });
                    setShowNewProduct(true);
                  }}
                >
                  ＋ Cadastrar novo produto
                </button>
              </div>
            ) : (
              <>
                {filtered.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => selectProduct(p)}
                    onKeyDown={(e) => e.key === "Enter" && selectProduct(p)}
                    role="button"
                    tabIndex={0}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "10px 14px",
                      borderRadius: 8,
                      marginBottom: 6,
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
                      cursor: "pointer",
                      transition: "border-color .15s",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: ".9rem" }}>{p.name}</div>
                      {p.mlb && (
                        <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>{p.mlb}</div>
                      )}
                    </div>
                    <div style={{ textAlign: "right", fontSize: ".82rem" }}>
                      <div className="positive">R$ {(parseFloat(p.preco) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</div>
                      <div style={{ color: "var(--muted)" }}>
                        Custo: R$ {(parseFloat(p.custo) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>
                ))}
                <div style={{ marginTop: 8, textAlign: "center" }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setNewProductBlank({
                        id: "p" + Date.now() + Math.random().toString(36).slice(2, 6),
                        name: search,
                        preco: "",
                        retorno: "",
                        custo: "",
                        mlb: "",
                        ativo: true,
                      });
                      setShowNewProduct(true);
                    }}
                  >
                    ＋ Cadastrar novo produto
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <div
            style={{
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "12px 14px",
              marginBottom: 16,
            }}
          >
            <div style={{ fontWeight: 700 }}>{selected.name}</div>
            <div style={{ fontSize: ".8rem", color: "var(--muted)", marginTop: 2 }}>
              {selected.mlb && <span style={{ marginRight: 10 }}>{selected.mlb}</span>}
              Preço: R$ {(parseFloat(selected.preco) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} ·
              Custo: R$ {(parseFloat(selected.custo) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </div>
            <button
              type="button"
              style={{
                marginTop: 6,
                fontSize: ".75rem",
                color: "var(--muted)",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
              onClick={() => setSelected(null)}
            >
              ← Trocar produto
            </button>
          </div>

          <div className="config-field">
            <label>
              📥 Retorno líquido/unidade (R$)
              <span style={{ marginLeft: 8, fontSize: ".72rem", color: "var(--muted)" }}>
                {retornoManual ? "(editado)" : "(auto)"}
              </span>
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={retorno}
              onChange={(e) => { setRetornoManual(true); setRetorno(e.target.value); }}
            />
          </div>

          <div className="config-field">
            <label>🛒 Número de vendas</label>
            <input
              type="number"
              min="1"
              step="1"
              placeholder="Ex: 10"
              value={vendas}
              onChange={(e) => setVendas(e.target.value)}
            />
          </div>

          <div className="config-field">
            <label>📢 Gasto com Ads (R$)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={ads}
              onChange={(e) => setAds(e.target.value)}
            />
          </div>

          <div className="modal-btns">
            <button type="button" className="btn btn-success" onClick={handleAdd}>
              ✅ Adicionar Venda
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              ✕ Cancelar
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ─── AdCard ───────────────────────────────────────────────────
function AdCard({
  num,
  ad,
  onChange,
  onRemove,
}: {
  num: number;
  ad: Listing;
  onChange: (p: Partial<Listing>) => void;
  onRemove: () => void;
}) {
  const [retornoManual, setRetornoManual] = useState(false);

  // Auto-calc retorno when preco or custo changes
  useEffect(() => {
    if (!retornoManual) {
      const r = calcRetorno(ad.preco, ad.custo);
      if (r !== ad.retorno) onChange({ retorno: r });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ad.preco, ad.custo, retornoManual]);

  return (
    <div className="ad-card">
      <div className="ad-card-header">
        <span className="ad-number">{num}</span>
        <input
          className="ad-title-input"
          type="text"
          placeholder="Nome do anúncio"
          value={ad.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <button
          type="button"
          className="btn btn-danger btn-sm"
          onClick={onRemove}
        >
          ✕ Remover
        </button>
      </div>
      {ad.mlb && (
        <div style={{ fontSize: ".75rem", color: "var(--muted)", marginBottom: 8 }}>
          🏷️ {ad.mlb}
        </div>
      )}
      <div className="fields-grid">
        <Field
          label="🏷️ Preço de venda (R$)"
          value={ad.preco}
          onChange={(v) => onChange({ preco: v })}
        />
        <Field
          label="💰 Custo/unidade (R$)"
          value={ad.custo}
          onChange={(v) => onChange({ custo: v })}
        />
        <div className="field-group">
          <label>
            📥 Retorno líq./unidade (R$)
            {retornoManual && (
              <button
                type="button"
                onClick={() => {
                  setRetornoManual(false);
                  onChange({ retorno: calcRetorno(ad.preco, ad.custo) });
                }}
                style={{
                  marginLeft: 6,
                  fontSize: ".7rem",
                  background: "none",
                  border: "none",
                  color: "var(--muted)",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                ↺
              </button>
            )}
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={ad.retorno}
            onChange={(e) => {
              setRetornoManual(true);
              onChange({ retorno: e.target.value });
            }}
          />
        </div>
        <Field
          label="🛒 Nº de vendas"
          value={ad.vendas}
          onChange={(v) => onChange({ vendas: v })}
          step="1"
        />
        <Field
          label="📢 Gasto com Ads (R$)"
          value={ad.ads}
          onChange={(v) => onChange({ ads: v })}
        />
        <div className="field-group">
          <label>🏷️ Código MLB</label>
          <input
            type="text"
            placeholder="MLB1234…"
            value={ad.mlb ?? ""}
            onChange={(e) => onChange({ mlb: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
}) {
  return (
    <div className="field-group">
      <label>{label}</label>
      <input
        type="number"
        min="0"
        step={step ?? "0.01"}
        placeholder="0.00"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}