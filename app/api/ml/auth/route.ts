// app/api/ml/auth/route.ts
import { getAuthURL } from "@/lib/ml/client";
import { NextResponse } from "next/server";

export async function GET() {
  const url = getAuthURL();
  return NextResponse.redirect(url);
}