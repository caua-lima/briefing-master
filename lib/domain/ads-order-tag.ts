/**
 * Detecta se um PEDIDO veio de publicidade, direto do payload do ML.
 *
 * CONTEXTO, PORQUE ISTO CONTRARIA UMA CONCLUSÃO ANTERIOR
 * Eu havia concluído (a partir da documentação pública) que o Mercado Livre
 * não expõe atribuição por pedido, e por isso a notificação de venda dizia só
 * "produto anunciado". O print da tela de detalhe da venda mostrou o
 * contrário: o ML exibe "Venda por publicidade" no item do pedido. Ou seja, o
 * dado existe — a documentação é que não o descreve.
 *
 * COMO ISTO LIDA COM ISSO SEM CHUTAR
 * Em vez de fixar um caminho de campo adivinhado, varre o payload procurando
 * marcadores conhecidos de publicidade em QUALQUER profundidade, em `tags`,
 * chaves e valores de texto. Se o ML mudar onde coloca a marca (ou usar outro
 * nome), a checagem continua funcionando; e `caminho` devolve ONDE achou, pra
 * dar pra confirmar contra um pedido real e depois estreitar se valer a pena.
 *
 * Conservador de propósito: na dúvida devolve false. Marcar venda orgânica
 * como paga distorce a leitura de dependência de Ads, que é justamente a
 * decisão que esse número existe pra apoiar.
 */

/**
 * Marcadores em minúsculo. `advertising` é o termo que o ML usa em inglês nas
 * tags; os demais cobrem as variações que aparecem em site pt-BR.
 * NÃO inclui "ads" solto de propósito: casaria com palavras como "adsense",
 * "loads" e com qualquer id que contenha essas três letras.
 */
const MARCADORES = [
  "advertising",
  "advertisement",
  "product_ads",
  "product-ads",
  "productads",
  "publicidad",   // es
  "publicidade",  // pt
  "sponsored",
  "patrocinad",   // patrocinado/patrocinada
];

function textoTemMarcador(v: string): boolean {
  const s = v.toLowerCase();
  return MARCADORES.some((m) => s.includes(m));
}

export type DeteccaoAds = { viaAds: boolean; caminho: string | null; marcador: string | null };

/**
 * Varre o objeto do pedido em profundidade. Limite de profundidade e de nós
 * visitados porque o payload de pedido do ML é grande e isto roda dentro do
 * webhook — que não pode ficar lento nem travar por um payload atípico.
 */
export function detectarVendaPorPublicidade(order: unknown): DeteccaoAds {
  const MAX_NOS = 4000;
  const MAX_PROF = 8;
  let visitados = 0;

  type Item = { valor: unknown; caminho: string; prof: number };
  const fila: Item[] = [{ valor: order, caminho: "$", prof: 0 }];

  while (fila.length > 0) {
    const { valor, caminho, prof } = fila.shift() as Item;
    if (visitados++ > MAX_NOS || prof > MAX_PROF) break;
    if (valor == null) continue;

    if (typeof valor === "string") {
      if (textoTemMarcador(valor)) {
        return {
          viaAds: true,
          caminho,
          marcador: MARCADORES.find((m) => valor.toLowerCase().includes(m)) ?? null,
        };
      }
      continue;
    }

    if (Array.isArray(valor)) {
      valor.forEach((v, i) => fila.push({ valor: v, caminho: `${caminho}[${i}]`, prof: prof + 1 }));
      continue;
    }

    if (typeof valor === "object") {
      for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
        // A própria CHAVE pode ser o marcador (ex.: um objeto "advertising").
        // Só conta quando o valor não é vazio/falso, senão um campo presente e
        // desligado marcaria a venda como paga.
        if (textoTemMarcador(k) && v !== false && v !== null && v !== "" && v !== 0) {
          return {
            viaAds: true,
            caminho: `${caminho}.${k}`,
            marcador: MARCADORES.find((m) => k.toLowerCase().includes(m)) ?? null,
          };
        }
        fila.push({ valor: v, caminho: `${caminho}.${k}`, prof: prof + 1 });
      }
    }
  }

  return { viaAds: false, caminho: null, marcador: null };
}
