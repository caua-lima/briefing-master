// components/MlConnect.tsx
"use client";
import { useMlOrders, MlOrderItem } from "@/hooks/useMlOrders";

interface Props {
  onImport: (items: MlOrderItem[]) => void;
  date?: string;
  connected?: boolean;
}

export function MlConnect({ onImport, date, connected = false }: Props) {
  const { items, loading, error, fetchOrders } = useMlOrders();

  async function handleImport() {
    await fetchOrders(date);
    if (items.length > 0) onImport(items);
  }

  if (!connected) {
    return (
      <a
        href="/api/ml/auth"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-yellow-400 text-black font-semibold hover:bg-yellow-300 transition"
      >
        🛒 Conectar Mercado Livre
      </a>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleImport}
        disabled={loading}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-yellow-400 text-black font-semibold hover:bg-yellow-300 transition disabled:opacity-50"
      >
        {loading ? "⏳ Importando..." : "🛒 Importar vendas ML"}
      </button>
      {error && <span className="text-red-400 text-sm">{error}</span>}
    </div>
  );
}