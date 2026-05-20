'use client'

import { useEffect, useState } from "react";

type MlStatus = {
  connected: boolean;
  user_id: string | null;
};

export function MLConnectButton() {
  const [status, setStatus] = useState<MlStatus>({ connected: false, user_id: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadStatus() {
      try {
        const res = await fetch("/api/ml/status", { cache: "no-store" });
        if (!res.ok) {
          const json = await res.json();
          throw new Error(json?.error || "Não foi possível verificar a conexão ML");
        }

        const json = await res.json();
        setStatus({ connected: Boolean(json.connected), user_id: json.user_id ?? null });
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }

    loadStatus();
  }, []);

  if (loading) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 12px",
          borderRadius: 8,
          background: "#f5f5f5",
          color: "var(--muted)",
          fontSize: ".78rem",
        }}
      >
        ⏳ Verificando ML...
      </span>
    );
  }

  if (status.connected) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 12px",
          borderRadius: 8,
          background: "#22c55e",
          color: "#fff",
          fontWeight: 600,
          fontSize: ".78rem",
        }}
      >
        ✅ ML conectado
      </span>
    );
  }

  return (
    <a
      href="/api/ml/auth?login=true"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "#ffe600",
        color: "#000",
        fontWeight: 600,
        fontSize: ".78rem",
        padding: "5px 12px",
        borderRadius: 8,
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      🛒 Conectar ML
    </a>
  );
}
