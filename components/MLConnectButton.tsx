'use client'

export function MLConnectButton() {
  return (
    <a
      href="/api/ml/auth"
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
  )
}