"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import {
  getPowerSellerLabel,
  getProximoNivelLabel,
  getReputationLevelMeta,
  type SellerReputation,
} from "@/lib/domain/reputation";
import type { ResultadoRecompra } from "@/lib/domain/repurchase";

type RecompraResponse = ResultadoRecompra & { dadosSuficientes: boolean; months: number };

// ── Taxa de recompra ─────────────────────────────────────────────
function TaxaRecompraPanel() {
  const [dados, setDados] = useState<RecompraResponse | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let alive = true;
    authedFetch("/api/ml/recompra?months=12", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => { if (alive) setDados(j); })
      .catch(() => { if (alive) setErro(true); });
    return () => { alive = false; };
  }, []);

  const cor = (t: number) => (t >= 20 ? "var(--green)" : t >= 10 ? "var(--yellow)" : "var(--red)");

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <span className="panel-title">Taxa de recompra</span>
        <span className="panel-sub">últimos 12 meses · % de compradores que voltaram a comprar</span>
      </div>

      {erro ? (
        <div style={{ color: "var(--red)", fontSize: ".82rem" }}>Não consegui calcular a taxa de recompra agora.</div>
      ) : !dados ? (
        <div style={{ color: "var(--muted)", fontSize: ".85rem", padding: "8px 0" }}>Carregando…</div>
      ) : dados.taxaRecompra == null ? (
        <div style={{ color: "var(--muted)", fontSize: ".85rem" }}>Sem pedidos com comprador identificado nos últimos 12 meses.</div>
      ) : (
        <>
          <div style={{ fontSize: "2rem", fontWeight: 800, color: cor(dados.taxaRecompra) }}>
            {dados.taxaRecompra.toFixed(1)}%
          </div>
          <div style={{ fontSize: ".82rem", color: "var(--muted)", marginTop: 4 }}>
            {dados.compradoresRecorrentes} de {dados.compradoresUnicos} compradores únicos fizeram 2+ pedidos
          </div>
          {!dados.dadosSuficientes && (
            <div style={{
              marginTop: 10, padding: "8px 12px", borderRadius: 8, fontSize: ".76rem", lineHeight: 1.5,
              background: "rgba(244,185,66,.1)", border: "1px solid rgba(244,185,66,.35)", color: "#F4B942",
            }}>
              Poucos compradores no período ({dados.compradoresUnicos}) — a taxa ainda oscila muito com cada venda nova. Trate como indicativo, não como número fechado.
            </div>
          )}
          {dados.pedidosSemBuyerId > 0 && (
            <div style={{ marginTop: 8, fontSize: ".7rem", color: "var(--muted)" }}>
              {dados.pedidosSemBuyerId} pedido(s) sem comprador identificado no cadastro — ficaram fora da conta.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Reputação ML ──────────────────────────────────────────────────
function fmtPct01(v: number | undefined): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  return `${(v * 100).toFixed(1)}%`;
}

function ReputacaoPanel({ reputation }: { reputation: SellerReputation | null | undefined }) {
  if (!reputation) {
    return (
      <div className="panel">
        <div className="panel-title" style={{ marginBottom: 6 }}>Reputação no Mercado Livre</div>
        <div style={{ color: "var(--muted)", fontSize: ".85rem" }}>Carregando…</div>
      </div>
    );
  }

  const nivel = getReputationLevelMeta(reputation.level_id);
  const selo = getPowerSellerLabel(reputation.power_seller_status);
  const proximo = getProximoNivelLabel(reputation.power_seller_status);
  const t = reputation.transactions;
  const ratings = t?.ratings;
  const positivas = fmtPct01(ratings?.positive);
  const negativas = fmtPct01(ratings?.negative);
  const neutras = fmtPct01(ratings?.neutral);

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 10 }}>
        <span className="panel-title">Reputação no Mercado Livre</span>
        <span className="panel-sub" style={{ color: nivel.cor }}>{nivel.label}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>Selo atual</div>
          <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>{selo}</div>
          {proximo && <div style={{ fontSize: ".68rem", color: "var(--muted)" }}>próximo degrau: {proximo}</div>}
        </div>
        <div>
          <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>Vendas concluídas / canceladas</div>
          <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>{t?.completed ?? "—"} / {t?.canceled ?? "—"}</div>
        </div>
        {(positivas || negativas || neutras) && (
          <div>
            <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>Avaliações</div>
            <div style={{ fontSize: ".85rem", fontWeight: 700 }}>
              {positivas && <span style={{ color: "var(--green)" }}>{positivas} pos</span>}
              {negativas && <span style={{ color: "var(--red)", marginLeft: 8 }}>{negativas} neg</span>}
              {neutras && <span style={{ color: "var(--muted)", marginLeft: 8 }}>{neutras} neutra</span>}
            </div>
          </div>
        )}
      </div>

      <div style={{ fontSize: ".7rem", color: "var(--muted)", lineHeight: 1.5 }}>
        O Mercado Livre não divulga publicamente os critérios exatos pra subir de selo — por isso mostramos
        só o nível atual e o nome do próximo degrau, sem inventar % de progresso. Percentuais de avaliação
        assumem o formato decimal que a API retorna (0 a 1).
      </div>
    </div>
  );
}

export default function ReputacaoRecompraCard({ reputation }: { reputation: SellerReputation | null | undefined }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
      <TaxaRecompraPanel />
      <ReputacaoPanel reputation={reputation} />
    </div>
  );
}
