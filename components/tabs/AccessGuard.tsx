"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { useAuth } from "@/lib/firebase/auth-context";
import {
  bootstrapAccessOwner,
  checkAccess,
  getAccessBootstrap,
} from "@/lib/firebase/data";
import { licencaValida, type AccessEntry, type LicencaInvalida } from "@/lib/domain/types";

type AccessInfo = { role: AccessEntry["role"]; email: string; isOwner: boolean; canEdit: boolean };
const AccessCtx = createContext<AccessInfo>({ role: "user", email: "", isOwner: false, canEdit: false });
export function useAccess() {
  return useContext(AccessCtx);
}

type AccessResult = {
  email: string;
  granted: boolean;
  entry: AccessEntry | null;
  motivo?: LicencaInvalida; // por que foi bloqueado (quando granted=false)
};

type AccessCache = AccessResult & {
  checkedAt: number;
};

const ACCESS_CACHE_PREFIX = "briefing:access:";
const ACCESS_CACHE_TTL_MS = 10 * 60 * 1000;

function getAccessCacheKey(email: string) {
  return `${ACCESS_CACHE_PREFIX}${email}`;
}

function readCachedAccess(email: string): AccessResult | null {
  if (typeof window === "undefined" || !email) return null;

  try {
    const raw = window.sessionStorage.getItem(getAccessCacheKey(email));
    if (!raw) return null;

    const cached = JSON.parse(raw) as AccessCache;
    if (cached.email !== email) return null;
    if (Date.now() - cached.checkedAt > ACCESS_CACHE_TTL_MS) return null;

    return {
      email: cached.email,
      granted: cached.granted,
      entry: cached.entry,
    };
  } catch {
    return null;
  }
}

function writeCachedAccess(result: AccessResult) {
  if (typeof window === "undefined" || !result.email) return;

  try {
    const cached: AccessCache = {
      ...result,
      checkedAt: Date.now(),
    };
    window.sessionStorage.setItem(
      getAccessCacheKey(result.email),
      JSON.stringify(cached),
    );
  } catch {
    // ignore cache write failures
  }
}

/**
 * Wraps the app — only renders children when the signed-in user
 * has an entry in the accessControl collection.
 *
 * Security note: Firestore rules must also restrict reads/writes to
 * authenticated users whose email exists in /accessControl/{email}.
 * This component is a UX guard only; real security is in Firestore rules.
 */
export function AccessGuard({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const [access, setAccess] = useState<AccessResult | null>(null);

  useEffect(() => {
    if (!user) return;

    const email = user.email?.toLowerCase() ?? "";
    let cancelled = false;

    async function check(u: User, cached: AccessResult | null) {
      try {
        if (!email) {
          if (!cancelled) {
            setAccess((prev) =>
              prev && prev.email === "" ? prev : { email: "", granted: false, entry: null },
            );
          }
          return;
        }

        const bootstrap = await getAccessBootstrap();
        if (cancelled) return;

        if (!bootstrap) {
          const newEntry: AccessEntry = {
            email,
            role: "owner",
            displayName: u.displayName ?? undefined,
            photoURL: u.photoURL ?? undefined,
          };
          await bootstrapAccessOwner(newEntry);
          if (!cancelled) {
            const nextAccess = { email, granted: true, entry: newEntry };
            writeCachedAccess(nextAccess);
            setAccess((prev) =>
              prev && prev.email === email && prev.granted === true ? prev : nextAccess,
            );
          }
          return;
        }

        if (cached?.granted) {
          if (u.displayName || u.photoURL) {
            import("@/lib/firebase/data").then(({ updateAccessEntry }) =>
              updateAccessEntry(email, {
                displayName: u.displayName ?? undefined,
                photoURL: u.photoURL ?? undefined,
              }),
            );
          }
        }

        const found = await checkAccess(email);
        if (cancelled) return;

        if (!cancelled) {
          // Ter registro não basta: a licença precisa estar válida (não
          // suspensa e dentro do prazo). Mesma regra do servidor.
          const lic = licencaValida(found);
          if (found && lic.ok) {
            if (u.displayName || u.photoURL) {
              import("@/lib/firebase/data").then(({ updateAccessEntry }) =>
                updateAccessEntry(email, {
                  displayName: u.displayName ?? undefined,
                  photoURL: u.photoURL ?? undefined,
                }),
              );
            }
            const nextAccess = { email, granted: true, entry: found };
            writeCachedAccess(nextAccess);
            setAccess((prev) =>
              prev && prev.email === email && prev.granted === true && prev.entry === found
                ? prev
                : nextAccess,
            );
          } else {
            const motivo = found && !lic.ok ? lic.motivo : "sem_licenca";
            const nextAccess = { email, granted: false, entry: found, motivo };
            writeCachedAccess(nextAccess);
            setAccess((prev) =>
              prev && prev.email === email && prev.granted === false && prev.motivo === motivo
                ? prev
                : nextAccess,
            );
          }
        }
      } catch {
        if (!cancelled) {
          const nextAccess = { email, granted: false, entry: null };
          writeCachedAccess(nextAccess);
          setAccess((prev) =>
            prev && prev.email === email && prev.granted === false ? prev : nextAccess,
          );
        }
      }
    }

    async function hydrateAndCheck(u: User) {
      const cached = readCachedAccess(email);

      if (!cancelled) {
        setAccess(cached ?? null);
      }

      await check(u, cached);
    }

    void hydrateAndCheck(user);

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) return null; // LoginCard handles unauthenticated state

  const currentEmail = user.email?.toLowerCase() ?? "";
  const isPending = !access || access.email !== currentEmail;

  if (isPending) return <LoadingScreen />;
  if (!access.granted)
    return <DeniedScreen onLogout={signOut} userEmail={user.email ?? ""} motivo={access?.motivo} expiresAt={access?.entry?.expiresAt ?? null} />;

  const role = access.entry?.role ?? "user";
  const isOwner = role === "owner"; // só o owner edita; todo o resto é somente leitura
  return (
    <AccessCtx.Provider value={{ role, email: currentEmail, isOwner, canEdit: isOwner }}>
      {children}
    </AccessCtx.Provider>
  );
}

function LoadingScreen() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        flexDirection: "column",
        gap: 16,
        color: "var(--muted)",
      }}
    >
      <div style={{ fontSize: "2rem", animation: "spin 1s linear infinite" }}>
        
      </div>
      <p style={{ fontSize: ".9rem" }}>Verificando acesso…</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function DeniedScreen({
  onLogout,
  userEmail,
  motivo,
  expiresAt,
}: {
  onLogout: () => void;
  userEmail: string;
  motivo?: LicencaInvalida;
  expiresAt?: number | null;
}) {
  // Vencida e "nunca teve acesso" são situações diferentes: o cliente que
  // pagou e venceu precisa saber que é só renovar.
  const venceuEm = expiresAt ? new Date(expiresAt).toLocaleDateString("pt-BR") : null;
  const titulo =
    motivo === "expirada" ? "Seu acesso expirou" :
    motivo === "suspensa" ? "Acesso suspenso" :
    "Acesso não autorizado";
  const explicacao =
    motivo === "expirada"
      ? <>O acesso da conta <strong style={{ color: "var(--text)" }}>{userEmail}</strong> {venceuEm ? <>venceu em <strong style={{ color: "var(--text)" }}>{venceuEm}</strong></> : "venceu"}.</>
      : motivo === "suspensa"
      ? <>O acesso da conta <strong style={{ color: "var(--text)" }}>{userEmail}</strong> está temporariamente suspenso.</>
      : <>A conta <strong style={{ color: "var(--text)" }}>{userEmail}</strong> não possui permissão para acessar este sistema.</>;
  const acao =
    motivo === "expirada" ? "Fale com o suporte para renovar sua assinatura."
    : motivo === "suspensa" ? "Entre em contato para regularizar."
    : "Entre em contato com o administrador para solicitar acesso.";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "0 16px",
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: "40px 32px",
          maxWidth: 400,
          width: "100%",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "3rem", marginBottom: 16 }}></div>
        <h2
          style={{
            fontSize: "1.2rem",
            fontWeight: 700,
            marginBottom: 8,
            color: "var(--text)",
          }}
        >
          {titulo}
        </h2>
        <p
          style={{
            fontSize: ".88rem",
            color: "var(--muted)",
            lineHeight: 1.6,
            marginBottom: 8,
          }}
        >
          {explicacao}
        </p>
        <p
          style={{
            fontSize: ".82rem",
            color: "var(--muted)",
            marginBottom: 24,
          }}
        >
          {acao}
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onLogout}
          style={{ width: "100%", justifyContent: "center" }}
        >
          Trocar conta / Sair
        </button>
      </div>
    </div>
  );
}