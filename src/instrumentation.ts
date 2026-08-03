/**
 * 启动钩子。
 *
 * 无服务器平台（Vercel 等）上进程随时被回收，进程内定时器根本不可靠，
 * 所以那里的每日任务交给平台的 Cron 打 /api/cron/daily（见 vercel.json）。
 * 只有长驻进程（自托管 / Docker）才注册进程内调度器。
 *
 * 这个钩子一旦抛错，Next 会让**每个**请求都返回 500，连 /api/health 都打不开，
 * 所以整体兜住，出问题只记日志。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Vercel / 各家函数计算：不起进程内调度器
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) return;

  try {
    const { ensureDailyRun } = await import("./lib/domain/daily");

    await ensureDailyRun();

    const timer = setInterval(
      () => {
        ensureDailyRun().catch((error) =>
          console.error("[scheduler] 每日任务执行失败:", error),
        );
      },
      15 * 60 * 1000,
    );

    timer.unref?.();
  } catch (error) {
    console.error("[scheduler] 调度器启动失败，应用继续运行:", error);
  }
}
