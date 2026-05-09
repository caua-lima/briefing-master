import type { Metadata } from "next";
import { AuthProvider } from "@/lib/firebase/auth-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "Controle de Lucro Diário — Mercado Livre",
  description: "Hub de controle financeiro diário para vendedor do Mercado Livre",
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
