import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Redirect to the new scores endpoint
  return NextResponse.json({ error: "このエンドポイントは廃止されました。/api/scores/[albumNo] をご利用ください。" }, { status: 410 });
}
