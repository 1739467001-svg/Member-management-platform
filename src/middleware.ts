import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const authed = await verifySessionToken(token);
  const isLoginPage = request.nextUrl.pathname === "/login";

  if (!authed && !isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (authed && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // 放行静态资源与定时任务端点（后者用 token 单独鉴权）
  matcher: ["/((?!api/cron|_next/static|_next/image|favicon.ico|.*\\.svg).*)"],
};
