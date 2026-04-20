import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GENRE_LABEL: Record<string, string> = {
  all:        "ジャンルを問わずすべてのジャンル",
  indie:      "インディーロック・オルタナティブ・シューゲイザー・ポストパンクなどインディー・オルタナ系",
  electronic: "エレクトロニック・アンビエント・テクノ・実験音楽など",
  japan:      "日本語作品（邦楽）",
};

const SYSTEM_PROMPT = `あなたは音楽批評家です。
指定された月にリリースされた高評価・話題のアルバムを、
AOTY（Album of the Year）・RateYourMusic・Pitchfork・Resident Advisor・NME・音楽系Twitterを横断検索し、
verified済みのアルバムのみ6〜10件をJSON形式で返してください。

出力は必ずJSONのみ。説明文・コードブロック記法は不要。
以下のスキーマに従ってください:

{
  "month": "YYYY-MM",
  "albums": [
    {
      "title": "アルバム名",
      "artist": "アーティスト名",
      "country": "US",
      "genres": ["indie rock", "shoegaze"],
      "sources": [
        { "name": "AOTY", "score": 88, "note": "88/100" },
        { "name": "Pitchfork", "score": null, "note": "Best New Music" }
      ],
      "hypeScore": 90,
      "spotifySearchQuery": "Artist Title"
    }
  ]
}

hypeScoreは0〜100の数値で、複数メディアのスコア・話題性を総合した独自推定値。`;

function buildUserPrompt(yearMonth: string, genre: string): string {
  const [year, month] = yearMonth.split("-");
  const genreLabel = GENRE_LABEL[genre] ?? GENRE_LABEL.all;
  return `${year}年${month}月にリリースされた${genreLabel}の高評価・話題アルバムを検索して、JSONで返してください。`;
}

function extractJson(text: string): string {
  // コードブロックがあれば除去
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) return codeBlock[1].trim();
  // { で始まる部分を抽出
  const start = text.indexOf("{");
  const end   = text.lastIndexOf("}");
  if (start !== -1 && end !== -1) return text.slice(start, end + 1);
  return text.trim();
}

export async function POST(request: NextRequest) {
  try {
    const { yearMonth, genre = "all" } = await request.json() as { yearMonth: string; genre?: string };

    if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
      return NextResponse.json({ error: "yearMonth must be YYYY-MM format" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 500 });
    }

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [{ type: "web_search_20250305", name: "web_search" }] as Parameters<typeof client.messages.create>[0]["tools"],
      messages: [
        { role: "user", content: buildUserPrompt(yearMonth, genre) },
      ],
    });

    // content 配列から text ブロックを結合
    const fullText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    const jsonStr = extractJson(fullText);
    const parsed = JSON.parse(jsonStr);

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("monthly-candidates error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
