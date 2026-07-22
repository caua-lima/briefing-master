"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtBRL } from "@/lib/domain/calc";
import { authedFetch } from "@/lib/api/authed-fetch";
import DateRangePicker from "@/components/dashboard/DateRangePicker";

type CustoDre = { nome: string; valor: number; freq: string };

type Metrics = {
  faturamentoBruto: number;
  faturamentoLiquido: number;
  vendasCanceladas: number;
  vendasDevolvidas: number;
  totalRetorno: number;
  totalCMV: number;
  totalAds: number;
  totalEnvio: number;
  totalImposto: number;
  totalTaxasML: number;
  custosOperacionais: number;
  custosDre: number;
  custosDreDetalhe: CustoDre[];
  lucroComCustos: number;
  adsFalhou?: boolean;
  ordersCount: number;
};

function monthRange() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return { from: `${d.getFullYear()}-${mm}-01`, to: `${d.getFullYear()}-${mm}-${String(last).padStart(2, "0")}` };
}

type LinhaProps = {
  rotulo: string;
  valor: number;
  nota?: string;
  /** deducao = sai do resultado; subtotal = linha de fechamento */
  tipo?: "deducao" | "subtotal" | "resultado";
  base?: number;
};

function Linha({ rotulo, valor, nota, tipo, base }: LinhaProps) {
  const ehSub = tipo === "subtotal" || tipo === "resultado";
  const cor = tipo === "resultado"
    ? (valor >= 0 ? "var(--green)" : "var(--red)")
    : tipo === "deducao" ? "var(--red)" : "var(--text)";
  // % sobre a receita: é o que torna a DRE comparável entre meses de tamanhos
  // diferentes — R$ 3 mil de taxa significa coisas distintas em 20k e em 60k.
  const pct = base && base !== 0 ? (valor / base) * 100 : null;

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr auto auto", gap: "0 14px", alignItems: "baseline",
      padding: ehSub ? "10px 0 4px" : "5px 0",
      borderTop: ehSub ? "1px solid var(--border)" : undefined,
      marginTop: ehSub ? 6 : 0,
    }}>
      <div>
        <span style={{
          fontSize: ehSub ? ".88rem" : ".82rem",
          fontWeight: ehSub ? 800 : 400,
          color: ehSub ? "var(--text)" : "var(--muted)",
          textTransform: tipo === "resultado" ? "uppercase" : undefined,
          letterSpacing: tipo === "resultado" ? ".03em" : undefined,
        }}>
          {rotulo}
        </span>
        {nota && <div style={{ fontSize: ".7rem", color: "var(--muted)" }}>{nota}</div>}
      </div>
      <span style={{
        fontSize: ehSub ? ".95rem" : ".85rem", fontWeight: ehSub ? 800 : 600,
        whiteSpace: "nowrap", color: cor, fontVariantNumeric: "tabular-nums",
      }}>
        {tipo === "deducao" ? "−" : ""}{fmtBRL(Math.abs(valor))}
      </span>
      <span style={{
        fontSize: ".72rem", color: "var(--muted)", whiteSpace: "nowrap",
        minWidth: 52, textAlign: "right", fontVariantNumeric: "tabular-nums",
      }}>
        {pct === null ? "" : `${pct.toFixed(1)}%`}
      </span>
    </div>
  );
}

export default function DreTab() {
  const [range, setRange] = useState(() => monthRange());
  const [m, setM] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authedFetch(`/api/ml/metrics?from=${range.from}&to=${range.to}`, { cache: "no-store" });
      setM(r.ok ? await r.json() : null);
    } catch {
      setM(null);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="dash"><div className="panel" style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Carregando DRE…</div></div>;
  }
  if (!m) {
    return <div className="dash"><div className="panel" style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Não consegui carregar os dados do período.</div></div>;
  }

  const receitaBruta = m.faturamentoBruto;
  const canceladas = m.vendasCanceladas + m.vendasDevolvidas;
  const receitaLiquida = m.faturamentoLiquido;
  const receitaOperacional = m.totalRetorno; // já é líquida de taxa e frete
  const lucroBruto = receitaOperacional - m.totalCMV;
  const resultadoOperacional = m.lucroComCustos; // o mesmo do Dashboard
  const resultadoLiquido = resultadoOperacional - m.custosDre;

  const base = receitaLiquida;
  const margem = (v: number) => (base ? (v / base) * 100 : 0);

  return (
    <div className="dash">
      <div className="dash-top">
        <div className="dash-top-left">
          <h2 style={{ fontSize: "1.15rem", fontWeight: 800 }}>DRE</h2>
          <span style={{ fontSize: ".78rem", color: "var(--muted)" }}>
            demonstrativo de resultado · {m.ordersCount} pedido(s)
          </span>
        </div>
        <DateRangePicker from={range.from} to={range.to} onApply={(from, to) => setRange({ from, to })} />
      </div>

      {m.adsFalhou && (
        <div style={{ padding: "10px 14px", background: "rgba(245,158,11,.12)", border: "1px solid rgba(245,158,11,.45)", borderRadius: 8, fontSize: ".82rem", color: "#f7c948" }}>
          O gasto com ADS não veio do Mercado Livre neste período. O resultado abaixo está
          <b> otimista</b> — falta descontar a verba de anúncios.
        </div>
      )}

      <div className="kpi-grid">
        <div className="kpi k-acc">
          <div className="k-lbl">Receita líquida</div>
          <div className="k-val">{fmtBRL(receitaLiquida)}</div>
          <div className="k-sub">sem cancelados e devolvidos</div>
        </div>
        <div className="kpi k-pos">
          <div className="k-lbl">Lucro bruto</div>
          <div className="k-val" style={{ color: "var(--green)" }}>{fmtBRL(lucroBruto)}</div>
          <div className="k-sub">margem de {margem(lucroBruto).toFixed(1)}%</div>
        </div>
        <div className="kpi k-warn">
          <div className="k-lbl">Resultado operacional</div>
          <div className="k-val" style={{ color: resultadoOperacional >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(resultadoOperacional)}</div>
          <div className="k-sub">é o lucro do Dashboard</div>
        </div>
        <div className="kpi k-neg">
          <div className="k-lbl">Resultado líquido</div>
          <div className="k-val" style={{ color: resultadoLiquido >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(resultadoLiquido)}</div>
          <div className="k-sub">margem de {margem(resultadoLiquido).toFixed(1)}%</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head" style={{ marginBottom: 4 }}>
          <span className="panel-title">Demonstrativo</span>
          <span className="panel-sub">% sobre a receita líquida</span>
        </div>

        <Linha rotulo="Receita bruta de vendas" valor={receitaBruta} nota="tudo que entrou, inclusive o que caiu depois" />
        <Linha rotulo="Cancelamentos e devoluções" valor={canceladas} tipo="deducao" base={base} />
        <Linha rotulo="Receita líquida" valor={receitaLiquida} tipo="subtotal" />

        <Linha rotulo="Taxas do Mercado Livre" valor={m.totalTaxasML} tipo="deducao" base={base} />
        <Linha rotulo="Frete" valor={m.totalEnvio} tipo="deducao" base={base} />
        <Linha rotulo="Receita operacional líquida" valor={receitaOperacional} tipo="subtotal" nota="o que o ML de fato te repassa" />

        <Linha rotulo="Custo da mercadoria vendida" valor={m.totalCMV} tipo="deducao" base={base} nota="custo médio × unidades vendidas" />
        <Linha rotulo="Lucro bruto" valor={lucroBruto} tipo="subtotal" />

        <Linha rotulo="Impostos sobre vendas" valor={m.totalImposto} tipo="deducao" base={base} />
        <Linha rotulo="Marketing (ADS)" valor={m.totalAds} tipo="deducao" base={base} />
        <Linha rotulo="Despesas operacionais" valor={m.custosOperacionais} tipo="deducao" base={base} nota="custos da aba Custos que descontam no Dashboard" />
        <Linha rotulo="Resultado operacional" valor={resultadoOperacional} tipo="subtotal" nota="daqui pra cima é exatamente o lucro líquido do Dashboard" />

        <Linha rotulo="Despesas da empresa" valor={m.custosDre} tipo="deducao" base={base} nota="pró-labore, contador, retirada — só aparecem aqui" />
        <Linha rotulo="Resultado líquido" valor={resultadoLiquido} tipo="resultado" base={base} />
      </div>

      <div className="panel">
        <div className="panel-head" style={{ marginBottom: 8 }}>
          <span className="panel-title">Despesas da empresa no período</span>
          <span className="panel-sub">cadastre na aba Custos marcando <b>Só na DRE</b></span>
        </div>
        {m.custosDreDetalhe.length === 0 ? (
          <div style={{ fontSize: ".82rem", color: "var(--muted)", lineHeight: 1.6 }}>
            Nenhuma despesa marcada como <b>Só na DRE</b> neste período. Vá em <b>Custos</b>,
            cadastre o custo e escolha <b>Só na DRE</b> — ele entra aqui sem mexer no lucro
            que aparece no Dashboard.
            <div style={{ marginTop: 6, fontSize: ".78rem" }}>
              Lembre que custo <b>mensal</b> só entra quando o período é um mês inteiro.
            </div>
          </div>
        ) : (
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="tbl-modern">
              <thead><tr>
                <th style={{ textAlign: "left" }}>Despesa</th>
                <th style={{ textAlign: "left" }}>Frequência</th>
                <th style={{ textAlign: "right" }}>No período</th>
                <th style={{ textAlign: "right" }}>% da receita</th>
              </tr></thead>
              <tbody>
                {m.custosDreDetalhe.map((c, i) => (
                  <tr key={`${c.nome}-${i}`}>
                    <td style={{ textAlign: "left", fontWeight: 600 }}>{c.nome}</td>
                    <td style={{ textAlign: "left", color: "var(--muted)", fontSize: ".8rem" }}>{c.freq}</td>
                    <td style={{ textAlign: "right", color: "var(--red)", whiteSpace: "nowrap" }}>−{fmtBRL(c.valor)}</td>
                    <td style={{ textAlign: "right", color: "var(--muted)" }}>{margem(c.valor).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
