import type { Metadata, Viewport } from "next";
import { Inter, Sora } from "next/font/google";
import { AuthProvider } from "@/lib/firebase/auth-context";
import "./globals.css";

// Inter pro corpo (menus, tabelas, filtros, botões) — otimizada pra leitura
// rápida em interface e números densos. Sora só nos títulos e KPIs
// principais (faturamento, lucro, pedidos), pra dar presença sem competir
// com o operacional. As duas via next/font: self-hosted, sem layout shift
// de fonte carregando depois (usa CSS var, aplicado em globals.css).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const sora = Sora({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-sora", display: "swap" });

export const metadata: Metadata = {
  title: "ZXP Solutions | Dashboard Mercado Livre",
  description: "ZXP Solutions — Dashboard de controle financeiro e de vendas para vendedor do Mercado Livre",
  applicationName: "ZXP Solutions",
  // manifest.ts na raiz do app já é linkado automaticamente pelo Next — isto
  // aqui é só a parte que o manifest NÃO cobre: o iOS Safari ignora o
  // manifest pra instalação e só reconhece "Adicionar à Tela de Início" via
  // estas meta tags apple-* específicas.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ZXP Solutions",
  },
  // O Next só emite a tag padrão `mobile-web-app-capable` — iOS mais antigo
  // (antes do WebKit adotar o padrão) só reconhece a variante `apple-*`.
  // Mantendo as duas cobre os dois casos.
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#0B1020",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={`${inter.variable} ${sora.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
