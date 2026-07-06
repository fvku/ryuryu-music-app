import { NextRequest, NextResponse } from "next/server";
import { checkAdminPassword } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { adminPassword } = await req.json();
  if (!checkAdminPassword(adminPassword)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  const result: Record<string, unknown> = {
    clientIdSet: !!clientId,
    clientIdLength: clientId?.length ?? 0,
    clientIdPrefix: clientId?.substring(0, 4) ?? "",
    clientSecretSet: !!clientSecret,
    clientSecretLength: clientSecret?.length ?? 0,
    clientSecretPrefix: clientSecret?.substring(0, 4) ?? "",
  };

  // Step 1: try token fetch
  let accessToken: string | null = null;
  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const tokenBody = await tokenRes.json();
    result.tokenStatus = tokenRes.status;
    if (tokenRes.ok) {
      accessToken = tokenBody.access_token;
      result.tokenOk = true;
      result.tokenType = tokenBody.token_type;
      result.expiresIn = tokenBody.expires_in;
      result.accessTokenPrefix = accessToken?.substring(0, 8) ?? "";
    } else {
      result.tokenOk = false;
      result.tokenError = tokenBody;
    }
  } catch (e) {
    result.tokenOk = false;
    result.tokenFetchError = String(e);
  }

  // Step 2: if token obtained, test tracks API with a known album (OK Computer)
  if (accessToken) {
    try {
      const tracksRes = await fetch(
        "https://api.spotify.com/v1/albums/7dQfaalYVDPbPGFtMK0U3B/tracks?market=JP&limit=1",
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const tracksBody = await tracksRes.json();
      result.tracksApiStatus = tracksRes.status;
      result.tracksApiOk = tracksRes.ok;
      if (!tracksRes.ok) result.tracksApiError = tracksBody;
    } catch (e) {
      result.tracksApiOk = false;
      result.tracksApiFetchError = String(e);
    }
  }

  return NextResponse.json(result);
}
