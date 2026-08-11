"use client";

import { useMemo, useState } from "react";
import { fmtBRL } from "@/lib/domain/calc";
import { corMargem, corRoas, num, STATUS_META, type LinhaAds, type Modo } from "./ads-types";

type ColunaOrdenavel = "investido" | "lucro" | "roas" | "margem" | "decisao";
type Densidade = "confortavel" | "compacta";

function StatusTag({ l }: { l: LinhaAds }) {
  const m = STATUS_META[l.i.status];
  const tooltip = l.i.status === "config_indisponivel"
    ? `Este anúncio está na campanha ${l.i.campaignId}, mas o Mercado Ads não devolveu a configuração dela. Orçamento/ROAS alvo ficam vazios por isso — o gasto e as vendas continuam corretos.`
    : l.i.campaignId
      ? `Campanha: ${l.i.campaignName || l.i.campaignId}${l.i.mlStatus ? ` · catálogo: ${l.i.mlStatus}` : ""}`
      : "Não achamos a campanha deste anúncio na busca do Mercado Ads.";
  return (
    <span title={tooltip} style={{ fontSize: ".62rem", fontWeight: 700, color: m.cor, background: m.bg, padding: "1px 7px", borderRadius: 5, whiteSpace: "nowrap", cursor: "help" }}>
      {m.label}
    </span>
  );
}

function corDaDecisao(l: LinhaAds): string {
  if (l.reco.acao === "escalar") return "var(--green)";
  if (l.reco.acao === "pausar" || l.reco.acao === "reduzir") return "var(--red)";
  return "var(--muted)";
}

/**
 * Frase da decisão — texto explicável, não um badge solto (a antiga coluna
 * "Ação" removida de propósito). "Sem conclusão" é o próprio texto do
 * getAdRecommendation quando não há dado/volume suficiente.
 */
function textoDecisao(l: LinhaAds): string {
  if (l.reco.acao === "sem-dados") {
    if (!l.i.diretoDisponivel) return "Sem conclusão: sem venda vinculada no período pra calcular a margem direta.";
    if (l.i.status === "sem_campanha") return "Sem conclusão: campanha não encontrada.";
    return l.reco.label;
  }
  if (l.reco.acao === "escalar") return `Saudável: margem ${num(l.margemAtual ?? 0, 1)}% e ROAS ${num(l.r, 2)}x${l.breakEven != null ? ` acima do equilíbrio (${num(l.breakEven, 2)}x)` : ""}.`;
  if (l.breakEven != null) return `${l.reco.label}: ROAS ${num(l.r, 2)}x ${l.abaixoDoBreakEven ? "abaixo" : "acima"} do break-even de ${num(l.breakEven, 2)}x.`;
  return l.reco.label;
}

export default function AdsTable({
  modo, linhas, onAbrirAnuncio,
}: {
  modo: Modo; linhas: LinhaAds[]; onAbrirAnuncio: (itemId: string) => void;
}) {
  const pub = modo === "pub";
  const [ordem, setOrdem] = useState<{ col: ColunaOrdenavel; dir: 1 | -1 }>({ col: "investido", dir: -1 });
  const [densidade, setDensidade] = useState<Densidade>("confortavel");

  const linhasOrdenadas = useMemo(() => {
    const arr = [...linhas];
    const chave = (l: LinhaAds): number => {
      switch (ordem.col) {
        case "investido": return l.i.cost;
        case "lucro": return l.lucroAtual ?? -Infinity;
        case "roas": return l.r;
        case "margem": return l.margemAtual ?? -Infinity;
        // "impacto negativo primeiro" — usa o próprio lucro (menor = pior) como ordenação de impacto.
        case "decisao": return l.lucroAtual ?? -l.i.cost;
      }
    };
    arr.sort((x, y) => (chave(x) - chave(y)) * ordem.dir);
    return arr;
  }, [linhas, ordem]);

  function alternarOrdem(col: ColunaOrdenavel, direcaoPadrao: 1 | -1) {
    setOrdem((o) => (o.col === col ? { col, dir: (o.dir * -1) as 1 | -1 } : { col, dir: direcaoPadrao }));
  }

  const padCel = densidade === "compacta" ? "4px 8px" : undefined;
  const fontRow = densidade === "compacta" ? ".76rem" : undefined;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
        <div className="seg" style={{ alignSelf: "flex-end" }}>
          <button type="button" className={`seg-btn ${densidade === "confortavel" ? "active" : ""}`} onClick={() => setDensidade("confortavel")}>Confortável</button>
          <button type="button" className={`seg-btn ${densidade === "compacta" ? "active" : ""}`} onClick={() => setDensidade("compacta")}>Compacta</button>
        </div>
      </div>
      <div className="table-wrapper" style={{ border: "none", maxHeight: 620, overflowY: "auto" }}>
        <table className="tbl-modern tbl-cards" style={{ fontVariantNumeric: "tabular-nums" }}>
          <thead>
            <tr>
              <th
                style={{ textAlign: "left", position: "sticky", left: 0, top: 0, background: "var(--surface)", zIndex: 2 }}
              >
                Anúncio
              </th>
              <th style={{ textAlign: "right", position: "sticky", top: 0, background: "var(--surface)" }}>Status</th>
              <th style={{ textAlign: "right", position: "sticky", top: 0, background: "var(--surface)", cursor: "pointer" }} onClick={() => alternarOrdem("investido", -1)} title="Ordenar por investimento">
                Investimento{ordem.col === "investido" ? (ordem.dir === -1 ? " ↓" : " ↑") : ""}
              </th>
              <th style={{ textAlign: "right", position: "sticky", top: 0, background: "var(--surface)" }}>{pub ? "Receita direta" : "Receita"}</th>
              <th style={{ textAlign: "right", position: "sticky", top: 0, background: "var(--surface)", cursor: "pointer" }} onClick={() => alternarOrdem("lucro", -1)} title="Ordenar por lucratividade — maior lucro primeiro">
                Lucro após Ads{ordem.col === "lucro" ? (ordem.dir === -1 ? " ↓" : " ↑") : ""}
              </th>
              <th style={{ textAlign: "right", position: "sticky", top: 0, background: "var(--surface)", cursor: "pointer" }} onClick={() => alternarOrdem("margem", -1)} title="Lucro ÷ receita">
                Margem{ordem.col === "margem" ? (ordem.dir === -1 ? " ↓" : " ↑") : ""}
              </th>
              <th style={{ textAlign: "right", position: "sticky", top: 0, background: "var(--surface)", cursor: "pointer" }} onClick={() => alternarOrdem("roas", -1)} title={pub ? "Vendas diretas ÷ investido" : "Vendas totais ÷ investido"}>
                ROAS{ordem.col === "roas" ? (ordem.dir === -1 ? " ↓" : " ↑") : ""}
              </th>
              <th style={{ textAlign: "right", position: "sticky", top: 0, background: "var(--surface)" }} title="ROAS mínimo pra não perder dinheiro com o ad.">Break-even</th>
              <th style={{ textAlign: "left", position: "sticky", top: 0, background: "var(--surface)", cursor: "pointer" }} onClick={() => alternarOrdem("decisao", 1)} title="Ordenar por impacto — pior impacto primeiro">
                Decisão{ordem.col === "decisao" ? (ordem.dir === 1 ? " ↓" : " ↑") : ""}
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {linhasOrdenadas.map((l) => (
              <tr key={l.i.itemId} style={{ fontSize: fontRow }}>
                <td
                  className="ads-name"
                  style={{ textAlign: "left", fontWeight: 600, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", position: "sticky", left: 0, background: "var(--surface)", padding: padCel }}
                  title={l.i.title || l.i.itemId}
                >
                  {l.i.title || l.i.itemId}
                  <span style={{ display: "block", fontSize: ".66rem", color: "var(--muted)" }}>{l.i.itemId}</span>
                </td>
                <td data-label="Status" style={{ textAlign: "right", padding: padCel }}><StatusTag l={l} /></td>
                <td data-label="Investimento" style={{ textAlign: "right", color: "var(--red)", fontWeight: 600, whiteSpace: "nowrap", padding: padCel }}>{fmtBRL(l.i.cost)}</td>
                <td data-label="Receita" style={{ textAlign: "right", color: "var(--green)", whiteSpace: "nowrap", padding: padCel }}>{fmtBRL(l.v)}</td>
                <td data-label="Lucro após Ads" style={{ textAlign: "right", whiteSpace: "nowrap", padding: padCel, color: l.lucroAtual == null ? "var(--muted)" : l.lucroAtual >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700 }} title={l.lucroAtual == null ? "Sem venda vinculada no período pra calcular — não é prejuízo, é falta de dado." : undefined}>
                  {l.lucroAtual != null ? fmtBRL(l.lucroAtual) : "—"}
                </td>
                <td data-label="Margem" style={{ textAlign: "right", whiteSpace: "nowrap", padding: padCel, color: l.margemAtual != null ? corMargem(l.margemAtual) : "var(--muted)", fontWeight: 700 }}>
                  {l.margemAtual != null ? `${num(l.margemAtual, 1)}%` : "—"}
                </td>
                <td data-label="ROAS" style={{ textAlign: "right", whiteSpace: "nowrap", padding: padCel, color: corRoas(l.r), fontWeight: 700 }}>{l.i.cost > 0 ? `${num(l.r, 2)}x` : "—"}</td>
                <td data-label="Break-even" style={{ textAlign: "right", whiteSpace: "nowrap", padding: padCel, color: l.abaixoDoBreakEven ? "var(--red)" : "var(--muted)", fontWeight: l.abaixoDoBreakEven ? 700 : 400 }}>
                  {l.breakEven != null ? `${num(l.breakEven, 2)}x` : "—"}{l.abaixoDoBreakEven ? " ⚠" : ""}
                </td>
                <td data-label="Decisão" style={{ textAlign: "left", color: corDaDecisao(l), fontSize: ".76rem", maxWidth: 260, padding: padCel }}>
                  {textoDecisao(l)}
                </td>
                <td style={{ textAlign: "right", padding: padCel }}>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => onAbrirAnuncio(l.i.itemId)}>Ver detalhes</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* ACOS/TACOS complementar e demais colunas técnicas (impressões, CTR, CPC, orçamento/dia, ROAS alvo) ficam no drawer de cada anúncio e no painel "Detalhes do período" — evita rolagem horizontal de 15 colunas na visão principal. */}
      <div style={{ marginTop: 8, fontSize: ".7rem", color: "var(--muted)" }}>
        Cor do ROAS/Margem/Break-even segue os mesmos limiares do resto do app. Clique no cabeçalho de uma coluna pra ordenar; clique em qualquer linha ou em &quot;Ver detalhes&quot; pra abrir o anúncio.
      </div>
    </div>
  );
}
