"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { fmtBRL } from "@/lib/domain/calc";
import { authedFetch } from "@/lib/api/authed-fetch";
import DateRangePicker from "@/components/dashboard/DateRangePicker";

type ItemPedido = {
  produto: string;
  mlb: string;
  qtd: number;
  valor: number;
  retorno: number;
  cmv: number;
  envio: number;
  taxaML: number;
  imposto: number;
  lucro: number;
  vinculado: boolean;
};

type Pedido = {
  order_id: string;
  data: string;
  hora: string;
  status: string;
  produto: string;
  qtd: number;
  valor: number;
  bruto: number;
  retorno: number;      // valor − taxa − frete (o que volta)
  cmv: number;
  envio: number;
  taxaML: number;
  imposto: number;
  lucro: number;
  margem: number;
  vinculado: boolean;
  itens?: ItemPedido[];
};

function monthRange() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return { from: `${d.getFullYear()}-${mm}-01`, to: `${d.getFullYear()}-${mm}-${String(last).padStart(2, "0")}` };
}

/**
 * Cascata do pedido, na ordem em que o dinheiro sai: o cliente paga, o ML
 * retém taxa e frete (isso é o retorno), e do retorno saem custo, imposto e
 * o que sobra. Fora da tabela porque o celular não comporta 12 colunas.
 */
function DetalhePedido({ pedido: p }: { pedido: Pedido }) {
  const linha = (
    rotulo: string, valor: number,
    opts: { sinal?: "menos"; forte?: boolean; cor?: string; nota?: string } = {},
  ) => (
    <div style={{
      display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline",
      padding: "5px 0", borderTop: opts.forte ? "1px solid var(--border)" : undefined,
      marginTop: opts.forte ? 4 : 0,
    }}>
      <span style={{ fontSize: ".8rem", color: opts.forte ? "var(--text)" : "var(--muted)", fontWeight: opts.forte ? 700 : 400 }}>
        {rotulo}
        {opts.nota && <span style={{ display: "block", fontSize: ".68rem", color: "var(--muted)", fontWeight: 400 }}>{opts.nota}</span>}
      </span>
      <span style={{
        fontSize: ".84rem", whiteSpace: "nowrap", fontWeight: opts.forte ? 800 : 600,
        color: opts.cor ?? (opts.sinal === "menos" ? "var(--red)" : "var(--text)"),
      }}>
        {opts.sinal === "menos" ? "−" : ""}{fmtBRL(Math.abs(valor))}
      </span>
    </div>
  );

  const itens = p.itens ?? [];

  return (
    <div style={{ padding: "12px 16px", display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
      <div>
        <div style={{ fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted)", marginBottom: 4 }}>
          Da venda até o seu bolso
        </div>
        {linha("Valor da venda", p.valor)}
        {linha("Taxa do Mercado Livre", p.taxaML, { sinal: "menos" })}
        {linha("Frete", p.envio, { sinal: "menos", nota: "custo de envio do pedido" })}
        {linha("Retorno", p.retorno, { forte: true, nota: "o que o ML te repassa" })}
        {linha("Custo do produto", p.cmv, { sinal: "menos", nota: "custo médio × unidades" })}
        {linha("Imposto", p.imposto, { sinal: "menos" })}
        {linha("Lucro líquido", p.lucro, {
          forte: true, cor: p.lucro >= 0 ? "var(--green)" : "var(--red)",
          nota: `margem de ${p.margem.toFixed(1)}% sobre a venda`,
        })}
        {!p.vinculado && (
          <div style={{ marginTop: 8, fontSize: ".74rem", color: "#f7c948", lineHeight: 1.5 }}>
            Produto sem cadastro no Estoque: o custo entra como zero, então esse
            lucro está <b>maior do que o real</b>.
          </div>
        )}
      </div>

      {itens.length > 1 && (
        <div>
          <div style={{ fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted)", marginBottom: 4 }}>
            {itens.length} produtos neste pedido
          </div>
          {itens.map((it, i) => (
            <div key={`${it.mlb}-${i}`} style={{ padding: "6px 0", borderTop: i ? "1px solid var(--border)" : undefined }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: ".8rem", fontWeight: 600 }}>{it.qtd}× {it.produto || it.mlb}</span>
                <span style={{ fontSize: ".8rem", fontWeight: 700, whiteSpace: "nowrap", color: it.lucro >= 0 ? "var(--green)" : "var(--red)" }}>
                  {fmtBRL(it.lucro)}
                </span>
              </div>
              <div style={{ fontSize: ".7rem", color: "var(--muted)" }}>
                venda {fmtBRL(it.valor)} · taxa {fmtBRL(it.taxaML)} · frete {fmtBRL(it.envio)} ·
                custo {fmtBRL(it.cmv)} · imposto {fmtBRL(it.imposto)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PedidosTab() {
  const [range, setRange] = useState(() => monthRange());
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "lucro" | "prejuizo" | "semcad">("todos");
  const [modo, setModo] = useState<"pedido" | "produto">("pedido");
  const [detalhe, setDetalhe] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch(`/api/ml/pedidos?from=${range.from}&to=${range.to}`, { cache: "no-store" });
      if (res.ok) setPedidos((await res.json()).pedidos ?? []);
      else setPedidos([]);
    } catch {
      setPedidos([]);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  async function atualizar() {
    setLoading(true);
    try { await authedFetch("/api/ml/sync-all", { method: "POST" }); } catch { /* ignora */ }
    await load();
  }

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return pedidos.filter((p) => {
      if (q && !(p.produto.toLowerCase().includes(q) || p.order_id.includes(q))) return false;
      if (filtro === "lucro" && p.lucro <= 0) return false;
      if (filtro === "prejuizo" && p.lucro >= 0) return false;
      if (filtro === "semcad" && p.vinculado) return false;
      return true;
    });
  }, [pedidos, busca, filtro]);

  /**
   * Consolida por produto os pedidos que estão no filtro atual.
   * Usa os ITENS (não o pedido inteiro): um pedido com 2 produtos precisa
   * somar cada um na sua linha. 'vendas' conta o pedido uma vez por produto —
   * 3 unidades num pedido só = 1 venda, 3 unidades.
   */
  const porProduto = useMemo(() => {
    const map = new Map<string, {
      produto: string; mlb: string; vendas: Set<string>; qtd: number;
      valor: number; retorno: number; custos: number; lucro: number; semCadastro: boolean;
    }>();
    for (const p of filtrados) {
      // Pedido antigo (sem detalhe por item): entra como uma linha só.
      const itens: ItemPedido[] = p.itens?.length
        ? p.itens
        : [{ produto: p.produto || "—", mlb: "", qtd: p.qtd, valor: p.valor, retorno: p.retorno,
             cmv: p.cmv, envio: p.envio, taxaML: p.taxaML, imposto: p.imposto, lucro: p.lucro,
             vinculado: p.vinculado }];
      for (const it of itens) {
        const chave = it.mlb || it.produto || "—";
        const cur = map.get(chave) ?? {
          produto: it.produto || "—", mlb: it.mlb, vendas: new Set<string>(), qtd: 0,
          valor: 0, retorno: 0, custos: 0, lucro: 0, semCadastro: false,
        };
        cur.vendas.add(p.order_id);
        cur.qtd += it.qtd;
        cur.valor += it.valor;
        cur.retorno += it.retorno;
        cur.custos += it.cmv + it.envio + it.taxaML + it.imposto;
        cur.lucro += it.lucro;
        if (!it.vinculado) cur.semCadastro = true;
        map.set(chave, cur);
      }
    }
    return Array.from(map.values())
      .map((r) => ({ ...r, nVendas: r.vendas.size, margem: r.valor > 0 ? (r.lucro / r.valor) * 100 : 0 }))
      .sort((a, b) => b.qtd - a.qtd);
  }, [filtrados]);

  const prejuizoN = pedidos.filter((p) => p.lucro < 0).length;
  const semCadN = pedidos.filter((p) => !p.vinculado).length;

  const totalLucro = filtrados.reduce((s, p) => s + p.lucro, 0);
  const totalValor = filtrados.reduce((s, p) => s + p.valor, 0);
  const totalRetorno = filtrados.reduce((s, p) => s + p.retorno, 0);
  const margemMedia = filtrados.length
    ? filtrados.reduce((s, p) => s + p.margem, 0) / filtrados.length
    : 0;
  const margemTag = (m: number) => (m >= 20 ? "tag-g" : m >= 10 ? "tag-y" : "tag-r");

  return (
    <div className="dash">
      {/* Topo */}
      <div className="dash-top">
        <div className="dash-top-left">
          <h2 style={{ fontSize: "1.15rem", fontWeight: 800 }}>Pedidos</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={atualizar} disabled={loading}>
            {loading ? "Atualizando..." : "⟳ Atualizar"}
          </button>
        </div>
        <DateRangePicker from={range.from} to={range.to} onApply={(from, to) => setRange({ from, to })} />
      </div>

      {/* Resumo */}
      <div className="kpi-grid">
        <div className="kpi k-acc"><div className="k-lbl">Pedidos</div><div className="k-val">{filtrados.length}</div></div>
        <div className="kpi k-acc"><div className="k-lbl">Faturamento</div><div className="k-val">{fmtBRL(totalValor)}</div><div className="k-sub">bruto</div></div>
        <div className="kpi k-pos"><div className="k-lbl">Retorno</div><div className="k-val" style={{ color: "var(--green)" }}>{fmtBRL(totalRetorno)}</div><div className="k-sub">líquido que volta</div></div>
        <div className={`kpi ${totalLucro >= 0 ? "k-pos" : "k-neg"}`}><div className="k-lbl">Lucro líquido</div><div className="k-val" style={{ color: totalLucro >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(totalLucro)}</div><div className="k-sub">retorno − custos</div></div>
        <div className="kpi k-warn"><div className="k-lbl">Margem média</div><div className="k-val" style={{ color: "var(--yellow)" }}>{margemMedia.toFixed(1)}%</div></div>
        <div className="kpi k-acc"><div className="k-lbl">Ticket médio</div><div className="k-val">{fmtBRL(filtrados.length ? totalValor / filtrados.length : 0)}</div><div className="k-sub">por pedido</div></div>
      </div>

      {/* Busca + filtros */}
      <input
        type="text" placeholder="Buscar por produto ou nº do pedido…" value={busca}
        onChange={(e) => setBusca(e.target.value)}
        style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 14px", color: "var(--text)", fontSize: ".9rem", outline: "none", boxSizing: "border-box" }}
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {([
          ["todos", `Todos (${pedidos.length})`, "var(--accent)"],
          ["lucro", "Lucrativos", "var(--green)"],
          ["prejuizo", `Prejuízo (${prejuizoN})`, "var(--red)"],
          ["semcad", `Sem cadastro (${semCadN})`, "var(--yellow)"],
        ] as const).map(([id, label, cor]) => (
          <button
            key={id} type="button" onClick={() => setFiltro(id)}
            style={{
              fontSize: ".78rem", fontWeight: 600, padding: "5px 12px", borderRadius: 20, cursor: "pointer",
              background: filtro === id ? cor : "var(--surface2)", color: filtro === id ? "#fff" : "var(--muted)",
              border: `1px solid ${filtro === id ? cor : "var(--border)"}`,
            }}
          >{label}</button>
        ))}
      </div>

      {/* Tabela */}
      <div className="panel">
        {/* Alterna entre a lista de pedidos e o consolidado por produto */}
        <div className="seg" style={{ alignSelf: "flex-start", marginBottom: 12 }}>
          <button type="button" className={`seg-btn ${modo === "pedido" ? "active" : ""}`} onClick={() => setModo("pedido")}>
            Por pedido ({filtrados.length})
          </button>
          <button type="button" className={`seg-btn ${modo === "produto" ? "active" : ""}`} onClick={() => setModo("produto")}>
            Por produto ({porProduto.length})
          </button>
        </div>

        <div style={{ fontSize: ".76rem", color: "var(--muted)", marginBottom: 12 }}>
          {modo === "produto"
            ? <><b>Vendas</b> = nº de pedidos · <b>Un</b> = unidades vendidas · um pedido com 3 unidades conta como 1 venda e 3 unidades</>
            : <><b>Retorno</b> = Valor − Taxa ML − Frete · <b>Custos</b> = CMV + Frete + Taxa + Imposto · <b>Lucro</b> = Valor − Custos · <b style={{ color: "var(--text)" }}>clique num pedido</b> para ver a conta completa</>}
        </div>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Carregando pedidos…</div>
        ) : filtrados.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Nenhum pedido no período.</div>
        ) : modo === "produto" ? (
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="tbl-modern">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Produto</th>
                  <th style={{ textAlign: "right" }}>Vendas</th>
                  <th style={{ textAlign: "right" }}>Un</th>
                  <th style={{ textAlign: "right" }}>Faturamento</th>
                  <th style={{ textAlign: "right" }}>Retorno</th>
                  <th style={{ textAlign: "right" }}>Custos</th>
                  <th style={{ textAlign: "right" }}>Lucro líq.</th>
                  <th>Margem</th>
                </tr>
              </thead>
              <tbody>
                {porProduto.map((r) => (
                  <tr key={r.mlb || r.produto} style={{ boxShadow: `inset 3px 0 0 ${r.lucro >= 0 ? "var(--green)" : "var(--red)"}` }}>
                    <td style={{ textAlign: "left", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <span style={{ fontWeight: 600 }} title={r.produto}>{r.produto}</span>
                      {r.semCadastro && <span style={{ marginLeft: 6, fontSize: ".6rem", fontWeight: 700, color: "#f7c948", background: "rgba(247,201,72,.12)", padding: "1px 6px", borderRadius: 5, verticalAlign: "middle" }}>SEM CADASTRO</span>}
                      {r.mlb && <span style={{ display: "block", fontSize: ".66rem", color: "var(--muted)" }}>{r.mlb}</span>}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{r.nVendas}</td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: "var(--accent)", whiteSpace: "nowrap" }}>{r.qtd}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmtBRL(r.valor)}</td>
                    <td style={{ textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{fmtBRL(r.retorno)}</td>
                    <td style={{ textAlign: "right", color: "var(--red)", whiteSpace: "nowrap" }}>−{fmtBRL(r.custos)}</td>
                    <td style={{ textAlign: "right", fontWeight: 800, whiteSpace: "nowrap", color: r.lucro >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(r.lucro)}</td>
                    <td><span className={`tag ${margemTag(r.margem)}`}>{r.margem.toFixed(1)}%</span></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ textAlign: "left", fontWeight: 800 }}>Total · {porProduto.length} produto(s)</td>
                  <td style={{ textAlign: "right", fontWeight: 800 }}>{porProduto.reduce((s, r) => s + r.nVendas, 0)}</td>
                  <td style={{ textAlign: "right", fontWeight: 800, color: "var(--accent)" }}>{porProduto.reduce((s, r) => s + r.qtd, 0)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtBRL(porProduto.reduce((s, r) => s + r.valor, 0))}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtBRL(porProduto.reduce((s, r) => s + r.retorno, 0))}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: "var(--red)" }}>−{fmtBRL(porProduto.reduce((s, r) => s + r.custos, 0))}</td>
                  <td style={{ textAlign: "right", fontWeight: 800, color: totalLucro >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(porProduto.reduce((s, r) => s + r.lucro, 0))}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="tbl-modern">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Data</th>
                  <th style={{ textAlign: "left" }}>Produto</th>
                  <th>Qtd</th>
                  <th style={{ textAlign: "right" }}>Valor</th>
                  <th style={{ textAlign: "right" }}>Retorno</th>
                  <th style={{ textAlign: "right" }}>Custos</th>
                  <th style={{ textAlign: "right" }}>Lucro líq.</th>
                  <th>Margem</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((p) => {
                  const custos = p.cmv + p.envio + p.taxaML + p.imposto;
                  const prej = p.lucro < 0;
                  const aberto = detalhe === p.order_id;
                  return (
                    <Fragment key={p.order_id}>
                      <tr
                        onClick={() => setDetalhe(aberto ? null : p.order_id)}
                        style={{
                          background: aberto ? "var(--surface2)" : prej ? "rgba(239,68,68,.05)" : undefined,
                          boxShadow: `inset 3px 0 0 ${prej ? "var(--red)" : "var(--green)"}`,
                          cursor: "pointer",
                        }}
                      >
                        <td style={{ textAlign: "left", color: "var(--muted)", whiteSpace: "nowrap", fontSize: ".82rem" }}>
                          {p.data.split("-").reverse().join("/")}<span style={{ fontSize: ".68rem", display: "block", opacity: .7 }}>{p.hora}</span>
                        </td>
                        <td style={{ textAlign: "left", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <span style={{ fontWeight: 600 }} title={p.produto}>{p.produto || "—"}</span>
                          {!p.vinculado && <span style={{ marginLeft: 6, fontSize: ".6rem", fontWeight: 700, color: "#f7c948", background: "rgba(247,201,72,.12)", padding: "1px 6px", borderRadius: 5, verticalAlign: "middle" }}>SEM CADASTRO</span>}
                          <span style={{ display: "block", fontSize: ".66rem", color: "var(--muted)" }}>#{p.order_id}</span>
                        </td>
                        <td style={{ color: "var(--muted)" }}>{p.qtd}</td>
                        <td style={{ textAlign: "right", color: "var(--text)", whiteSpace: "nowrap" }}>{fmtBRL(p.valor)}</td>
                        <td style={{ textAlign: "right", color: "var(--text)", fontWeight: 600, whiteSpace: "nowrap" }}>{fmtBRL(p.retorno)}</td>
                        <td style={{ textAlign: "right", color: "var(--red)", whiteSpace: "nowrap" }}>
                          −{fmtBRL(custos)}
                          <span style={{ marginLeft: 5, color: "var(--muted)", fontSize: ".7rem" }}>{aberto ? "▴" : "▾"}</span>
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 800, whiteSpace: "nowrap", color: p.lucro >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(p.lucro)}</td>
                        <td><span className={`tag ${margemTag(p.margem)}`}>{p.margem.toFixed(1)}%</span></td>
                      </tr>
                      {aberto && (
                        <tr>
                          <td colSpan={8} style={{ padding: 0, background: "var(--surface2)" }}>
                            <DetalhePedido pedido={p} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
