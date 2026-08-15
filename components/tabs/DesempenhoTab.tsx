"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import ReputacaoPanel from "./desempenho/ReputacaoPanel";
import RequisitosMercadoLiderPanel from "./desempenho/RequisitosMercadoLiderPanel";
import CompradoresPanel from "./desempenho/CompradoresPanel";
import HeatmapVendas from "./desempenho/HeatmapVendas";
import EntregasPanel from "./desempenho/EntregasPanel";
import type { DesempenhoResponse } from "./desempenho/desempenho-types";

const OPCOES_MESES = [3, 6, 12, 24];
/**
 * Janelas curtas, em dias. Existem pra dar pra CONFERIR o numero contra o
 * painel "Detalhe dos compradores" do proprio Mercado Livre, que trabalha em
 * periodos curtos — sem isso nao havia como saber se a nossa taxa bate com a
 * deles. 7 dias e o padrao que o ML abre.
 */
const OPCOES_DIAS = [7, 15, 30];

export default function DesempenhoTab() {
  const [months, setMonths] = useState(12);
  // null = periodo em meses; numero = periodo em dias (tem prioridade).
  const [dias, setDias] = useState<number | null>(7);
  const [dados, setDados] = useState<DesempenhoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const carregar = useCallback(async (fresh = false) => {
    if (fresh) setRefreshing(true); else setLoading(true);
    setErro(false);
    try {
      const q = dias != null ? `dias=${dias}` : `months=${months}`;
      const r = await authedFetch(`/api/ml/desempenho?${q}${fresh ? "&fresh=1" : ""}`, { cache: "no-store" });
      if (!r.ok) { setErro(true); return; }
      const j = await r.json();
      setDados(j);
    } catch {
      setErro(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [months, dias]);

  // Falso positivo comprovado (mesmo padrão do resto do app): fetch no
  // mount/troca de período — carregar() faz setState de forma assíncrona,
  // não o corpo do efeito em si.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { carregar(); }, [carregar]);

  return (
    <div className="dash">
      <div className="tab-head">
        <div className="tab-head-left">
          <h2 className="tab-title">Desempenho</h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="seg">
            {OPCOES_DIAS.map((d) => (
              <button key={`d${d}`} type="button" className={`seg-btn ${dias === d ? "active" : ""}`} onClick={() => setDias(d)}>
                {d}d
              </button>
            ))}
            {/* Inclui a janela recomendada pelo painel de compradores quando ela
                não é uma das opções fixas — senão o botão trocaria o período e
                nenhum item ficaria marcado como ativo. */}
            {Array.from(new Set([...OPCOES_MESES, months])).sort((a, b) => a - b).map((m) => (
              <button key={m} type="button" className={`seg-btn ${dias == null && months === m ? "active" : ""}`} onClick={() => { setDias(null); setMonths(m); }}>
                {m}m
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => carregar(true)} disabled={refreshing}>
            {refreshing ? "Atualizando…" : "⟳ Atualizar"}
          </button>
        </div>
      </div>
      <div style={{ fontSize: ".8rem", color: "var(--muted)", marginTop: -6 }}>
        Reputação/selo Mercado Líder, taxa de recompra, concentração de vendas por dia/horário e entregas no
        prazo — tudo derivado de dados reais (pedidos sincronizados e reputação da API do ML), sem inventar
        número que a gente não tem como confirmar.
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--muted)" }}>Carregando…</div>
      ) : erro || !dados ? (
        <div style={{ padding: 20, color: "var(--red)", fontSize: ".85rem" }}>
          Não consegui carregar os dados de desempenho agora. Tente atualizar.
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
            <ReputacaoPanel reputation={dados.reputacao} indisponivel={dados.reputacaoIndisponivel} />
            <RequisitosMercadoLiderPanel
              requisitos={dados.requisitosMercadoLider}
              registrationDate={dados.registrationDate}
              vendasConcluidas={dados.reputacao?.transactions?.completed}
              jaEhLider={!!dados.reputacao?.power_seller_status}
            />
            <CompradoresPanel
              compradores={dados.compradores}
              months={dados.months}
              periodoInicio={dados.from}
              historicoDesde={dados.historicoDesde}
              to={dados.to}
              dias={dados.dias}
              semComprador={dados.semComprador}
              onUsarJanela={(m) => { setDias(null); setMonths(m); }}
            />
          </div>

          <HeatmapVendas heatmap={dados.heatmap} from={dados.from} to={dados.to} />

          <EntregasPanel entregas={dados.entregas} />
        </>
      )}
    </div>
  );
}
