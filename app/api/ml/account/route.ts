import { NextResponse } from "next/server";
import { getMlTokenStatus, getMlAccessToken } from "../token";

export async function GET() {
  const status = await getMlTokenStatus();
  if (!status.connected) return NextResponse.json(status);

  const access = await getMlAccessToken();
  if (!access) return NextResponse.json({ connected: false });

  try {
    const res = await fetch(`https://api.mercadolibre.com/users/${status.user_id}`, {
      headers: { Authorization: `Bearer ${access}` },
      cache: "no-store",
    });

    if (!res.ok) return NextResponse.json({ ...status, user: null });

    const user = await res.json();
    return NextResponse.json({ ...status, user });
  } catch (err) {
    return NextResponse.json({ ...status, user: null });
  }
}
