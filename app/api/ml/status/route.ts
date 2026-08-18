import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getMlConexao, resolverTenantDaRequisicao } from "@/lib/tenant";

export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  const tenant = await resolverTenantDaRequisicao(gate);
  if (!tenant) return NextResponse.json({ connected: false, error: "sem_tenant" });

  const conexao = await getMlConexao(tenant.tenantId);
  return NextResponse.json({
    connected: Boolean(conexao?.refresh_token || conexao?.access_token),
    user_id: conexao?.seller_id ?? null,
    nickname: conexao?.nickname ?? null,
  });
}
