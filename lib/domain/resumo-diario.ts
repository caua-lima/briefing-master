/**
 * Texto do resumo diário de operação — o push das 20h.
 *
 * Puro de propósito: o que o vendedor lê no fim do dia precisa ser testável
 * sem subir servidor nem esperar dar 20h.
 *
 * Regra que vale pra tudo aqui: quando um número não existe, o texto DIZ que
 * não existe em vez de mostrar zero. Um resumo que afirma "lucro R$ 0,00"
 * quando na verdade o gasto de Ads não veio é pior do que não mandar resumo —
 * a pessoa toma decisão em cima de um número inventado.
 */

export type ResumoDiarioInput = {
  faturamento: number;
  pedidos: number;
  /** null = não foi possível calcular (ex.: Ads não retornou). */
  lucro: number | null;
  margem: number | null;
  /** Meta de faturamento do dia, se configurada. */
  metaDiaria: number | null;
  /** Produtos sem estoque suficiente pra hoje. */
  produtosEmRisco: number;
  /** Anúncios cujo ROAS está abaixo do break-even (perdendo dinheiro). */
  anunciosNoPrejuizo: number;
};

export type ResumoDiario = { title: string; body: string };

function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function montarResumoDiario(i: ResumoDiarioInput): ResumoDiario {
  const title = i.pedidos === 0
    ? "Dia sem vendas"
    : `${brl(i.faturamento)} em ${i.pedidos} ${i.pedidos === 1 ? "venda" : "vendas"}`;

  const partes: string[] = [];

  if (i.lucro != null && i.margem != null) {
    partes.push(`lucro ${brl(i.lucro)} (${i.margem.toFixed(1)}%)`);
  } else if (i.pedidos > 0) {
    // Sem lucro calculável, dizer isso — nunca deixar implícito que foi zero.
    partes.push("lucro do dia ainda não calculável");
  }

  if (i.metaDiaria != null && i.metaDiaria > 0) {
    const pct = (i.faturamento / i.metaDiaria) * 100;
    partes.push(
      pct >= 100
        ? `meta do dia batida (${pct.toFixed(0)}%)`
        : `${pct.toFixed(0)}% da meta do dia`,
    );
  }

  // Alertas por último e só quando existem: resumo que sempre traz "0 em
  // risco" ensina a pessoa a ignorar a linha inteira.
  if (i.produtosEmRisco > 0) {
    partes.push(`${i.produtosEmRisco} produto(s) em risco de ruptura`);
  }
  if (i.anunciosNoPrejuizo > 0) {
    partes.push(`${i.anunciosNoPrejuizo} anúncio(s) abaixo do break-even`);
  }

  return {
    title,
    body: partes.length > 0 ? partes.join(" · ") : "Nenhuma movimentação hoje.",
  };
}
