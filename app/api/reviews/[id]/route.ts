import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Redirect to the new release-master endpoint
  return NextResponse.json({ error: "このエンドポイントは廃止されました。/api/release-master/[no] をご利用ください。" }, { status: 410 });
}
