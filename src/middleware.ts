import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const rateLimitMap = new Map<string, { count: number; timestamp: number }>();

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // 보안 헤더
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  const path = request.nextUrl.pathname;

  // /admin 보호 — 쿠키에서 인증 확인
  if (path.startsWith("/admin")) {
    const adminEmail = process.env.ADMIN_EMAIL || "minjaej581@gmail.com";
    const authCookie = request.cookies.get("sb-access-token")?.value ||
                       request.cookies.get("sb-zanktsamayaxvbaknqyp-auth-token")?.value;
    if (!authCookie) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  // API Rate Limiting
  if (path.startsWith("/api/")) {
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
    const now = Date.now();
    const windowMs = 60 * 1000; // 1분
    const maxRequests = 30; // 분당 30회

    const record = rateLimitMap.get(ip);
    if (record) {
      if (now - record.timestamp < windowMs) {
        record.count++;
        if (record.count > maxRequests) {
          return NextResponse.json(
            { error: "Too many requests. Please try again later." },
            { status: 429 }
          );
        }
      } else {
        record.count = 1;
        record.timestamp = now;
      }
    } else {
      rateLimitMap.set(ip, { count: 1, timestamp: now });
    }

    // 맵 크기 제한 (메모리 관리)
    if (rateLimitMap.size > 10000) {
      const entries = Array.from(rateLimitMap.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      for (let i = 0; i < 5000; i++) {
        rateLimitMap.delete(entries[i][0]);
      }
    }
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/api/:path*", "/((?!_next/static|_next/image|favicon.ico|icon-|sw.js|manifest.json).*)"],
};
