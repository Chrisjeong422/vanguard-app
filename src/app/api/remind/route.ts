import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
function toKST(date?: Date | number) {
  const d = date ? new Date(date) : new Date();
  return new Date(d.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
}
function kstDateStr(date?: Date | number) {
  const k = toKST(date);
  return `${k.getFullYear()}-${String(k.getMonth()+1).padStart(2,"0")}-${String(k.getDate()).padStart(2,"0")}`;
}


const resend = new Resend(process.env.RESEND_API_KEY);
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function handleRemind() {
  try {
    const { data: users } = await supabaseAdmin.from("users").select("*");
    if (!users) return NextResponse.json({ error: "no users" }, { status: 500 });
    const today = kstDateStr();
    const yesterday = kstDateStr(Date.now() - 86400000);
    const { data: records } = await supabaseAdmin.from("execution_records").select("*");
    let sent = 0;
    for (const user of users) {
      if (!user.nickname || !user.email) continue;
      const userRecords = (records || []).filter((r: { nickname: string }) => r.nickname === user.nickname);
      const todayDone = userRecords.some((r: { date: string; done: boolean }) => r.date === today && r.done);
      const yesterdayFailed = userRecords.some((r: { date: string; done: boolean }) => r.date === yesterday && !r.done);
      const yesterdayMissed = !userRecords.some((r: { date: string }) => r.date === yesterday);
      const failCount = userRecords.filter((r: { done: boolean }) => !r.done).length;
      if (todayDone) continue;
      let subject = "오늘 아직 시작 안 했다";
      let message = "오늘 1개만 하면 된다. 지금 3분만 시작해라.";
      if (yesterdayFailed && failCount >= 3) {
        subject = `${failCount}번째 같은 패턴이다`;
        message = `어제도 실패했다. 이번 달 ${failCount}번째다. 이 패턴 지금 안 끊으면 계속 간다. 근데 이건 끊을 수 있다. 지금 3분만 시작해라.`;
      } else if (yesterdayFailed) {
        subject = "어제 놓쳤다. 오늘까지 놓치면 패턴 된다";
        message = "어제 실패했다. 오늘도 안 하면 2일 연속이다. 지금 시작하면 아직 살릴 수 있다.";
      } else if (yesterdayMissed) {
        subject = "어제 앱도 안 켰다";
        message = "어제 앱도 안 들어왔다. 오늘도 안 하면 습관이 끊긴다. 지금 켜라.";
      }
      try {
        await resend.emails.send({
          from: "Vanguard <onboarding@resend.dev>",
          to: user.email,
          subject: `[Vanguard] ${subject}`,
          html: `
            <div style="background:#050A12;padding:40px 20px;font-family:system-ui,sans-serif;">
              <div style="max-width:400px;margin:0 auto;">
                <div style="text-align:center;margin-bottom:30px;">
                  <h1 style="color:#fff;letter-spacing:0.15em;font-size:24px;margin:0;">VANGUARD</h1>
                </div>
                <div style="background:#0D1117;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:24px;">
                  <h2 style="color:#FCA5A5;font-size:18px;margin:0 0 12px;">${subject}</h2>
                  <p style="color:#94A3B8;font-size:14px;line-height:1.8;margin:0 0 20px;">${message}</p>
                  <a href="https://vanguard-five-ecru.vercel.app" style="display:block;background:#fff;color:#050A12;text-align:center;padding:14px;border-radius:12px;font-weight:900;text-decoration:none;letter-spacing:0.3em;font-size:14px;">
                    지금 시작
                  </a>
                </div>
              </div>
            </div>
          `,
        });
        sent++;
      } catch (emailError) {
        console.error(`Email failed for ${user.nickname}:`, emailError);
      }
    }
    return NextResponse.json({ sent, total: users.length });
  } catch (error) {
    console.error("Remind error:", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export async function GET() {
  return handleRemind();
}

export async function POST() {
  return handleRemind();
}
