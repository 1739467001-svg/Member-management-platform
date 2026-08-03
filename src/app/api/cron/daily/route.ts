import { NextResponse, type NextRequest } from "next/server";
import { runDailyTasks } from "@/lib/domain/daily";

export const dynamic = "force-dynamic";
// 重算客户指标可能超过默认 10s，给足时间
export const maxDuration = 60;

/**
 * 每日任务入口。
 *
 * Vercel：由 vercel.json 里的 cron 触发，平台会带上
 * `Authorization: Bearer $CRON_SECRET`（CRON_SECRET 在项目环境变量里配）。
 * 自托管：应用内置调度器已会自动跑，也可用 crontab 兜底：
 *   5 0 * * * curl -fsS -H "Authorization: Bearer $CRON_TOKEN" http://127.0.0.1:3000/api/cron/daily
 */
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET || process.env.CRON_TOKEN;

  if (expected) {
    const header = request.headers.get("authorization");
    const token =
      header?.replace(/^Bearer\s+/i, "") ?? request.nextUrl.searchParams.get("token");
    if (token !== expected) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await runDailyTasks();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron] 每日任务失败:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed" },
      { status: 500 },
    );
  }
}
