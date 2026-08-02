"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { loginAction } from "../actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-ink transition-colors hover:bg-primary-hover disabled:opacity-60"
    >
      {pending ? "登录中…" : "登录"}
    </button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState(loginAction, null as { error?: string } | null);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-ink-2">
          登录密码
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="请输入密码"
          className="w-full rounded-lg border border-line bg-page px-3 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-primary"
        />
      </div>

      {state?.error && (
        <p role="alert" className="tint-critical rounded-lg px-3 py-2 text-xs text-critical">
          {state.error}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
