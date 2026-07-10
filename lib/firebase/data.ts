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
import type {
  AccessEntry,
  ArchivedDay,
  Cost,
  DraftToday,
  EstoqueMovimento,
  GoalEntry,
  Goals,
  Product,
} from "@/lib/domain/types";
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

// ── Archived days ─────────────────────────────────────────────
export async function archiveDay(_uid: string, day: ArchivedDay) {
  const email = getCurrentUserEmail();
  await setDoc(sDoc("dias", day.date), { ...day, createdBy: email });
}

export async function deleteDay(_uid: string, date: string) {
  await deleteDoc(sDoc("dias", date));
}

export function watchDays(
  _uid: string,
  cb: (days: ArchivedDay[]) => void,
): () => void {
  return onSnapshot(
    query(sCol("dias"), orderBy("date", "desc")),
    (snap) => {
      cb(snap.docs.map((d) => d.data() as ArchivedDay));
    },
  );
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
  const q = query(sCol("metasHistorico"), orderBy("createdAt", "desc"));
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
 * atual — feito no cliente, que conhece o estoque do Full).
 */
async function recomputeProduto(productId: string, custoMedio?: number): Promise<void> {
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
  if (custoMedio != null && Number.isFinite(custoMedio)) patch.custoMedio = round4(custoMedio);
  await updateDoc(sDoc("estoque", productId), patch);
}

export function watchMovimentos(
  cb: (movs: EstoqueMovimento[]) => void,
): () => void {
  return onSnapshot(query(sCol(MOV_COL), orderBy("data", "desc")), (snap) => {
    cb(snap.docs.map((d) => d.data() as EstoqueMovimento));
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
  await recomputeProduto(mov.productId, custoMedio);
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

export async function getAccessBootstrap(): Promise<{ ownerEmail: string } | null> {
  const snap = await getDoc(accessMetaDoc());
  return snap.exists() ? (snap.data() as { ownerEmail: string }) : null;
}

export async function isAccessListEmpty(): Promise<boolean> {
  const snap = await getDocs(query(aCol(), limit(1)));
  return snap.empty;
}