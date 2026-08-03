"use client";

import { useRef, useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { uploadProfilePhoto } from "@/lib/firebase/avatar";

/**
 * Avatar da barra lateral com um botão "+" no canto que abre o seletor
 * nativo de arquivo. `accept="image/*"` sem `capture` é de propósito: no
 * celular o navegador oferece Câmera, Galeria E Arquivos; no PC abre o
 * explorador de arquivos direto — cobre os dois pedidos sem precisar de UI
 * própria pra escolher a origem.
 */
export function AvatarUpload({ size = 28 }: { size?: number }) {
  const { user, refreshUserPhoto } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite escolher o mesmo arquivo de novo depois, se precisar
    if (!file || !user?.email) return;

    setUploading(true);
    setError("");
    try {
      const url = await uploadProfilePhoto(user.uid, user.email.toLowerCase(), file);
      refreshUserPhoto(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar a foto.");
    } finally {
      setUploading(false);
    }
  }

  const initials = (user?.displayName || user?.email || "?").trim().charAt(0).toUpperCase();
  const badgeSize = Math.max(14, Math.round(size * 0.5));

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      {user?.photoURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.photoURL}
          alt=""
          style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", display: "block", opacity: uploading ? 0.5 : 1 }}
        />
      ) : (
        <div
          style={{
            width: size, height: size, borderRadius: "50%", background: "var(--surface2)",
            border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: size * 0.42, fontWeight: 700, color: "var(--muted)", opacity: uploading ? 0.5 : 1,
          }}
        >
          {initials}
        </div>
      )}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        title="Trocar foto de perfil"
        aria-label="Trocar foto de perfil"
        style={{
          position: "absolute", bottom: -2, right: -2, width: badgeSize, height: badgeSize, borderRadius: "50%",
          background: "var(--accent)", border: "2px solid var(--surface)", display: "flex", alignItems: "center",
          justifyContent: "center", cursor: uploading ? "wait" : "pointer", padding: 0,
        }}
      >
        {uploading ? (
          <span style={{ width: badgeSize * 0.5, height: badgeSize * 0.5, borderRadius: "50%", border: "2px solid rgba(255,255,255,.4)", borderTopColor: "#fff", animation: "spin .7s linear infinite" }} />
        ) : (
          <svg width={badgeSize * 0.55} height={badgeSize * 0.55} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
        )}
      </button>

      <input ref={inputRef} type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />

      {error && (
        <div style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", marginTop: 6, fontSize: ".64rem", color: "var(--red)", width: 150, textAlign: "center", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 6px", zIndex: 5 }}>
          {error}
        </div>
      )}
    </div>
  );
}
