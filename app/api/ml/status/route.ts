import { NextResponse } from "next/server";
import { getMlTokenStatus } from "../token";

export async function GET() {
  const status = await getMlTokenStatus();
  return NextResponse.json(status);
}
