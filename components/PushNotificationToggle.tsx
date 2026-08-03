"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { disablePushNotifications, enablePushNotifications, getPushStatus } from "@/lib/firebase/push";

/** Botão de sino na barra superior pra ligar/desligar notificação de venda neste dispositivo. */
export function PushNotificationToggle() {
  const { user } = useAuth();
  const [status, setStatus] = useState<"unsupported" | "off" | "on" | "denied" | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getPushStatus().then(setStatus);
  }, []);

  async function toggle() {
    if (!user?.email || busy) return;
    setBusy(true);
    setError("");
    try {
      if (status === "on") {
        await disablePushNotifications(user.email.toLowerCase());
        setStatus("off");
      } else {
        const res = await enablePushNotifications(user.email.toLowerCase());
        if (res.ok) {
          setStatus("on");
        } else {
          setError(res.error);
          setStatus(await getPushStatus());
        }
      }
    } finally {
      setBusy(false);
    }
  }

  if (status === "unsupported" || status === "loading") return null;

  // Ícone e texto separados: no celular o CSS esconde só o texto (.push-label)
  // e sobra o sino, que já comunica o estado sem estourar a barra do topo.
  const icone = status === "denied" ? "🔕" : "🔔";
  const texto = status === "on" ? "Notificações ativas" : status === "denied" ? "Bloqueado" : "Ativar notificações";
  const title = status === "denied"
    ? "Notificações bloqueadas nas configurações do navegador/site — libere lá antes de tentar de novo."
    : status === "on"
      ? "Você recebe uma notificação neste dispositivo a cada venda nova. Clique pra desativar."
      : "Ativa notificação neste dispositivo toda vez que sair uma venda nova.";

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className="btn btn-ghost btn-xs"
        onClick={toggle}
        disabled={busy || status === "denied"}
        title={title}
        aria-label={texto}
      >
        {busy ? "…" : (
          <>
            <span aria-hidden style={{ color: status === "on" ? "var(--brand)" : undefined }}>{icone}</span>
            <span className="push-label">{texto}</span>
          </>
        )}
      </button>
      {error && (
        <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 6, fontSize: ".68rem", color: "var(--red)", width: 220, textAlign: "right", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", zIndex: 20 }}>
          {error}
        </div>
      )}
    </div>
  );
}
