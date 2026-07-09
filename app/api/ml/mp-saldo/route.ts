import { NextResponse } from "next/server";
import { getMlAccessToken, getMlTokenData } from "../token";
import { requireAccess } from "@/lib/api-auth";

const MP_API = "https://api.mercadopago.com";

async function getUserId(): Promise<string | null> {
  if (process.env.ML_SELLER_ID) return process.env.ML_SELLER_ID;
  const data = await getMlTokenData();
  return data?.user_id ? String(data.user_id) : null;
}

/** Saldo da conta Mercado Pago (disponível + a receber), igual ao app do MP. */
export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  try {
    // Prefere a credencial de PRODUÇÃO do Mercado Pago (MP_ACCESS_TOKEN); se não
    // houver, cai pro token do ML (que normalmente não tem acesso ao saldo).
    const mpToken = process.env.MP_ACCESS_TOKEN;
    const token = mpToken || (await getMlAccessToken());
    const via = mpToken ? "mp" : "ml";
    if (!token) return NextResponse.json({ ok: false, error: "no_token" });

    const userId = await getUserId();
    if (!userId) return NextResponse.json({ ok: false, error: "no_user" });

    const res = await fetch(`${MP_API}/users/${userId}/mercadopago_account/balance`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
      // Surface do status pra diagnosticar permissão (401/403 = token sem acesso ao MP).
      const details = (await res.text()).slice(0, 300);
      return NextResponse.json({ ok: false, error: "mp_balance_failed", status: res.status, via, details });
    }

    const j = (await res.json()) as {
      available_balance?: number;
      unavailable_balance?: number;
      total_amount?: number;
    };

    return NextResponse.json({
      ok: true,
      via,
      disponivel: Number(j.available_balance ?? 0),
      aReceber: Number(j.unavailable_balance ?? 0),
      total: Number(j.total_amount ?? (Number(j.available_balance ?? 0) + Number(j.unavailable_balance ?? 0))),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: "unexpected", details: msg });
  }
}
