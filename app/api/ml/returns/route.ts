import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getMlAccessToken, getSellerId, resolverTenantDaRequisicao, tenantCol } from "@/lib/tenant";

export async function GET(req: Request) {
  const gate = await requireAccess(req, { allowCron: true });
  if (gate instanceof NextResponse) return gate;

  const tenant = await resolverTenantDaRequisicao(gate);
  if (!tenant) return NextResponse.json({ error: "sem_tenant" }, { status: 403 });

  try {
    const token = await getMlAccessToken(tenant.tenantId);

    if (!token) {
      return NextResponse.json(
        { error: "No Mercado Livre token found" },
        { status: 401 }
      );
    }

    const sellerId = await getSellerId(tenant.tenantId).catch(() => null);

    if (!sellerId) {
      return NextResponse.json(
        { error: "seller_id_indisponivel" },
        { status: 500 }
      );
    }

    const response = await fetch(
      `https://api.mercadolibre.com/orders/search?seller=${sellerId}&order.status=cancelled`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: "Failed to fetch returns", details: text },
        { status: 500 }
      );
    }

    const data = await response.json();
    const orders = data.results ?? [];

    const returns = orders.map((order: any) => ({
      id: String(order.id),
      date_created: order.date_created ?? null,
      status: order.status ?? null,
      total_amount: order.total_amount ?? 0,
      currency_id: order.currency_id ?? "BRL",
      buyer: order.buyer ?? null,
      shipping: order.shipping ?? null,
      raw: order,
      updatedAt: new Date().toISOString(),
    }));

    const col = tenantCol(tenant.tenantId, "ml_returns");
    const batch = col.firestore.batch();

    returns.forEach((item: any) => {
      batch.set(col.doc(item.id), item, { merge: true });
    });

    await batch.commit();

    return NextResponse.json({
      success: true,
      count: returns.length,
      data: returns,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: "Unexpected error syncing returns",
        details: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}