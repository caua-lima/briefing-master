/**
 * Estoque que está NO Full mas não pode ser vendido.
 *
 * ─── POR QUE ISTO IMPORTA ───────────────────────────────────────────────
 *
 * `available_quantity` — o número que o app sempre mostrou como "Full" — conta
 * só o que está pronto pra vender. Unidade que chegou no centro e ficou retida
 * some do painel inteiro: não aparece como disponível (porque não está) e não
 * aparece como perda (porque ninguém contou). É estoque pago, parado e
 * invisível, e ele só aparece em `/inventories/{id}/stock/fulfillment`.
 *
 * O ML devolve o motivo em códigos crus (`transfer`, `damaged`, ...). Traduzir
 * não é enfeite: cada motivo pede uma AÇÃO diferente — transferência resolve
 * sozinha, avaria vira pedido de reembolso, e "não suportado" significa que
 * aquele item não devia estar no Full.
 */

export type StatusIndisponivel = {
  /** Rótulo em português. */
  label: string;
  /** O que fazer — vazio quando não há ação (o ML resolve sozinho). */
  acao: string;
  /** true quando são unidades provavelmente PERDIDAS (cabe reembolso). */
  perda: boolean;
};

/**
 * Códigos observados na API de Fulfillment do ML. Um código desconhecido NÃO
 * é escondido: cai no fallback e aparece com o nome cru, porque unidade retida
 * por motivo que não sabemos nomear continua sendo unidade retida.
 */
const CATALOGO: Record<string, StatusIndisponivel> = {
  transfer: {
    label: "Em transferência entre centros",
    acao: "Nada a fazer — o ML está movendo e elas voltam a vender no destino.",
    perda: false,
  },
  internal_process: {
    label: "Em processamento interno",
    acao: "Nada a fazer — conferência ou reetiquetagem do próprio centro.",
    perda: false,
  },
  in_review: {
    label: "Em revisão",
    acao: "Acompanhe: o ML está avaliando as unidades e o resultado pode virar avaria.",
    perda: false,
  },
  quality_check: {
    label: "Em controle de qualidade",
    acao: "Acompanhe: pode liberar ou virar avaria.",
    perda: false,
  },
  damaged: {
    label: "Avariado",
    acao: "Peça reembolso ao Mercado Livre — são unidades que você pagou e não vão vender.",
    perda: true,
  },
  lost: {
    label: "Perdido pelo ML",
    acao: "Peça reembolso ao Mercado Livre.",
    perda: true,
  },
  withdrawal: {
    label: "Em retirada",
    acao: "Você pediu de volta — acompanhe a devolução ao seu galpão.",
    perda: false,
  },
  not_supported: {
    label: "Não aceito no Full",
    acao: "Retire do centro: este item não pode ficar no Full e não vai vender parado lá.",
    perda: true,
  },
  expired: {
    label: "Vencido",
    acao: "Retire ou peça descarte — não volta a vender.",
    perda: true,
  },
};

export function traduzirStatusIndisponivel(status: string): StatusIndisponivel {
  const chave = String(status ?? "").trim().toLowerCase();
  return CATALOGO[chave] ?? {
    // Nome cru em vez de "outros": um motivo que não conhecemos ainda precisa
    // ser pesquisável pelo vendedor no Seller Center.
    label: chave ? `Retido (${chave})` : "Retido (motivo não informado)",
    acao: "Motivo não catalogado — confira no Seller Center o detalhe deste item.",
    perda: false,
  };
}

export type LinhaIndisponivel = { status: string; qtd: number };

/**
 * Unidades provavelmente perdidas (avaria, extravio, item não aceito). É o
 * subtotal que vira dinheiro a reclamar — separado do que só está em trânsito,
 * que se resolve sozinho e não deve virar alarme.
 */
export function unidadesComPerda(linhas: LinhaIndisponivel[]): number {
  return linhas.reduce((s, l) => s + (traduzirStatusIndisponivel(l.status).perda ? l.qtd : 0), 0);
}

/** Unidades retidas que voltam a vender sozinhas — trânsito, processo, revisão. */
export function unidadesEmTransito(linhas: LinhaIndisponivel[]): number {
  return linhas.reduce((s, l) => s + (traduzirStatusIndisponivel(l.status).perda ? 0 : l.qtd), 0);
}

/**
 * Valor imobilizado nas unidades retidas, ao custo médio do produto. Sem isso
 * "12 unidades" não diz nada sobre o tamanho do problema — R$ 160 parados diz.
 */
export function valorRetido(qtd: number, custoMedio: number): number {
  return Math.max(qtd, 0) * Math.max(custoMedio, 0);
}
