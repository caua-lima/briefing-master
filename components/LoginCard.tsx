"use client";

import { useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";

export default function LoginCard() {
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setErr(null);
    try {
      await signIn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha no login";
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>📊</div>
        <h2>Controle de Lucro Diário</h2>
        <p>Faça login com sua conta Google para acessar seus dados.</p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleClick}
          disabled={busy}
          style={{ width: "100%", justifyContent: "center" }}
        >
          {busy ? "Entrando…" : "Entrar com Google"}
        </button>
        {err && (
          <p style={{ color: "var(--red)", fontSize: ".82rem", marginTop: 12 }}>
            {err}
          </p>
        )}
      </div>
    </div>
  );
}
