import { NextRequest, NextResponse } from "next/server";
import {
  addPlaylistSource,
  readPlaylistSources,
  removePlaylistSource,
  setPlaylistSourceEnabled,
} from "@/lib/playlist-sources";
import { checkAdminPassword } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Body = {
  adminPassword?: string;
  action?: "list" | "add" | "remove" | "toggle";
  url?: string;
  label?: string;
  playlistId?: string;
  enabled?: boolean;
};

export async function POST(req: NextRequest) {
  const { adminPassword, action = "list", url, label, playlistId, enabled } = (await req.json()) as Body;
  if (!checkAdminPassword(adminPassword)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    switch (action) {
      case "list":
        return NextResponse.json({ sources: await readPlaylistSources() });
      case "add":
        return NextResponse.json({ sources: await addPlaylistSource(url ?? "", label ?? "") });
      case "remove":
        if (!playlistId) throw new Error("playlistId is required");
        return NextResponse.json({ sources: await removePlaylistSource(playlistId) });
      case "toggle":
        if (!playlistId) throw new Error("playlistId is required");
        return NextResponse.json({ sources: await setPlaylistSourceEnabled(playlistId, enabled !== false) });
      default:
        return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
    }
  } catch (e) {
    console.error("playlist-sources failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
