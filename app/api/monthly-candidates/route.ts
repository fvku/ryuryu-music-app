import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Server-side in-memory cache (persists across warm invocations)
const serverCache = new Map<string, { data: unknown; savedAt: number }>();
const SERVER_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

const GENRE_LABEL: Record<string, string> = {
  all:        "ジャンルを問わずすべてのジャンル",
  indie:      "インディーロック・オルタナティブ・シューゲイザー・ポストパンクなどインディー・オルタナ系",
  electronic: "エレクトロニック・アンビエント・テクノ・実験音楽など",
  japan:      "日本語作品（邦楽）",
};

const SYSTEM_PROMPT = `あなたは音楽批評家です。
指定された月にリリースされた高評価・話題のアルバムを、
AOTY（Album of the Year）・RateYourMusic・Pitchfork・Resident Advisor・NMEで調べてください。

重要:
- EP・シングル・ライブ盤・コンピレーションは除外し、スタジオフルアルバムのみ10〜15件を対象とすること
- web_search の呼び出しは合計3回以内に収めること（コスト削減のため）
- 検索が完了したら、テキストで回答せず、必ずsubmit_albumsツールを呼び出して結果を提出してください`;

// Tool schema — Anthropic validates input against this, so we never get malformed JSON
const SUBMIT_TOOL: Anthropic.Tool = {
  name: "submit_albums",
  description: "検索結果のアルバムリストを提出する",
  input_schema: {
    type: "object" as const,
    properties: {
      month: { type: "string", description: "YYYY-MM" },
      albums: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title:              { type: "string" },
            artist:             { type: "string" },
            country:            { type: "string" },
            releaseDate:        { type: "string", description: "YYYY-MM-DD" },
            genres:             { type: "array", items: { type: "string" } },
            sources: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name:  { type: "string" },
                  score: { type: "number" },
                  note:  { type: "string" },
                  url:   { type: "string" },
                },
                required: ["name", "note"],
              },
            },
            hypeScore:           { type: "number", description: "0〜100" },
            spotifySearchQuery:  { type: "string" },
          },
          required: ["title", "artist", "genres", "sources", "hypeScore", "spotifySearchQuery"],
        },
      },
    },
    required: ["month", "albums"],
  },
};

function buildUserPrompt(yearMonth: string, genre: string): string {
  const [year, month] = yearMonth.split("-");
  const genreLabel = GENRE_LABEL[genre] ?? GENRE_LABEL.all;
  return `${year}年${month}月にリリースされた${genreLabel}の高評価・話題のスタジオフルアルバムを10〜15件検索して、submit_albumsツールで結果を返してください。EPは除外してください。`;
}

export async function POST(request: NextRequest) {
  try {
    const { yearMonth, genre = "all", forceRefresh = false } = await request.json() as { yearMonth: string; genre?: string; forceRefresh?: boolean };

    if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
      return NextResponse.json({ error: "yearMonth must be YYYY-MM format" }, { status: 400 });
    }

    // Check server-side cache first
    const key = `${yearMonth}:${genre}`;
    if (!forceRefresh) {
      const cached = serverCache.get(key);
      if (cached && Date.now() - cached.savedAt < SERVER_CACHE_TTL) {
        return NextResponse.json(cached.data);
      }
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 500 });
    }

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [
        { type: "web_search_20250305", name: "web_search" },
        SUBMIT_TOOL,
      ] as Parameters<typeof client.messages.create>[0]["tools"],
      messages: [
        { role: "user", content: buildUserPrompt(yearMonth, genre) },
      ],
    });

    // Extract from tool_use block — Anthropic validates schema so input is always valid
    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "submit_albums"
    );

    if (toolUse) {
      serverCache.set(key, { data: toolUse.input, savedAt: Date.now() });
      return NextResponse.json(toolUse.input);
    }

    // Fallback: should not reach here, but handle gracefully
    return NextResponse.json(
      { error: "アルバムリストが取得できませんでした。再度お試しください。" },
      { status: 500 }
    );
  } catch (error) {
    console.error("monthly-candidates error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
