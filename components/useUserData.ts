"use client";

import { useEffect, useState } from "react";
import {
  watchCosts,
  watchDays,
  watchDraft,
  watchGoalEntries,
  watchGoals,
  watchProducts,
} from "@/lib/firebase/data";
import type {
  ArchivedDay,
  Cost,
  DraftToday,
  GoalEntry,
  Goals,
  Product,
} from "@/lib/domain/types";

export type UserData = {
  draft: DraftToday | null;
  days: ArchivedDay[];
  goals: Goals | null;
  goalEntries: GoalEntry[];
  costs: Cost[];
  products: Product[];
  ready: boolean;
};

export function useUserData(uid: string | undefined): UserData {
  const [draft, setDraft] = useState<DraftToday | null>(null);
  const [days, setDays] = useState<ArchivedDay[]>([]);
  const [goals, setGoals] = useState<Goals | null>(null);
  const [goalEntries, setGoalEntries] = useState<GoalEntry[]>([]);
  const [costs, setCosts] = useState<Cost[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!uid) {
      setDraft(null);
      setDays([]);
      setGoals(null);
      setGoalEntries([]);
      setCosts([]);
      setProducts([]);
      setReady(false);
      return;
    }

    let loaded = 0;
    const TOTAL = 6;
    const markReady = () => {
      loaded += 1;
      if (loaded >= TOTAL) setReady(true);
    };

    let f1 = true, f2 = true, f3 = true, f4 = true, f5 = true, f6 = true;

    const u1 = watchDraft(uid, (d) => {
      setDraft(d);
      if (f1) { f1 = false; markReady(); }
    });
    const u2 = watchDays(uid, (ds) => {
      setDays(ds);
      if (f2) { f2 = false; markReady(); }
    });
    const u3 = watchGoals(uid, (g) => {
      setGoals(g);
      if (f3) { f3 = false; markReady(); }
    });
    const u4 = watchCosts(uid, (c) => {
      setCosts(c);
      if (f4) { f4 = false; markReady(); }
    });
    const u5 = watchProducts(uid, (ps) => {
      setProducts(ps);
      if (f5) { f5 = false; markReady(); }
    });
    const u6 = watchGoalEntries(uid, (es) => {
      setGoalEntries(es);
      if (f6) { f6 = false; markReady(); }
    });

    return () => { u1(); u2(); u3(); u4(); u5(); u6(); };
  }, [uid]);

  return { draft, days, goals, goalEntries, costs, products, ready };
}
