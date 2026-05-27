import { NextRequest, NextResponse } from "next/server";

function sanitizePrompt(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 5000) return null;
  return trimmed;
}

async function callGemini(prompt: string, apiKey: string, attempt = 1): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7 },
        }),
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`API ${res.status}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!text && attempt < 2) {
      return callGemini(prompt, apiKey, attempt + 1);
    }
    return text;
  } catch (e) {
    clearTimeout(timeout);
    if (attempt < 2) {
      await new Promise(r => setTimeout(r, 1000));
      return callGemini(prompt, apiKey, attempt + 1);
    }
    throw e;
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const prompt = sanitizePrompt(body.prompt);
  if (!prompt) {
    return NextResponse.json({ error: "프롬프트가 비어있거나 너무 깁니다." }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  }

  try {
    const text = await callGemini(prompt, apiKey);
    return NextResponse.json({ text });
  } catch (e) {
    console.error("Gemini error:", e);
    return NextResponse.json({ error: "AI 호출 실패. 다시 시도해주세요." }, { status: 500 });
  }
}
