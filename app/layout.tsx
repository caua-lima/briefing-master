import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/lib/firebase/auth-context";
import "./globals.css";

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
  themeColor: "#0f1117",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
