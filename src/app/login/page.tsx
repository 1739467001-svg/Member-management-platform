import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm animate-rise">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <span
            aria-hidden
            className="grid size-12 place-items-center rounded-2xl bg-primary text-lg font-bold text-primary-ink shadow-[var(--shadow-pop)]"
          >
            H
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-ink">
              HHStudio Junye 会员管理
            </h1>
            <p className="mt-1 text-xs text-ink-3">视频会员租赁 · 账号与收益管理</p>
          </div>
        </div>

        <div className="card-surface p-6">
          <LoginForm />
        </div>

        <p className="mt-5 text-center text-[11px] text-ink-3">
          初始密码在 .env 的 INITIAL_PASSWORD 中配置，登录后可在设置页修改
        </p>
      </div>
    </main>
  );
}
