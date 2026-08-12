"use client";

import type { ResultadoCompradores } from "@/lib/domain/repurchase";

export default function CompradoresPanel({ compradores, months }: { compradores: ResultadoCompradores; months: number }) {
  const cor = (t: number) => (t >= 20 ? "var(--green)" : t >= 10 ? "var(--yellow)" : "var(--red)");
  const pctFrequentes = compradores.total > 0 ? (compradores.frequentes / compradores.total) * 100 : 0;

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 10 }}>
        <span className="panel-title">Detalhe dos compradores</span>
        <span className="panel-sub">últimos {months} {months === 1 ? "mês" : "meses"}</span>
      </div>

      {compradores.total === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: ".85rem" }}>Sem compradores identificados no período.</div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 64, height: 64, borderRadius: "50%",
                background: `conic-gradient(var(--accent) 0% ${pctFrequentes}%, var(--surface2) ${pctFrequentes}% 100%)`,
              }} />
              <div>
                <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>Total de compradores</div>
                <div style={{ fontSize: "1.3rem", fontWeight: 800 }}>{compradores.total}</div>
              </div>
            </div>
            <div>
              <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>Frequentes</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--accent)" }}>{compradores.frequentes}</div>
            </div>
            <div>
              <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>Novos</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{compradores.novos}</div>
            </div>
            <div>
              <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>Taxa de recompra</div>
              <div style={{ fontSize: "1.3rem", fontWeight: 800, color: compradores.taxaRecompra != null ? cor(compradores.taxaRecompra) : "var(--muted)" }}>
                {compradores.taxaRecompra != null ? `${compradores.taxaRecompra.toFixed(1)}%` : "—"}
              </div>
            </div>
          </div>
          <div style={{ fontSize: ".72rem", color: "var(--muted)", lineHeight: 1.5 }}>
            Frequente = já tinha comprado de você ANTES do período. Novo = primeira compra dentro do período.
            Taxa de recompra = frequentes ÷ total de compradores do período — mesmo critério do painel
            &quot;Detalhe dos compradores&quot; do próprio Mercado Livre.
          </div>
        </>
      )}
    </div>
  );
}
