"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("hh-theme", next ? "dark" : "light");
    } catch {
      /* 隐私模式下 localStorage 不可用，忽略即可 */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? "切换到浅色" : "切换到深色"}
      aria-label={dark ? "切换到浅色模式" : "切换到深色模式"}
      className="grid size-8 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
    >
      <span aria-hidden className="text-sm">
        {dark ? "☀" : "☾"}
      </span>
    </button>
  );
}
