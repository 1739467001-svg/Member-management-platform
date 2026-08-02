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
  /**
   * 放行定时任务端点（它用 token 单独鉴权）与全部静态资源。
   * 图标和 manifest 必须放行：浏览器是匿名去取它们的，
   * 若被重定向到登录页，「添加到主屏幕」就装不上图标。
   */
  matcher: [
    "/((?!api/cron|_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
