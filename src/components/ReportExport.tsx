"use client";

import { useState } from "react";

/** 报表导出：Markdown 直接复制到聊天窗口，CSV 拿去做进一步核算 */
export function ReportExport({
  markdown,
  csv,
  filename,
}: {
  markdown: string;
  csv: string;
  filename: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // 非安全上下文下剪贴板不可用，退回选中文本让用户手动复制
      window.prompt("请手动复制报表内容：", markdown);
    }
  };

  const download = () => {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="inline-flex gap-1">
      <button
        type="button"
        onClick={copy}
        className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 transition-colors hover:border-primary hover:text-primary"
      >
        {copied ? "✓ 已复制" : "复制报表"}
      </button>
      <button
        type="button"
        onClick={download}
        className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 transition-colors hover:border-primary hover:text-primary"
      >
        导出 CSV
      </button>
    </div>
  );
}
