import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getStatusML } from "@/lib/ml/tenant";

/** Situação da conexão do ML DESTE usuário. */
export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  return NextResponse.json(await getStatusML(gate.uid));
}
