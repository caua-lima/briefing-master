"use client";

import { useEffect, useState } from "react";
import type { Product } from "@/lib/domain/types";
import { fmtBRL } from "@/lib/domain/calc";
import { getCoverageStatus, COVERAGE_STATUS_LABEL, type CoverageStatus } from "@/lib/domain/estoque";
import { custoMedioDe, mlbsDe, previsaoDe, DIAS_ALVO, type EstoqueML, type Forecast } from "./helpers";

function coberturaFmt(dias: number): { txt: string; cor: string } {
  if (!Number.isFinite(dias)) return { txt: "—", cor: "var(--muted)" };
  const d = Math.round(dias);
  const cor = d <= 7 ? "var(--red)" : d <= 15 ? "var(--yellow)" : "var(--green)";
  return { txt: `${d}d`, cor };
}

const STATUS_COBERTURA_COR: Record<CoverageStatus, string> = {
  critico: "var(--red)", repor: "var(--yellow)", saudavel: "var(--green)",
  encalhado: "#F4B942", "sem-giro": "var(--muted)",
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

export default function PrevisaoPanel({ products, estoqueML, forecast }: { products: Product[]; estoqueML: EstoqueML; forecast: Forecast }) {
  const [planejados, setPlanejados] = useState<Set<string>>(new Set());
  // Falso positivo comprovado (auditoria Fase 9): hidrata do localStorage no
  // mount — localStorage não existe durante SSR, então não dá pra usar como
  // valor inicial do useState direto (quebraria a renderização no servidor).
  // eslint-disable-next-line react-hooks/set-state-in-effect
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
                        <span style={{ display: "block", fontSize: ".66rem", fontWeight: 400, color: "#F4B942" }}>
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
