/**
 * 应用启动时注册内置调度器：每 15 分钟检查一次日期是否翻篇，
 * 翻了就跑当日任务。比 setTimeout 到零点更耐重启，也不依赖外部 cron。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // 这个钩子一旦抛错，Next 会让**每个**请求都返回 500，
  // 连 /api/health 和登录页都打不开。调度器再重要也不该有这个权力，
  // 所以整体兜住，出问题只记日志。
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

    // 不阻塞进程退出
    timer.unref?.();
  } catch (error) {
    console.error("[scheduler] 调度器启动失败，应用继续运行:", error);
  }
}
