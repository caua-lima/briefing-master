import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";

export async function POST(req: Request) {
  try {
    const db = getAdminDb();
    
    // Limpa todos os dados do ML do Firestore
    await db.collection("ml_tokens").doc("main").set(
      {
        access_token: null,
        refresh_token: null,
        expires_in: null,
        user_id: null,
        user_profile: null,
        updated_at: new Date().toISOString(),
      },
      { merge: true }
    );

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
