import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { generatorActor } from "@/lib/generator/access";
import type { SavedTrack } from "@/lib/generator/saved-tracks";
import { fetchSavedTracks } from "@/lib/generator/saved-tracks-source";
import SavedTracksStudio from "./SavedTracksStudio";

export const metadata: Metadata = { title: "Saved Tracks Stories画像" };
export const dynamic = "force-dynamic";

export default async function SavedTracksPage() {
  let tracks: SavedTrack[] = [], error: string | null = null, needsLogin = false;
  try {
    generatorActor(await auth());
    tracks = await fetchSavedTracks();
  } catch (caught) {
    const known = caught as { message?: string; status?: number };
    error = known.message || "プレイリストを読み込めませんでした。";
    needsLogin = known.status === 401;
  }
  return <SavedTracksStudio initialTracks={tracks} initialError={error} initiallyNeedsLogin={needsLogin} />;
}
