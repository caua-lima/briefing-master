"use client";

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import {
  CUSTO_FAIXA_SENTINELA,
  type AccessEntry,
  type AdsAlteracao,
  type AuditAction,
  type AuditEntity,
  type AuditEvent,
  type Cost,
  type CustoFaixa,
  type DraftToday,
  type EstoqueMovimento,
  type GoalEntry,
  type Goals,
  type Product,
  type Task,
} from "@/lib/domain/types";
import type { NotificationEvent } from "@/lib/domain/notifications";
import { getFirebase } from "./client";

function sanitizeUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as T;
}

function getCurrentUserEmail(): string {
  const auth = getAuth();
  const email = auth.currentUser?.email;
  if (!email) throw new Error("User not authenticated");
  return email;
}

// ─── path helpers (apenas coleções globais compartilhadas) ─────
function sCol(name: string) {
  const { db } = getFirebase();
  return collection(db, name);
}

function sDoc(name: string, id: string) {
  const { db } = getFirebase();
  return doc(db, name, id);
}

function aDoc(email: string) {
  const { db } = getFirebase();
  return doc(db, "controleAcesso", email.toLowerCase());
}

function aCol() {
  const { db } = getFirebase();
  return collection(db, "controleAcesso");
}

function accessMetaDoc() {
  const { db } = getFirebase();
  return doc(db, "controleAcessoMeta", "config");
}

// ── Draft (Hoje) ──────────────────────────────────────────────
export function draftRef() {
  return sDoc("rascunho", "hoje");
}

export async function saveDraft(_uid: string, draft: DraftToday) {
  const email = getCurrentUserEmail();
  await setDoc(sDoc("rascunho", "hoje"), {
    ...draft,
    createdBy: email,
    updatedAt: Date.now(),
  });
}

export async function clearDraft(_uid: string) {
  await deleteDoc(sDoc("rascunho", "hoje"));
}

export function watchDraft(
  _uid: string,
  cb: (d: DraftToday | null) => void,
): () => void {
  return onSnapshot(sDoc("rascunho", "hoje"), (snap) => {
    cb(snap.exists() ? (snap.data() as DraftToday) : null);
  });
}

// ── Goals (legacy single-doc) ─────────────────────────────────
export async function saveGoals(_uid: string, g: Goals) {
  await setDoc(sDoc("metas", "config"), g);
}

export function watchGoals(
  _uid: string,
  cb: (g: Goals | null) => void,
): () => void {
  return onSnapshot(sDoc("metas", "config"), (snap) => {
    cb(snap.exists() ? (snap.data() as Goals) : null);
  });
}

// ── Goal Entries (history) ────────────────────────────────────
export function watchGoalEntries(
  _uid: string,
  cb: (entries: GoalEntry[]) => void,
): () => void {
  // limit(60) = 5 anos de metas mensais — nunca deveria ser o gargalo, mas
  // sem teto nenhum um listener global fica mais caro pra sempre conforme o
  // histórico cresce (achado da cota do Firestore estourada: metasHistorico,
  // dias e estoque_movimentos eram os únicos listeners sem limit() no app).
  const q = query(sCol("metasHistorico"), orderBy("createdAt", "desc"), limit(60));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => d.data() as GoalEntry));
  });
}

export async function saveGoalEntry(_uid: string, entry: GoalEntry) {
  const email = getCurrentUserEmail();
  const id = entry.id || `goal_${Date.now()}`;
  const payload = sanitizeUndefined({
    ...entry,
    id,
    createdBy: email,
    createdAt: entry.createdAt ?? Date.now(),
  });
  await setDoc(sDoc("metasHistorico", id), payload);
}

export async function updateGoalEntry(
  _uid: string,
  id: string,
  patch: Partial<GoalEntry>,
) {
  await updateDoc(sDoc("metasHistorico", id), sanitizeUndefined(patch));
}

export async function deleteGoalEntry(_uid: string, id: string) {
  await deleteDoc(sDoc("metasHistorico", id));
}

// ── Costs ─────────────────────────────────────────────────────
export function watchCosts(
  _uid: string,
  cb: (costs: Cost[]) => void,
): () => void {
  return onSnapshot(sCol("custos"), (snap) => {
    cb(snap.docs.map((d) => d.data() as Cost));
  });
}

export async function upsertCost(_uid: string, cost: Cost) {
  const email = getCurrentUserEmail();
  await setDoc(sDoc("custos", cost.id), { ...cost, createdBy: email });
}

export async function deleteCost(_uid: string, id: string) {
  await deleteDoc(sDoc("custos", id));
}

// ── Products / Stock ──────────────────────────────────────────
export function watchProducts(
  _uid: string,
  cb: (ps: Product[]) => void,
): () => void {
  return onSnapshot(
    query(sCol("estoque"), orderBy("name", "asc")),
    (snap) => {
      cb(snap.docs.map((d) => d.data() as Product).sort((a, b) => a.name.localeCompare(b.name)));
    },
  );
}

export async function upsertProduct(_uid: string, product: Product) {
  const email = getCurrentUserEmail();
  await setDoc(sDoc("estoque", product.id), { ...product, createdBy: email });
}

export async function deleteProduct(_uid: string, id: string) {
  await deleteDoc(sDoc("estoque", id));
}

// ── Movimentações de estoque (galpão) ──────────────────────────
const MOV_COL = "estoque_movimentos";

// Guarda o custo médio com 4 casas (o display mostra 2). Assim o CMV não
// acumula erro de centavos em volumes grandes (ex.: 300 un a R$10,3333).
function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/**
 * Recalcula o `qtdLocal` (estoque no galpão) a partir do livro e, se informado,
 * grava também o `custoMedio` já calculado pela entrada (blend contra o estoque
 * atual — feito no cliente, que conhece o estoque do Full) e uma FAIXA de
 * vigência dele (ver custoNaData em lib/domain/types.ts): a entrada nova só
 * vale a partir de `dataMovimento` pra frente. Sem isso, dar entrada em
 * estoque hoje mudava a margem de vendas já feitas há meses — reportado como
 * bug: "+100 unidades" e o custo médio novo retroagia pra vendas passadas.
 */
async function recomputeProduto(productId: string, custoMedio?: number, dataMovimento?: string): Promise<void> {
  const snap = await getDocs(query(sCol(MOV_COL), where("productId", "==", productId)));
  const movs = snap.docs.map((d) => d.data() as EstoqueMovimento);

  let qty = 0; // estoque no galpão (em casa)
  for (const m of movs) {
    const q = Number(m.quantidade) || 0;
    if (m.tipo === "entrada") qty += Math.abs(q);
    else if (m.tipo === "saida_full") qty -= Math.abs(q);
    else if (m.tipo === "saldo_inicial") { /* já está fora do galpão (ex.: Full) */ }
    else qty += q; // ajuste: com sinal
  }

  const patch: Record<string, unknown> = { qtdLocal: qty };
  if (custoMedio != null && Number.isFinite(custoMedio)) {
    const novo = round4(custoMedio);
    patch.custoMedio = novo;

    const prodSnap = await getDoc(sDoc("estoque", productId));
    const prodData = prodSnap.data() as { custoMedio?: number; custo?: string; custoMedioFaixas?: CustoFaixa[] } | undefined;
    const faixas: CustoFaixa[] = Array.isArray(prodData?.custoMedioFaixas) ? [...prodData!.custoMedioFaixas!] : [];
    // Primeira vez que este produto passa por aqui: grava o custo ANTERIOR
    // como faixa retroativa (sentinela bem no passado) antes de acrescentar a
    // faixa nova — sem isso, todo pedido já sincronizado (sem faixa própria)
    // cairia direto no custo novo, o mesmo bug que estamos corrigindo.
    if (faixas.length === 0) {
      const custoAnterior = Number(prodData?.custoMedio ?? prodData?.custo ?? 0) || 0;
      faixas.push({ desde: CUSTO_FAIXA_SENTINELA, custo: custoAnterior });
    }
    const dia = (dataMovimento || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const idx = faixas.findIndex((f) => f.desde === dia);
    if (idx >= 0) faixas[idx] = { desde: dia, custo: novo };
    else faixas.push({ desde: dia, custo: novo });
    patch.custoMedioFaixas = faixas;
  }
  await updateDoc(sDoc("estoque", productId), patch);
}

export function watchMovimentos(
  cb: (movs: EstoqueMovimento[]) => void,
): () => void {
  // limit(1500) generoso de propósito: o cálculo REAL de qtdLocal
  // (recomputeProduto, logo abaixo) usa um getDocs() separado e SEM limite —
  // esse listener só alimenta a exibição de histórico e a checagem de "esta
  // remessa do Full já teve baixa" (RemessasFull), que só olha remessas dos
  // últimos ~25 dias. 1500 movimentos cobre anos de operação com folga; nunca
  // limitar isto era o maior consumidor de leitura do app (uma coleção que só
  // cresce, relida por inteiro toda vez que a aba Estoque abre).
  return onSnapshot(query(sCol(MOV_COL), orderBy("data", "desc"), limit(1500)), (snap) => {
    cb(snap.docs.map((d) => d.data() as EstoqueMovimento));
  });
}

// ── Remessas do Full já resolvidas ─────────────────────────────
const REMESSA_COL = "full_remessas";

/**
 * Marca uma remessa como resolvida sem mexer no estoque. Serve para as que
 * já foram lançadas à mão antes desta tela existir: sem isso, elas ficariam
 * para sempre pedindo uma baixa que geraria contagem dobrada.
 */
export async function ignorarRemessaFull(remessa: string, motivo = "baixa já lançada à mão"): Promise<void> {
  await setDoc(sDoc(REMESSA_COL, remessa), {
    remessa, ignorada: true, motivo,
    createdBy: getCurrentUserEmail(), createdAt: Date.now(),
  });
}

export async function reabrirRemessaFull(remessa: string): Promise<void> {
  await deleteDoc(sDoc(REMESSA_COL, remessa));
}

export function watchRemessasIgnoradas(cb: (ids: Set<string>) => void): () => void {
  return onSnapshot(sCol(REMESSA_COL), (snap) => {
    cb(new Set(snap.docs.map((d) => d.id)));
  });
}

export async function addMovimento(
  mov: Omit<EstoqueMovimento, "createdBy" | "createdAt">,
  custoMedio?: number,
): Promise<void> {
  const email = getCurrentUserEmail();
  await setDoc(
    sDoc(MOV_COL, mov.id),
    sanitizeUndefined({ ...mov, createdBy: email, createdAt: Date.now() }),
  );
  await recomputeProduto(mov.productId, custoMedio, mov.data);
}

export async function deleteMovimento(id: string, productId: string): Promise<void> {
  await deleteDoc(sDoc(MOV_COL, id));
  await recomputeProduto(productId);
}

// ── Financeiro: cofrinho semi-automático ──────────────────────
// Guardado em metas/financeiro_manual. Cofrinho = base + repasses liberados
// (auto do MP) − saídas (manuais) + rendimento (120% CDI). O MP não expõe
// saldo/cofrinho pela API, então a base é informada por você e re-sincronizada.
export type SaidaFin = { id: string; data: string; valor: number; desc?: string };
export type FinanceiroManual = {
  cofrinhoBase: number;   // valor do cofrinho quando você fixou a base
  baseTs: number;         // quando a base foi fixada (ms) — a partir daqui soma o liberado
  saldoConta: number;     // saldo disponível na conta (≈0, manual)
  cdiAnual: number;       // CDI anual em % (ex.: 15) — rende 120% disso
  saidas: SaidaFin[];     // saques/transferências manuais
  updatedAt?: number;
  updatedBy?: string;
};

export function watchFinanceiroManual(cb: (f: FinanceiroManual) => void): () => void {
  return onSnapshot(sDoc("metas", "financeiro_manual"), (snap) => {
    const d = snap.data() ?? {};
    cb({
      cofrinhoBase: Number(d.cofrinhoBase ?? d.cofrinho ?? 0),
      baseTs: Number(d.baseTs ?? 0),
      saldoConta: Number(d.saldoConta ?? 0),
      cdiAnual: Number(d.cdiAnual ?? 0),
      saidas: Array.isArray(d.saidas) ? (d.saidas as SaidaFin[]) : [],
      updatedAt: d.updatedAt,
      updatedBy: d.updatedBy,
    });
  });
}

/** Fixa a base do cofrinho (valor + CDI + saldo). Registra o instante (baseTs). */
export async function saveFinanceiroBase(v: { cofrinhoBase: number; cdiAnual: number; saldoConta: number }): Promise<void> {
  const email = getCurrentUserEmail();
  await setDoc(
    sDoc("metas", "financeiro_manual"),
    // Re-ancorar zera as saídas: a base nova já reflete tudo até agora.
    { cofrinhoBase: v.cofrinhoBase, cdiAnual: v.cdiAnual, saldoConta: v.saldoConta, baseTs: Date.now(), saidas: [], updatedAt: Date.now(), updatedBy: email },
    { merge: true },
  );
}

/** Grava a lista de saídas (saques/transferências). */
export async function saveFinanceiroSaidas(saidas: SaidaFin[]): Promise<void> {
  const email = getCurrentUserEmail();
  await setDoc(
    sDoc("metas", "financeiro_manual"),
    { saidas, updatedAt: Date.now(), updatedBy: email },
    { merge: true },
  );
}

// ── Tarefas (Kanban) ────────────────────────────────────────────
// Coleção compartilhada, sem dono: owner e colaborador leem e escrevem igual
// (ver firestore.rules) — é o que permite um atribuir tarefa pro outro.
const TASK_COL = "tarefas";

export function watchTasks(cb: (tasks: Task[]) => void): () => void {
  // limit(500) — sem teto, essa era a última coleção do time (compartilhada,
  // vista por todo mundo) sem limit() num listener global. Achado ao investigar
  // a cota do Firestore esgotando TODO DIA: watchTasks roda em DOIS lugares ao
  // mesmo tempo sempre que o app está aberto — Dashboard.tsx (pro card de
  // tarefas atrasadas) e TarefasTab.tsx (o Kanban) — cada aba/dispositivo aberto
  // de cada pessoa do time reabre esse listener inteiro a cada mudança em
  // QUALQUER tarefa, de QUALQUER pessoa. Sem teto, o custo só cresce conforme o
  // quadro acumula tarefas concluídas ao longo dos meses.
  const q = query(sCol(TASK_COL), orderBy("createdAt", "desc"), limit(500));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => d.data() as Task));
  });
}

export async function upsertTask(task: Task) {
  const email = getCurrentUserEmail();
  await setDoc(sDoc(TASK_COL, task.id), sanitizeUndefined({
    ...task,
    createdBy: task.createdBy ?? email,
    updatedAt: Date.now(),
  }));
}

export async function deleteTask(id: string) {
  await deleteDoc(sDoc(TASK_COL, id));
}

// ── Central de Atenção: alertas dispensados ────────────────────
// Cada dispensa é por (usuário, chave do alerta) — um doc por par, igual ao
// padrão de pushTokens. Guarda o `valorRef` de quando foi dispensado pra dar
// pra comparar depois: se o número piorou, o alerta volta a aparecer sozinho
// (ver alertShouldReappear em lib/domain/alerts.ts) em vez de ficar escondido
// pra sempre.
const ALERTS_COL = "alertasDispensados";

export type AlertDismissEntry = { chave: string; email: string; valorRef: number; dispensadoEm: number };

function alertDismissDocId(email: string, chave: string): string {
  return `${email.replace(/\//g, "_")}__${chave}`;
}

export function watchDismissedAlerts(email: string, cb: (entries: AlertDismissEntry[]) => void): () => void {
  const q = query(sCol(ALERTS_COL), where("email", "==", email));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => d.data() as AlertDismissEntry));
  });
}

export async function dismissAlert(email: string, chave: string, valorRef: number): Promise<void> {
  await setDoc(sDoc(ALERTS_COL, alertDismissDocId(email, chave)), {
    email, chave, valorRef, dispensadoEm: Date.now(),
  });
}

export async function undismissAlert(email: string, chave: string): Promise<void> {
  await deleteDoc(sDoc(ALERTS_COL, alertDismissDocId(email, chave)));
}

// ── Access Control (global collection) ────────────────────────
export function watchAccessList(
  cb: (entries: AccessEntry[]) => void,
): () => void {
  const q = query(aCol(), orderBy("email", "asc"));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => d.data() as AccessEntry));
  });
}

export async function addAccessEntry(entry: AccessEntry) {
  await setDoc(aDoc(entry.email), sanitizeUndefined({
    ...entry,
    email: entry.email.toLowerCase(),
    addedAt: Date.now(),
  }));
}

export async function bootstrapAccessOwner(entry: AccessEntry) {
  await setDoc(aDoc(entry.email), sanitizeUndefined({
    ...entry,
    email: entry.email.toLowerCase(),
    addedAt: Date.now(),
  }));
  await setDoc(accessMetaDoc(), {
    ownerEmail: entry.email.toLowerCase(),
    createdAt: Date.now(),
  });
}

export async function updateAccessEntry(
  email: string,
  patch: Partial<AccessEntry>,
) {
  await updateDoc(aDoc(email), sanitizeUndefined(patch));
}

export async function removeAccessEntry(email: string) {
  await deleteDoc(aDoc(email));
}

export async function checkAccess(email: string): Promise<AccessEntry | null> {
  const snap = await getDoc(aDoc(email));
  return snap.exists() ? (snap.data() as AccessEntry) : null;
}

/** Acompanha em tempo real o registro de acesso de UM e-mail (ex.: a própria foto de perfil). */
export function watchAccessEntry(
  email: string,
  cb: (entry: AccessEntry | null) => void,
): () => void {
  return onSnapshot(aDoc(email), (snap) => {
    cb(snap.exists() ? (snap.data() as AccessEntry) : null);
  });
}

export async function getAccessBootstrap(): Promise<{ ownerEmail: string } | null> {
  const snap = await getDoc(accessMetaDoc());
  return snap.exists() ? (snap.data() as { ownerEmail: string }) : null;
}

export async function isAccessListEmpty(): Promise<boolean> {
  const snap = await getDocs(query(aCol(), limit(1)));
  return snap.empty;
}

// ── Trilha de auditoria (global collection, append-only) ────────
// Registrada explicitamente pelas telas em ações discretas (clique em
// "Salvar"/"Arquivar"/"Excluir"), nunca pelas funções genéricas de
// upsert/patch acima — evita virar ruído com o auto-save por campo do
// Custos. As regras do Firestore proíbem update/delete: uma vez gravado,
// o evento é permanente.
export async function logAudit(evt: {
  acao: AuditAction;
  entidade: AuditEntity;
  entidadeId: string;
  entidadeLabel: string;
  detalhe?: string;
}): Promise<void> {
  const email = getCurrentUserEmail();
  const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await setDoc(sDoc("auditLog", id), sanitizeUndefined({ ...evt, id, por: email, em: Date.now() }));
}

/**
 * `onError` não é opcional por capricho: sem ele, uma falha de permissão
 * (regra do Firestore ainda não publicada, papel rebaixado) fazia o
 * onSnapshot nunca chamar o callback de sucesso — e a tela ficava em
 * "Carregando…" pra sempre, sem nenhuma pista do que aconteceu. Era esse o
 * "a trilha de auditoria não funciona": ela não estava vazia, estava travada.
 */
export function watchAuditLog(
  cb: (events: AuditEvent[]) => void,
  max = 200,
  onError?: (msg: string) => void,
): () => void {
  const q = query(sCol("auditLog"), orderBy("em", "desc"), limit(max));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as AuditEvent)),
    (err) => onError?.(err instanceof Error ? err.message : String(err)),
  );
}

// ── Central de Notificações (Fase 7) ────────────────────────────
// O evento em si (criação, classificação, delivery de push) é escrito só
// pelo backend (ver lib/notification-events.ts) — aqui é só leitura +
// marcar lido/dispensado, os dois únicos campos que firestore.rules deixa o
// cliente tocar.
export function watchNotificationEvents(cb: (events: NotificationEvent[]) => void, max = 50): () => void {
  // limit(50) de propósito — sem isso o listener ficaria cada vez mais caro
  // conforme o histórico cresce (é o requisito explícito da Fase 7: nunca um
  // listener global sem limite).
  const q = query(sCol("notification_events"), orderBy("createdAt", "desc"), limit(max));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => d.data() as NotificationEvent));
  });
}

export async function markNotificationRead(eventId: string, email: string): Promise<void> {
  await updateDoc(sDoc("notification_events", eventId), { [`readBy.${email}`]: Date.now() }).catch(() => {});
}

export async function markNotificationDismissed(eventId: string, email: string): Promise<void> {
  await updateDoc(sDoc("notification_events", eventId), { [`dismissedBy.${email}`]: Date.now() }).catch(() => {});
}

// ── Preferências de notificação por usuário ──────────────────────
// usuarios/{uid}/preferences/notifications — cada um só lê/escreve a
// própria (ver firestore.rules). uid, não e-mail, porque é assim que o
// backend resolve o destinatário via Admin Auth (ver
// lib/notification-preferences.ts) sem precisar manter um mapa email→uid.
function prefsDoc(uid: string) {
  const { db } = getFirebase();
  return doc(db, "usuarios", uid, "preferences", "notifications");
}

export function watchNotificationPreferences(
  uid: string,
  cb: (prefs: Record<string, unknown> | null) => void,
): () => void {
  return onSnapshot(prefsDoc(uid), (snap) => cb(snap.exists() ? snap.data() : null));
}

export async function saveNotificationPreferences(uid: string, prefs: Record<string, unknown>): Promise<void> {
  await setDoc(prefsDoc(uid), prefs);
}

// ── Últimas alterações de Ads ────────────────────────────────────
// Registro manual (não vem do ML): "alterei o ROAS pra 20x" — serve pra
// saber quando cada campanha foi mexida da última vez. campaignId/productId
// já vêm prontos de quem chama (AdsChangelogPanel), não são recalculados
// aqui — filtrar por produto depois é só uma query direta em productId.
const ADS_LOG_COL = "ads_alteracoes";

export function watchAdsAlteracoes(cb: (entries: AdsAlteracao[]) => void, max = 300): () => void {
  // limit() desde o primeiro commit desta coleção — lição da cota do
  // Firestore estourada (achado: listener sem teto é o jeito mais fácil de
  // zerar as 50k leituras/dia do plano gratuito). 300 cobre bastante
  // histórico sem custo crescente pra sempre.
  const q = query(sCol(ADS_LOG_COL), orderBy("createdAt", "desc"), limit(max));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => d.data() as AdsAlteracao));
  });
}

export async function addAdsAlteracao(entry: Omit<AdsAlteracao, "id" | "createdBy" | "createdAt">): Promise<void> {
  const email = getCurrentUserEmail();
  const id = `adslog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await setDoc(sDoc(ADS_LOG_COL, id), sanitizeUndefined({ ...entry, id, createdBy: email, createdAt: Date.now() }));
}

export async function deleteAdsAlteracao(id: string): Promise<void> {
  await deleteDoc(sDoc(ADS_LOG_COL, id));
}
