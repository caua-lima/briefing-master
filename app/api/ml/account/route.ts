import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getMlAccessToken, getMlConexao, resolverTenantDaRequisicao } from "@/lib/tenant";

export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  const tenant = await resolverTenantDaRequisicao(gate);
  if (!tenant) return NextResponse.json({ error: "sem_tenant" }, { status: 403 });

  const conexao = await getMlConexao(tenant.tenantId);
  if (!conexao?.refresh_token && !conexao?.access_token) {
    return NextResponse.json({ connected: false });
  }

  const access = await getMlAccessToken(tenant.tenantId);
  if (!access) return NextResponse.json({ connected: false });

  const status = { connected: true, user_id: conexao.seller_id ?? null, nickname: conexao.nickname ?? null };

  try {
    const res = await fetch(`https://api.mercadolibre.com/users/me`, {
      headers: { Authorization: `Bearer ${access}` },
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ ...status, user: null });
    return NextResponse.json({ ...status, user: await res.json() });
  } catch {
    return NextResponse.json({ ...status, user: null });
  }
}
