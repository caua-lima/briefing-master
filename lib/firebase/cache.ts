"use client";

/**
 * Cache compartilhado de leitura do Firestore.
 *
 * POR QUE ISTO EXISTE
 * O app estourava a cota diária de leitura do Firestore (50k no plano Spark)
 * com um banco de poucos megabytes — ~2 mil pedidos no total. O problema
 * nunca foi volume de dado: era o modelo de cobrança. O Firestore cobra por
 * DOCUMENTO LIDO, e `onSnapshot` relê a consulta inteira a cada mudança,
 * multiplicado por cada aba e cada aparelho aberto.
 *
 * O pior caso era abrir o app: AvisoRemessasFull e Dashboard montam
 * watchMovimentos (até 1500 docs) e watchTasks (500) já na aba inicial —
 * ~2 mil leituras antes de o usuário clicar em qualquer coisa. Abrir e
 * fechar o app 25 vezes no dia zerava a cota sozinho.
 *
 * COMO RESOLVE
 * Uma busca ÚNICA por chave, guardada em memória e compartilhada por todos os
 * componentes que pedirem o mesmo dado. Remontar (trocar de aba e voltar,
 * abrir um modal) passa a custar ZERO leitura enquanto o cache estiver
 * quente. Toda escrita invalida a chave correspondente, então o dado nunca
 * fica velho depois de uma ação do próprio usuário.
 *
 * O QUE **NÃO** DEVE USAR ISTO
 * Notificação (o sino) precisa ser tempo real de verdade — é o ponto dela.
 * Continua em onSnapshot.
 *
 * LIMITE CONHECIDO, E ACEITO DE PROPÓSITO
 * Mudança feita por OUTRA pessoa aparece só quando o TTL vence (ou quando
 * alguém força atualização). Para custo, meta, produto e movimentação — que
 * mudam poucas vezes por dia — isso é irrelevante perto de reler 1500
 * documentos a cada abertura de tela.
 */

const TTL_PADRAO = 5 * 60 * 1000;

type Entrada<T> = {
  at: number;
  dados: T | undefined;
  inscritos: Set<(d: T) => void>;
  buscando: Promise<void> | null;
  /** Anexado na primeira inscrição — é como `invalidar` consegue rebuscar. */
  rebuscar: (() => Promise<void>) | null;
};

const cache = new Map<string, Entrada<unknown>>();

function pegar<T>(chave: string): Entrada<T> {
  let e = cache.get(chave) as Entrada<T> | undefined;
  if (!e) {
    e = { at: 0, dados: undefined, inscritos: new Set(), buscando: null, rebuscar: null };
    cache.set(chave, e as Entrada<unknown>);
  }
  return e;
}

/** Invalida uma chave e REBUSCA se alguém ainda estiver ouvindo — é o que faz
 *  a tela atualizar sozinha logo depois de uma escrita, sem esperar o TTL. */
export function invalidar(chave: string): void {
  const e = cache.get(chave);
  if (!e) return;
  e.at = 0;
  if (e.inscritos.size > 0 && e.rebuscar) void e.rebuscar();
}

/**
 * Assina uma consulta com cache. Devolve a função de cancelar, igual ao
 * onSnapshot que substitui — quem chama não muda de forma.
 */
export function assinarComCache<T>(
  chave: string,
  buscar: () => Promise<T>,
  cb: (d: T) => void,
  opts: { ttl?: number; onError?: (msg: string) => void } = {},
): () => void {
  const ttl = opts.ttl ?? TTL_PADRAO;
  const e = pegar<T>(chave);
  e.inscritos.add(cb);

  const rebuscar = async () => {
    // Uma busca por vez por chave: dois componentes montando junto (Dashboard
    // + aba) não podem virar duas leituras da mesma coleção.
    if (e.buscando) return e.buscando;
    e.buscando = (async () => {
      try {
        const dados = await buscar();
        e.dados = dados;
        e.at = Date.now();
        e.inscritos.forEach((f) => f(dados));
      } catch (err) {
        opts.onError?.(err instanceof Error ? err.message : String(err));
      } finally {
        e.buscando = null;
      }
    })();
    return e.buscando;
  };
  e.rebuscar = rebuscar;

  const quente = e.dados !== undefined && Date.now() - e.at < ttl;
  if (quente) {
    // Entrega o que já está em memória sem custo nenhum de leitura.
    cb(e.dados as T);
  } else {
    void rebuscar();
  }

  return () => {
    e.inscritos.delete(cb);
  };
}

/** Limpa tudo — usado no logout, pra não vazar dado de uma conta pra outra. */
export function limparCache(): void {
  cache.clear();
}
