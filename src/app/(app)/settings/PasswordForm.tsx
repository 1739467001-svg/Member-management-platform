"use client";

import { useActionState } from "react";
import { changePasswordAction } from "@/app/actions";

type State = { error?: string; success?: string } | null;

export function PasswordForm() {
  const [state, formAction] = useActionState(changePasswordAction, null as State);

  return (
    <form action={formAction} className="space-y-2.5">
      <label className="block">
        <span className="mb-1 block text-[11px] text-ink-3">当前密码</span>
        <input
          name="current"
          type="password"
          autoComplete="current-password"
          className="w-full rounded-lg border border-line bg-page px-2.5 py-2 text-xs outline-none focus:border-primary"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] text-ink-3">新密码（至少 6 位）</span>
        <input
          name="next"
          type="password"
          autoComplete="new-password"
          className="w-full rounded-lg border border-line bg-page px-2.5 py-2 text-xs outline-none focus:border-primary"
        />
      </label>

      {state?.error && (
        <p role="alert" className="tint-critical rounded-lg px-2.5 py-1.5 text-[11px] text-critical">
          {state.error}
        </p>
      )}
      {state?.success && (
        <p role="status" className="tint-good rounded-lg px-2.5 py-1.5 text-[11px] text-good">
          {state.success}
        </p>
      )}

      <button
        type="submit"
        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-ink hover:bg-primary-hover"
      >
        更新密码
      </button>
    </form>
  );
}
