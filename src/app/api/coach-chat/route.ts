import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 대화 불러오기
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const nickname = searchParams.get("nickname");
    if (!nickname) return NextResponse.json({ messages: [] });

    const { data } = await supabaseAdmin
      .from("coach_chats")
      .select("role, text, created_at")
      .eq("nickname", nickname)
      .order("created_at", { ascending: true })
      .limit(200);

    return NextResponse.json({ messages: data || [] });
  } catch (e: any) {
    return NextResponse.json({ messages: [], error: e.message }, { status: 500 });
  }
}

// 대화 저장
export async function POST(req: Request) {
  try {
    const { nickname, role, text } = await req.json();
    if (!nickname || !role || !text) {
      return NextResponse.json({ error: "missing fields" }, { status: 400 });
    }
    await supabaseAdmin.from("coach_chats").insert([{ nickname, role, text }]);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
