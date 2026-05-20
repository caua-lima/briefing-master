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
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import type {
  AccessEntry,
  ArchivedDay,
  Cost,
  DraftToday,
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

function mergeByKey<T>(shared: T[], legacy: T[], keyOf: (item: T) => string) {
  const merged = new Map<string, T>();
  for (const item of legacy) merged.set(keyOf(item), item);
  for (const item of shared) merged.set(keyOf(item), item);
  return Array.from(merged.values());
}

function getCurrentUserEmail(): string {
  const auth = getAuth();
  const email = auth.currentUser?.email;
  if (!email) throw new Error("User not authenticated");
  return email;
}

// ─── path helpers ─────────────────────────────────────────────
// Shared collections (team data)
function sCol(name: string) {
  const { db } = getFirebase();
  return collection(db, name);
}

function sDoc(name: string, id: string) {
  const { db } = getFirebase();
  return doc(db, name, id);
}

// Legacy: user-specific collections
function uCol(uid: string, name: string) {
  const { db } = getFirebase();
  return collection(db, "usuarios", uid, name);
}

function uDoc(uid: string, ...segs: string[]) {
  const { db } = getFirebase();
  return doc(db, "usuarios", uid, ...segs);
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
export async function saveDraft(uid: string, draft: DraftToday) {
  const email = getCurrentUserEmail();
  const payload = {
    ...draft,
    createdBy: email,
    updatedAt: Date.now(),
  };
  await Promise.all([
    setDoc(sDoc("rascunho", "hoje"), payload),
    setDoc(uDoc(uid, "rascunho", "hoje"), payload),
  ]);
}
export async function clearDraft(uid: string) {
  await Promise.all([
    deleteDoc(sDoc("rascunho", "hoje")),
    deleteDoc(uDoc(uid, "rascunho", "hoje")),
  ]);
}
export function watchDraft(
  uid: string,
  cb: (d: DraftToday | null) => void,
): () => void {
  let shared: DraftToday | null = null;
  let legacy: DraftToday | null = null;
  const emit = () => cb(shared ?? legacy);

  const watchShared = onSnapshot(sDoc("rascunho", "hoje"), (snap) => {
    shared = snap.exists() ? (snap.data() as DraftToday) : null;
    emit();
  });
  const watchLegacy = onSnapshot(uDoc(uid, "rascunho", "hoje"), (snap) => {
    legacy = snap.exists() ? (snap.data() as DraftToday) : null;
    emit();
  });

  return () => {
    watchShared();
    watchLegacy();
  };
}

// ── Archived days ─────────────────────────────────────────────
export async function archiveDay(uid: string, day: ArchivedDay) {
  const email = getCurrentUserEmail();
  const payload = {
    ...day,
    createdBy: email,
  };
  await Promise.all([
    setDoc(sDoc("dias", day.date), payload),
    setDoc(uDoc(uid, "dias", day.date), payload),
  ]);
}
export async function deleteDay(uid: string, date: string) {
  await Promise.all([
    deleteDoc(sDoc("dias", date)),
    deleteDoc(uDoc(uid, "dias", date)),
  ]);
}
export function watchDays(
  uid: string,
  cb: (days: ArchivedDay[]) => void,
): () => void {
  let shared: ArchivedDay[] = [];
  let legacy: ArchivedDay[] = [];
  const emit = () => cb(mergeByKey(legacy, shared, (item) => item.date));

  const watchShared = onSnapshot(
    query(sCol("dias"), orderBy("date", "desc")),
    (snap) => {
      shared = snap.docs.map((d) => d.data() as ArchivedDay);
      emit();
    },
  );
  const watchLegacy = onSnapshot(
    query(uCol(uid, "dias"), orderBy("date", "desc")),
    (snap) => {
      legacy = snap.docs.map((d) => d.data() as ArchivedDay);
      emit();
    },
  );

  return () => {
    watchShared();
    watchLegacy();
  };
}

// ── Goals (legacy single-doc) ─────────────────────────────────
export async function saveGoals(uid: string, g: Goals) {
  await Promise.all([
    setDoc(sDoc("metas", "config"), g),
    setDoc(uDoc(uid, "metas", "config"), g),
  ]);
}
export function watchGoals(
  uid: string,
  cb: (g: Goals | null) => void,
): () => void {
  let shared: Goals | null = null;
  let legacy: Goals | null = null;
  const emit = () => cb(shared ?? legacy);

  const watchShared = onSnapshot(sDoc("metas", "config"), (snap) => {
    shared = snap.exists() ? (snap.data() as Goals) : null;
    emit();
  });
  const watchLegacy = onSnapshot(uDoc(uid, "metas", "config"), (snap) => {
    legacy = snap.exists() ? (snap.data() as Goals) : null;
    emit();
  });

  return () => {
    watchShared();
    watchLegacy();
  };
}

// ── Goal Entries (history) ────────────────────────────────────
export function watchGoalEntries(
  uid: string,
  cb: (entries: GoalEntry[]) => void,
): () => void {
  const q = query(sCol("metasHistorico"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => d.data() as GoalEntry));
  });
}
export async function saveGoalEntry(uid: string, entry: GoalEntry) {
  const email = getCurrentUserEmail();
  const id = entry.id || `goal_${Date.now()}`;
  const payload = sanitizeUndefined({
    ...entry,
    id,
    createdBy: email,
    createdAt: entry.createdAt ?? Date.now(),
  });
  await Promise.all([
    setDoc(sDoc("metasHistorico", id), payload),
    setDoc(uDoc(uid, "metasHistorico", id), payload),
  ]);
}
export async function updateGoalEntry(
  uid: string,
  id: string,
  patch: Partial<GoalEntry>,
) {
  const payload = sanitizeUndefined(patch);
  await Promise.all([
    updateDoc(sDoc("metasHistorico", id), payload),
    updateDoc(uDoc(uid, "metasHistorico", id), payload),
  ]);
}
export async function deleteGoalEntry(uid: string, id: string) {
  await Promise.all([
    deleteDoc(sDoc("metasHistorico", id)),
    deleteDoc(uDoc(uid, "metasHistorico", id)),
  ]);
}

// ── Costs ─────────────────────────────────────────────────────
export function watchCosts(
  uid: string,
  cb: (costs: Cost[]) => void,
): () => void {
  let shared: Cost[] = [];
  let legacy: Cost[] = [];
  const emit = () => cb(mergeByKey(legacy, shared, (item) => item.id));

  const watchShared = onSnapshot(sCol("custos"), (snap) => {
    shared = snap.docs.map((d) => d.data() as Cost);
    emit();
  });
  const watchLegacy = onSnapshot(uCol(uid, "custos"), (snap) => {
    legacy = snap.docs.map((d) => d.data() as Cost);
    emit();
  });

  return () => {
    watchShared();
    watchLegacy();
  };
}
export async function upsertCost(uid: string, cost: Cost) {
  const email = getCurrentUserEmail();
  const payload = {
    ...cost,
    createdBy: email,
  };
  await Promise.all([
    setDoc(sDoc("custos", cost.id), payload),
    setDoc(uDoc(uid, "custos", cost.id), payload),
  ]);
}
export async function deleteCost(uid: string, id: string) {
  await Promise.all([
    deleteDoc(sDoc("custos", id)),
    deleteDoc(uDoc(uid, "custos", id)),
  ]);
}

// ── Products / Stock ──────────────────────────────────────────
export function watchProducts(
  uid: string,
  cb: (ps: Product[]) => void,
): () => void {
  let shared: Product[] = [];
  let legacy: Product[] = [];
  const emit = () => {
    cb(
      mergeByKey(legacy, shared, (item) => item.id).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    );
  };

  const watchShared = onSnapshot(query(sCol("estoque"), orderBy("name", "asc")), (snap) => {
    shared = snap.docs.map((d) => d.data() as Product);
    emit();
  });
  const watchLegacy = onSnapshot(query(uCol(uid, "estoque"), orderBy("name", "asc")), (snap) => {
    legacy = snap.docs.map((d) => d.data() as Product);
    emit();
  });

  return () => {
    watchShared();
    watchLegacy();
  };
}
export async function upsertProduct(uid: string, product: Product) {
  const email = getCurrentUserEmail();
  const payload = {
    ...product,
    createdBy: email,
  };
  await Promise.all([
    setDoc(sDoc("estoque", product.id), payload),
    setDoc(uDoc(uid, "estoque", product.id), payload),
  ]);
}
export async function deleteProduct(uid: string, id: string) {
  await Promise.all([
    deleteDoc(sDoc("estoque", id)),
    deleteDoc(uDoc(uid, "estoque", id)),
  ]);
}

// ── Access Control (global collection) ───────────────────────
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
