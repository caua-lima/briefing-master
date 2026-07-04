"use client";

import { useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { useUserData } from "@/components/useUserData";
import { AccessGuard } from "@/components/tabs/AccessGuard";
import LoginCard from "@/components/LoginCard";
import MetasTab from "@/components/tabs/MetasTab";
import CustosTab from "@/components/tabs/CustosTab";
import EstoqueTab from "@/components/tabs/EstoqueTab";
import AccessControlTab from "@/components/tabs/AccessControlTab";
import Dashboard from "@/components/dashboard/Dashboard";
import { MlAccountStatus } from "@/components/MlAccountStatus";

type Tab = "dashboard" | "metas" | "custos" | "estoque" | "acesso";

const NAV_ITEMS: { id: Tab; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "metas", label: "Metas", icon: "🎯" },
  { id: "custos", label: "Custos", icon: "💸" },
  { id: "estoque", label: "Estoque", icon: "📦" },
  { id: "acesso", label: "Acesso", icon: "🔐" },
];

export default function Page() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          color: "var(--muted)",
          fontSize: ".9rem",
        }}
      >
        ⏳ Carregando…
      </div>
    );
  }

  if (!user) return <LoginCard />;

  return (
    <AccessGuard>
      <AppShell />
    </AccessGuard>
  );
}

function AppShell() {
  const { user, signOut, signInWithAccountSelection } = useAuth();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [swappingAccount, setSwappingAccount] = useState(false);

  const data = useUserData(user?.uid);

  if (!user) return null;

  const dateLabel = new Date().toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });

  async function handleSwapAccount() {
    if (!confirm('Desconectar da conta Google atual e fazer login com outra?\n\nVocê poderá escolher qual conta Google usar.')) return;
    
    setSwappingAccount(true);
    try {
      // Primeiro faz logout da conta atual
      await signOut();
      
      // Depois redireciona para login com seleção de conta
      // Usa um pequeno delay para garantir que o logout foi processado
      setTimeout(async () => {
        try {
          await signInWithAccountSelection();
        } catch (err) {
          console.error('Erro ao fazer login com seleção de conta', err);
          setSwappingAccount(false);
        }
      }, 300);
    } catch (err) {
      console.error('Erro ao trocar conta', err);
      setSwappingAccount(false);
    }
  }

  return (
    <>
      {/* Sidebar overlay on mobile */}
      {sidebarOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.6)",
            zIndex: 40,
          }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          background: "var(--bg)",
        }}
      >
        {/* ── Sidebar ── */}
        <aside
          style={{
            width: 220,
            flexShrink: 0,
            background: "var(--surface)",
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            position: "fixed",
            top: 0,
            left: sidebarOpen ? 0 : -220,
            bottom: 0,
            zIndex: 50,
            transition: "left .22s ease",
          }}
          className="app-sidebar"
        >
          {/* Logo */}
          <div
            style={{
              padding: "20px 20px 16px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                fontWeight: 700,
                fontSize: "1rem",
                background: "linear-gradient(135deg,#4f8ef7,#a78bfa)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              📊 Controle ML
            </div>
            <div style={{ fontSize: ".72rem", color: "var(--muted)", marginTop: 2 }}>
              {dateLabel}
            </div>
          </div>

          {/* Nav items */}
          <nav style={{ flex: 1, padding: "12px 8px", overflowY: "auto" }}>
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTab(item.id);
                  setSidebarOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  padding: "9px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: tab === item.id ? "var(--accent)" : "transparent",
                  color: tab === item.id ? "#fff" : "var(--muted)",
                  fontSize: ".88rem",
                  fontWeight: tab === item.id ? 700 : 500,
                  cursor: "pointer",
                  marginBottom: 2,
                  transition: "background .15s, color .15s",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => {
                  if (tab !== item.id) {
                    (e.currentTarget as HTMLButtonElement).style.background = "var(--surface2)";
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--text)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (tab !== item.id) {
                    (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--muted)";
                  }
                }}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          {/* User / signout */}
          <div
            style={{
              padding: "14px 16px",
              borderTop: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 10,
              }}
            >
              {user.photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.photoURL}
                  alt=""
                  style={{ width: 28, height: 28, borderRadius: "50%" }}
                />
              ) : null}
              <span
                style={{
                  fontSize: ".75rem",
                  color: "var(--muted)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                }}
              >
                {user.displayName || user.email}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-xs"
              onClick={handleSwapAccount}
              disabled={swappingAccount}
              style={{ width: "100%", justifyContent: "center", marginBottom: 6, opacity: swappingAccount ? 0.6 : 1, cursor: swappingAccount ? 'not-allowed' : 'pointer' }}
            >
              {swappingAccount ? '⏳ Trocando...' : '🔄 Trocar conta'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={signOut}
              disabled={swappingAccount}
              style={{ width: "100%", justifyContent: "center", opacity: swappingAccount ? 0.6 : 1, cursor: swappingAccount ? 'not-allowed' : 'pointer' }}
            >
              Sair
            </button>
          </div>
        </aside>

        {/* ── Main content ── */}
        <div
          style={{
            flex: 1,
            marginLeft: 220,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
          }}
          className="app-main"
        >
          {/* Topbar */}
          <header
            style={{
              background: "var(--surface)",
              borderBottom: "1px solid var(--border)",
              padding: "12px 24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              position: "sticky",
              top: 0,
              zIndex: 30,
            }}
          >
            {/* Hamburger for mobile */}
            <button
              type="button"
              className="btn btn-ghost btn-xs sidebar-toggle"
              onClick={() => setSidebarOpen(true)}
              aria-label="Abrir menu"
            >
              ☰
            </button>

            <div style={{ fontWeight: 600, fontSize: ".95rem" }}>
              {NAV_ITEMS.find((n) => n.id === tab)?.icon}{" "}
              {NAV_ITEMS.find((n) => n.id === tab)?.label}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <MlAccountStatus />
        </div>
          </header>

          {/* Tab content */}
          <main style={{ padding: "24px", flex: 1, minWidth: 0 }}>
            {!data.ready ? (
              <div
                style={{
                  textAlign: "center",
                  padding: 48,
                  color: "var(--muted)",
                  fontSize: ".9rem",
                }}
              >
                ⏳ Carregando dados…
              </div>
            ) : (
              <>
                {tab === "dashboard" && <Dashboard data={data} />}
                {tab === "metas" && <MetasTab uid={user.uid} data={data} />}
                {tab === "custos" && <CustosTab uid={user.uid} data={data} />}
                {tab === "estoque" && <EstoqueTab uid={user.uid} data={data} />}
                {tab === "acesso" && (
                  <AccessControlTab uid={user.uid} data={data} />
                )}
              </>
            )}
          </main>
        </div>
      </div>
    </>
  );
}
