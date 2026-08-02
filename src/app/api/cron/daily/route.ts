import { NextResponse, type NextRequest } from "next/server";
import { runDailyTasks } from "@/lib/domain/daily";

export const dynamic = "force-dynamic";

/**
 * 每日任务的对外入口，供服务器 crontab 兜底调用：
 *   5 0 * * * curl -fsS -H "Authorization: Bearer $CRON_TOKEN" http://127.0.0.1:3000/api/cron/daily
 * 应用内置调度器已经会自动跑，这个端点是双保险。
 */
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_TOKEN;
  if (expected) {
    const header = request.headers.get("authorization");
    const token = header?.replace(/^Bearer\s+/i, "") ?? request.nextUrl.searchParams.get("token");
    if (token !== expected) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await runDailyTasks();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron] 每日任务失败:", error);
    return NextResponse.json({ ok: false, error: "failed" }, { status: 500 });
  }
}
