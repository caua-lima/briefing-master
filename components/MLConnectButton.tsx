'use client'

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";

type MlStatus = {
  connected: boolean;
  user_id: string | null;
};

export function MLConnectButton() {
  const [status, setStatus] = useState<MlStatus>({ connected: false, user_id: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    async function loadStatus() {
      try {
        // Verifica se o usuário desconectou intencionalmente
        const isDisconnected = localStorage.getItem('ml_disconnected');
        if (isDisconnected === 'true') {
          setStatus({ connected: false, user_id: null });
          setLoading(false);
          return;
        }

        const res = await authedFetch("/api/ml/status", { cache: "no-store" });
        if (!res.ok) {
          const json = await res.json();
          throw new Error(json?.error || "Não foi possível verificar a conexão ML");
        }

        const json = await res.json();
        if (json.connected) {
          // Se conectado, limpa o flag de desconectado
          localStorage.removeItem('ml_disconnected');
          setStatus({ connected: Boolean(json.connected), user_id: json.user_id ?? null });
        } else {
          setStatus({ connected: false, user_id: null });
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus({ connected: false, user_id: null });
      } finally {
        setLoading(false);
      }
    }

    loadStatus();
  }, []);

  async function handleConnect() {
    setConnecting(true);
    try {
      // 1. Desconecta a conta ML atual (se houver)
      await authedFetch('/api/ml/disconnect', { method: 'POST' });
      
      // 2. Limpa localStorage
      localStorage.setItem('ml_disconnected', 'true');
      
      // 3. Aguarda um pouco e redireciona para login
      setTimeout(() => {
        window.location.href = '/api/ml/auth?login=true';
      }, 300);
    } catch (err) {
      console.error('Erro ao conectar ML', err);
      setConnecting(false);
    }
  }

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
    <button
      type="button"
      onClick={handleConnect}
      disabled={connecting}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: connecting ? "#f5f5f5" : "#ffe600",
        color: "#000",
        fontWeight: 600,
        fontSize: ".78rem",
        padding: "5px 12px",
        borderRadius: 8,
        border: "none",
        whiteSpace: "nowrap",
        cursor: connecting ? 'not-allowed' : 'pointer',
        opacity: connecting ? 0.6 : 1,
      }}
    >
      {connecting ? '⏳ Conectando...' : '🛒 Conectar ML'}
    </button>
  );
}
