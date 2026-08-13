"use client";

import type { ResultadoCompradores } from "@/lib/domain/repurchase";

function fmtDataBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default function CompradoresPanel({
  compradores, months, periodoInicio, historicoDesde,
}: {
  compradores: ResultadoCompradores;
  months: number;
  periodoInicio: string;
  historicoDesde: string | null;
}) {
  const cor = (t: number) => (t >= 20 ? "var(--green)" : t >= 10 ? "var(--yellow)" : "var(--red)");
  const pctFrequentes = compradores.total > 0 ? (compradores.frequentes / compradores.total) * 100 : 0;
  // Se o pedido mais antigo sincronizado é de DENTRO do período (ou nem existe
  // margem antes dele), não dá pra saber quem já comprava antes — "novos"
  // fica inflado por falta de dado, não porque ninguém recomprou de verdade.
  const historicoIncompleto = historicoDesde != null && historicoDesde >= periodoInicio;

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
          {historicoIncompleto && (
            <div style={{
              marginBottom: 10, padding: "8px 12px", borderRadius: 8, fontSize: ".76rem", lineHeight: 1.5,
              background: "var(--warning-soft)", border: "1px solid rgba(255,138,31,.35)", color: "var(--warning)",
            }}>
              O pedido mais antigo que temos sincronizado é de {historicoDesde ? fmtDataBR(historicoDesde) : "—"},
              já dentro (ou perto) do início do período. Sem pedido de antes pra comparar, ninguém consegue ser
              marcado como &quot;frequente&quot; — a taxa de recompra abaixo está subestimada. Tente uma janela
              menor (3m) ou espere o histórico completo terminar de sincronizar.
            </div>
          )}
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
