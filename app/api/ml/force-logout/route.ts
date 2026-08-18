import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { desconectarML, resolverTenantDaRequisicao } from "@/lib/tenant";

export async function POST(req: Request) {
  const gate = await requireAccess(req, { adminOnly: true });
  if (gate instanceof NextResponse) return gate;

  const tenant = await resolverTenantDaRequisicao(gate);
  if (!tenant) return NextResponse.json({ error: "sem_tenant" }, { status: 403 });

  try {
    // Limpa a conexão do ML deste tenant
    await desconectarML(tenant.tenantId);

    // Cria resposta com cookie de logout
    const response = NextResponse.json({ success: true });
    
    // Define cookie para indicar que está desconectado
    response.cookies.set('ml_session_cleared', 'true', {
      maxAge: 60 * 60 * 24 * 30, // 30 dias
      path: '/'
    });
    
    return response;
  } catch (error: any) {
    return NextResponse.json(
      { error: "force_logout_failed", details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
