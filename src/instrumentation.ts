/**
 * 应用启动时注册内置调度器：每 15 分钟检查一次日期是否翻篇，
 * 翻了就跑当日任务。比 setTimeout 到零点更耐重启，也不依赖外部 cron。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

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
}
