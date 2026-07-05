import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminAuth } from "@/lib/firebase/admin";

/**
 * Cria (ou atualiza a senha de) um usuário de login por e-mail/senha.
 * Somente admin. O acesso em si é controlado pela coleção controleAcesso.
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req, { adminOnly: true });
  if (gate instanceof NextResponse) return gate;

  try {
    const body = (await req.json()) as { email?: string; password?: string };
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!email || password.length < 6) {
      return NextResponse.json({ error: "E-mail e senha (mínimo 6 caracteres) são obrigatórios." }, { status: 400 });
    }

    const auth = getAdminAuth();
    try {
      const existing = await auth.getUserByEmail(email);
      await auth.updateUser(existing.uid, { password });
      return NextResponse.json({ ok: true, updated: true });
    } catch {
      await auth.createUser({ email, password, emailVerified: true });
      return NextResponse.json({ ok: true, created: true });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "create_user_failed", details: msg }, { status: 500 });
  }
}
