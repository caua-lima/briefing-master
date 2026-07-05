"use client";

import { useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";

export default function LoginCard() {
  const { signIn, signInWithAccountSelection, signInWithEmail } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleGoogle(useAccountSelection: boolean) {
    setBusy(true);
    setErr(null);
    try {
      if (useAccountSelection) await signInWithAccountSelection();
      else await signIn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha no login");
    } finally {
      setBusy(false);
    }
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setErr("Informe e-mail e senha.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await signInWithEmail(email, password);
    } catch {
      setErr("E-mail ou senha inválidos.");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "var(--surface2)", border: "1px solid var(--border)",
    borderRadius: 8, padding: "10px 12px", color: "var(--text)", fontSize: ".9rem", outline: "none",
    marginBottom: 10, boxSizing: "border-box",
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>📊</div>
        <h2>Controle de Lucro ML</h2>
        <p>Entre com e-mail e senha ou com sua conta Google.</p>

        <form onSubmit={handleEmail} style={{ textAlign: "left", marginBottom: 6 }}>
          <input type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} autoComplete="username" />
          <input type="password" placeholder="Senha" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} autoComplete="current-password" />
          <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "14px 0", color: "var(--muted)", fontSize: ".75rem" }}>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          ou
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>

        <button type="button" className="btn btn-ghost" onClick={() => handleGoogle(false)} disabled={busy} style={{ width: "100%", justifyContent: "center", marginBottom: 8 }}>
          {busy ? "Entrando…" : "Entrar com Google"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleGoogle(true)} disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
          🔄 Usar outra conta Google
        </button>

        {err && <p style={{ color: "var(--red)", fontSize: ".82rem", marginTop: 12 }}>{err}</p>}
      </div>
    </div>
  );
}
