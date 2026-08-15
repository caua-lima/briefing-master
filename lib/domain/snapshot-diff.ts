/**
 * Comparação entre o snapshot de ontem e o de hoje — é o que transforma
 * "estado atual" em "o que mudou", que é a única forma de avisar sobre coisa
 * que muda sozinha (preço mexido pelo ML, promoção que entrou, anúncio
 * pausado, reputação piorando).
 *
 * Puro: recebe os dois retratos e devolve as mudanças. Nada de Firestore aqui.
 */

export type AnuncioSnapshot = {
  mlb: string;
  titulo?: string;
  /** Preço de venda REAL (já considerando promoção). */
  preco: number;
  emPromocao: boolean;
  status: string;
  disponivel: number;
};

export type ReputacaoSnapshot = {
  nivel: string;
  selo: string | null;
  /** Taxas em fração (0-1), como a API do ML devolve. */
  reclamacoes: number | null;
  atrasoEnvio: number | null;
  cancelamentos: number | null;
};

export type SnapshotDia = {
  dia: string;
  anuncios: AnuncioSnapshot[];
  reputacao: ReputacaoSnapshot | null;
};

export type MudancaAnuncio = {
  mlb: string;
  titulo: string;
  tipo: "preco" | "promocao_entrou" | "promocao_saiu" | "status" | "zerou";
  antes: string;
  depois: string;
  /** Variação percentual do preço — só em `tipo: "preco"`. */
  variacaoPct?: number;
};

export type MudancaReputacao = {
  campo: "nivel" | "selo" | "reclamacoes" | "atrasoEnvio" | "cancelamentos";
  antes: string;
  depois: string;
  piorou: boolean;
};

/**
 * Variação mínima de preço pra virar aviso. Sem isso, arredondamento de
 * centavo (ou reajuste automático de frete embutido) geraria alerta todo dia
 * e a pessoa aprenderia a ignorar — que é o pior resultado possível.
 */
const PRECO_MIN_PCT = 1;

export function compararAnuncios(
  ontem: AnuncioSnapshot[],
  hoje: AnuncioSnapshot[],
): MudancaAnuncio[] {
  const antes = new Map(ontem.map((a) => [a.mlb, a]));
  const mudancas: MudancaAnuncio[] = [];

  for (const atual of hoje) {
    const anterior = antes.get(atual.mlb);
    // Anúncio novo não é "mudança": não havia com o que comparar.
    if (!anterior) continue;
    const titulo = atual.titulo || anterior.titulo || atual.mlb;

    if (anterior.preco > 0 && atual.preco > 0) {
      const variacao = ((atual.preco - anterior.preco) / anterior.preco) * 100;
      if (Math.abs(variacao) >= PRECO_MIN_PCT) {
        mudancas.push({
          mlb: atual.mlb, titulo, tipo: "preco",
          antes: anterior.preco.toFixed(2), depois: atual.preco.toFixed(2),
          variacaoPct: variacao,
        });
      }
    }

    if (!anterior.emPromocao && atual.emPromocao) {
      mudancas.push({ mlb: atual.mlb, titulo, tipo: "promocao_entrou", antes: "sem promoção", depois: "em promoção" });
    } else if (anterior.emPromocao && !atual.emPromocao) {
      mudancas.push({ mlb: atual.mlb, titulo, tipo: "promocao_saiu", antes: "em promoção", depois: "sem promoção" });
    }

    if (anterior.status !== atual.status) {
      mudancas.push({ mlb: atual.mlb, titulo, tipo: "status", antes: anterior.status, depois: atual.status });
    }

    // Só interessa o momento em que ZERA. Continuar zerado no dia seguinte
    // não é notícia nova — viraria o mesmo alerta todo dia.
    if (anterior.disponivel > 0 && atual.disponivel === 0) {
      mudancas.push({ mlb: atual.mlb, titulo, tipo: "zerou", antes: `${anterior.disponivel} un`, depois: "0 un" });
    }
  }

  return mudancas;
}

function pct(v: number | null): string {
  return v == null ? "sem dado" : `${(v * 100).toFixed(2)}%`;
}

export function compararReputacao(
  ontem: ReputacaoSnapshot | null,
  hoje: ReputacaoSnapshot | null,
): MudancaReputacao[] {
  if (!ontem || !hoje) return [];
  const out: MudancaReputacao[] = [];

  if (ontem.nivel !== hoje.nivel) {
    // O nível vem como "5_green", "3_yellow"... o número inicial é a ordem.
    const n = (s: string) => Number(s.split("_")[0]) || 0;
    out.push({ campo: "nivel", antes: ontem.nivel, depois: hoje.nivel, piorou: n(hoje.nivel) < n(ontem.nivel) });
  }

  if ((ontem.selo ?? null) !== (hoje.selo ?? null)) {
    const ordem: Record<string, number> = { silver: 1, gold: 2, platinum: 3 };
    const o = ontem.selo ? ordem[ontem.selo] ?? 0 : 0;
    const h = hoje.selo ? ordem[hoje.selo] ?? 0 : 0;
    out.push({
      campo: "selo",
      antes: ontem.selo ?? "sem selo", depois: hoje.selo ?? "sem selo",
      piorou: h < o,
    });
  }

  // Nestas três, subir é PIORAR — são taxas de problema.
  const taxas: [MudancaReputacao["campo"], number | null, number | null][] = [
    ["reclamacoes", ontem.reclamacoes, hoje.reclamacoes],
    ["atrasoEnvio", ontem.atrasoEnvio, hoje.atrasoEnvio],
    ["cancelamentos", ontem.cancelamentos, hoje.cancelamentos],
  ];
  for (const [campo, a, h] of taxas) {
    if (a == null || h == null) continue;
    // Meio ponto percentual de variação: abaixo disso é oscilação normal do
    // denominador (uma venda a mais move a taxa sem nada ter acontecido).
    if (Math.abs(h - a) < 0.005) continue;
    out.push({ campo, antes: pct(a), depois: pct(h), piorou: h > a });
  }

  return out;
}

/** Só o que PIOROU — é o que vira aviso; melhora não precisa interromper ninguém. */
export function apenasPioras(m: MudancaReputacao[]): MudancaReputacao[] {
  return m.filter((x) => x.piorou);
}
