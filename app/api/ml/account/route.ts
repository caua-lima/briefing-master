import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getStatusML, getMlAccessToken } from "@/lib/ml/tenant";

const ML_API = "https://api.mercadolibre.com";

/**
 * Conta do Mercado Livre conectada por ESTE usuário. O nickname/seller_id já
 * são gravados no momento da conexão, então normalmente não bate no ML.
 */
export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  const status = await getStatusML(gate.uid);
  if (!status.connected) return NextResponse.json(status);

  // Já temos o apelido salvo da conexão: responde sem ir ao ML.
  if (status.nickname) {
    return NextResponse.json({
      ...status,
      user: { id: status.seller_id, nickname: status.nickname },
    });
  }

  const access = await getMlAccessToken(gate.uid);
  if (!access) return NextResponse.json({ connected: false });

  try {
    const res = await fetch(`${ML_API}/users/me`, {
      headers: { Authorization: `Bearer ${access}` },
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ ...status, user: null });
    return NextResponse.json({ ...status, user: await res.json() });
  } catch {
    return NextResponse.json({ ...status, user: null });
  }
}
