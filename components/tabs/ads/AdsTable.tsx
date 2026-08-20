"use client";

import { useMemo, useState } from "react";
import { fmtBRL } from "@/lib/domain/calc";
import { corMargem, corRoas, num, STATUS_META, type LinhaAds, type Modo } from "./ads-types";

type ColunaOrdenavel = "investido" | "lucro" | "roas" | "margem" | "decisao";
type Densidade = "confortavel" | "compacta";

function StatusTag({ l }: { l: LinhaAds }) {
  const m = STATUS_META[l.i.status];
  // Anúncio que rodou em mais de uma campanha no período: o gasto de cada uma
  // aparece separado na "Performance por campanha", mas a linha da tabela é do
  // ANÚNCIO e soma todas — dizer isso evita a leitura de que um dos dois está
  // errado (ver AdItemFull.campanhas em lib/ml/ads.ts).
  const varias = (l.i.campanhas?.length ?? 0) > 1;
  const detalheCampanhas = varias
    ? ` Este anúncio rodou em ${l.i.campanhas.length} campanhas no período: `
      + l.i.campanhas.map((c) => `${c.campaignName || c.campaignId || "sem campanha"} (${fmtBRL(c.cost)})`).join(", ")
      + ". O investimento desta linha é a soma das duas; a lista por campanha mostra cada uma separada."
    : "";

  const tooltip = l.i.status === "config_indisponivel"
    ? `A campanha ${l.i.campaignId} deste anúncio existe e gastou, mas não apareceu na lista de campanhas do Mercado Ads — normalmente porque ela foi EXCLUÍDA ou arquivada depois de ter gasto no período. Por isso orçamento e ROAS alvo ficam vazios. Investimento, cliques e vendas continuam corretos.${detalheCampanhas}`
    : l.i.campaignId
      ? `Campanha: ${l.i.campaignName || l.i.campaignId}${l.i.mlStatus ? ` · catálogo: ${l.i.mlStatus}` : ""}${detalheCampanhas}`
      : `Não achamos a campanha deste anúncio na busca do Mercado Ads.${detalheCampanhas}`;

  return (
    <span title={tooltip} style={{ fontSize: ".62rem", fontWeight: 700, color: m.cor, background: m.bg, padding: "1px 7px", borderRadius: 5, whiteSpace: "nowrap", cursor: "help" }}>
      {m.label}{varias ? " ⧉" : ""}
    </span>
  );
}

/**
 * Mesma escala de lerParticipacao (lib/domain/ads-participacao.ts): quanto
 * maior a fatia que depende de verba, maior o risco se ela parar.
 */
function corParticipacao(pct: number): string {
  if (pct >= 70) return "var(--red)";
  if (pct >= 40) return "var(--warning)";
  return "var(--green)";
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
      <div className="table-wrapper ads-table-scroll" style={{ border: "none" }}>
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
              <th
                style={{ textAlign: "right", position: "sticky", top: 0, background: "var(--surface)" }}
                title="ROAS ideal: o mínimo pra sobrar a sua margem alvo, não só pra empatar. Entre o break-even e este número o anúncio se paga mas não entrega margem."
              >
                ROAS ideal
              </th>
              <th
                style={{ textAlign: "right", position: "sticky", top: 0, background: "var(--surface)" }}
                title="Quanto sobraria se este anúncio atingisse o ROAS ideal, mantendo a receita de hoje. É o teto daquele ROAS — cortar verba costuma derrubar a receita junto, então serve pra comparar anúncios, não pra prometer resultado."
              >
                Lucro no ideal
              </th>
              <th
                style={{ textAlign: "right", position: "sticky", top: 0, background: "var(--surface)" }}
                title="Unidades que o Mercado Ads credita a este anúncio (venda direta do clique). É a mesma coluna 'Vendas atribuídas' do painel do ML."
              >
                Vendas atribuídas
              </th>
              <th
                style={{ textAlign: "right", position: "sticky", top: 0, background: "var(--surface)" }}
                title="Quanto da receita DESTE anúncio o Mercado Ads credita à campanha (clique direto + venda assistida). Alto = a venda deste item depende da verba."
              >
                % via Ads
              </th>
              <th style={{ textAlign: "left", position: "sticky", top: 0, background: "var(--surface)", cursor: "pointer" }} onClick={() => alternarOrdem("decisao", 1)} title="Ordenar por impacto — pior impacto primeiro">
                Decisão{ordem.col === "decisao" ? (ordem.dir === 1 ? " ↓" : " ↑") : ""}
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {linhasOrdenadas.map((l) => (
              <tr key={l.i.itemId} style={{ fontSize: fontRow, cursor: "pointer" }} onClick={() => onAbrirAnuncio(l.i.itemId)}>
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
                {/* ROAS do modo escolhido + o do painel do Mercado Ads.
                    Os dois existem e medem coisas diferentes: o ML divide pela
                    receita atribuída TOTAL (clique direto + venda assistida),
                    e o modo "Publicidade direta" usa só a direta. Sem mostrar
                    os dois, o número daqui parece quebrado — foi exatamente a
                    leitura que gerou "o ROAS está errado" (4,71x aqui contra
                    10,77x no ML, mesmo anúncio, mesmo período). */}
                <td data-label="ROAS" style={{ textAlign: "right", whiteSpace: "nowrap", padding: padCel, color: corRoas(l.r), fontWeight: 700 }}>
                  {l.i.cost > 0 ? `${num(l.r, 2)}x` : "—"}
                  {l.roasMlAds != null && Math.abs(l.roasMlAds - l.r) > 0.01 && (
                    <span
                      style={{ display: "block", fontSize: ".64rem", fontWeight: 400, color: "var(--muted)" }}
                      title={`No painel do Mercado Ads este anúncio aparece com ROAS ${num(l.roasMlAds, 2)}x, porque lá a conta usa a receita atribuída TOTAL (${fmtBRL(l.i.adSales)}: clique direto + venda assistida). Aqui o modo "${pub ? "Publicidade direta" : "Geral"}" usa ${fmtBRL(l.v)}. Os dois estão certos e respondem perguntas diferentes.`}
                    >
                      ML: {num(l.roasMlAds, 2)}x
                    </span>
                  )}
                </td>
                <td data-label="Break-even" style={{ textAlign: "right", whiteSpace: "nowrap", padding: padCel, color: l.abaixoDoBreakEven ? "var(--red)" : "var(--muted)", fontWeight: l.abaixoDoBreakEven ? 700 : 400 }}>
                  {l.breakEven != null ? `${num(l.breakEven, 2)}x` : "—"}{l.abaixoDoBreakEven ? " ⚠" : ""}
                </td>
                {/* Entre break-even e ideal o anúncio se paga mas não entrega
                    margem — é a faixa em que a maioria das campanhas vive sem
                    ninguém notar, por isso ela tem cor própria (atenção), não
                    a mesma do prejuízo. */}
                <td
                  data-label="ROAS ideal"
                  title={l.roasIdeal == null
                    // O motivo é específico por caso (falta venda × produto não
                    // fecha conta × meta inalcançável) e cada um pede uma ação
                    // diferente — ver motivoSemRoasIdeal.
                    ? (l.motivoSemIdeal ?? "Sem ROAS ideal calculável para este anúncio.")
                    : l.abaixoDoIdeal
                      ? "Abaixo do ROAS que entrega a sua margem alvo."
                      : "Acima do ROAS que entrega a sua margem alvo."}
                  style={{
                    textAlign: "right", whiteSpace: "nowrap", padding: padCel,
                    color: l.roasIdeal == null ? "var(--muted)" : l.abaixoDoIdeal ? "var(--warning)" : "var(--green)",
                    fontWeight: l.abaixoDoIdeal ? 700 : 400,
                  }}
                >
                  {l.roasIdeal != null ? `${num(l.roasIdeal, 2)}x` : <span style={{ cursor: "help" }}>— ⓘ</span>}
                </td>
                {/* O ROAS ideal em dinheiro. "62,75x" é abstrato; "+R$ 38" decide. */}
                <td
                  data-label="Lucro no ideal"
                  title={l.lucroNoIdeal == null
                    ? (l.motivoSemIdeal ?? "Sem ROAS ideal calculável — não há lucro alvo pra projetar.")
                    : l.ganhoNoIdeal != null
                      ? `Hoje ${fmtBRL(l.lucroAtual ?? 0)} → ${fmtBRL(l.lucroNoIdeal)} no ROAS ideal (${l.ganhoNoIdeal >= 0 ? "+" : ""}${fmtBRL(l.ganhoNoIdeal)}), mantendo a receita atual.`
                      : "Lucro se o ROAS ideal fosse atingido, mantendo a receita atual."}
                  style={{
                    textAlign: "right", whiteSpace: "nowrap", padding: padCel, fontWeight: 700,
                    color: l.lucroNoIdeal == null ? "var(--muted)" : l.lucroNoIdeal >= 0 ? "var(--green)" : "var(--red)",
                  }}
                >
                  {l.lucroNoIdeal != null ? fmtBRL(l.lucroNoIdeal) : "—"}
                  {l.ganhoNoIdeal != null && l.ganhoNoIdeal > 0 && (
                    <span style={{ display: "block", fontSize: ".64rem", fontWeight: 400, color: "var(--muted)" }}>
                      +{fmtBRL(l.ganhoNoIdeal)} vs hoje
                    </span>
                  )}
                </td>
                {/* Mesma coluna "Vendas atribuídas" do painel do Mercado Ads:
                    unidades creditadas ao clique, não a venda total do item. */}
                <td
                  data-label="Vendas atribuídas"
                  title={`${num(l.i.adUnits)} unidade(s) atribuída(s) pelo Mercado Ads (${fmtBRL(l.i.adSales)}) — é o mesmo número da coluna "Vendas atribuídas" do painel do ML. Dessas, ${num(l.i.directUnits)} vieram de clique direto (${fmtBRL(l.i.directSales)}); o resto é venda assistida.`}
                  style={{ textAlign: "right", whiteSpace: "nowrap", padding: padCel, color: l.i.adUnits > 0 ? "var(--text)" : "var(--muted)", fontWeight: 600 }}
                >
                  {num(l.i.adUnits)}
                  {l.i.adUnits !== l.i.directUnits && (
                    <span style={{ display: "block", fontSize: ".64rem", fontWeight: 400, color: "var(--muted)" }}>
                      {num(l.i.directUnits)} direta(s)
                    </span>
                  )}
                </td>
                {/* pctAds ja era calculado em AdsTab desde sempre, mas nunca
                    chegou a ser exibido — e a pergunta "quanto deste item
                    depende do Ads?", que e exatamente o corte de decisao. */}
                <td
                  data-label="% via Ads"
                  title={l.i.totalSales > 0
                    ? `${fmtBRL(l.i.adSales)} de ${fmtBRL(l.i.totalSales)} vendidos neste anúncio foram creditados à campanha.`
                    : "Sem venda registrada neste anúncio no período."}
                  style={{
                    textAlign: "right", whiteSpace: "nowrap", padding: padCel, fontWeight: 700,
                    color: l.i.totalSales <= 0 ? "var(--muted)" : corParticipacao(l.pctAds),
                  }}
                >
                  {l.i.totalSales > 0 ? `${num(l.pctAds, 0)}%` : "—"}
                </td>
                <td
                  data-label="Decisão"
                  style={{
                    textAlign: "left", color: corDaDecisao(l), fontSize: ".76rem", padding: padCel,
                    width: 280, whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.4,
                  }}
                >
                  {textoDecisao(l)}
                </td>
                <td data-cell="acoes" style={{ textAlign: "right", padding: padCel, whiteSpace: "nowrap" }}>
                  <button
                    type="button" className="btn btn-ghost btn-xs"
                    onClick={(e) => { e.stopPropagation(); onAbrirAnuncio(l.i.itemId); }}
                  >
                    Ver detalhes
                  </button>
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
