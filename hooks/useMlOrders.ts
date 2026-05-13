// hooks/useMlOrders.ts
import { useState, useCallback } from "react";

export interface MlOrderItem {
  mlb: string;
  title: string;
  vendas: number;
  faturamento: number;
  retorno: number;
}

export function useMlOrders() {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [items, setItems]     = useState<MlOrderItem[]>([]);

  const fetchOrders = useCallback(async (date?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = date ? `?date=${date}` : "";
      const res = await fetch(`/api/ml/orders${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro desconhecido");
      setItems(json.items ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  return { items, loading, error, fetchOrders };
}