import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HHStudio Junye 会员管理",
  description: "视频会员租赁的账号、成本与收益管理系统",
  manifest: "/manifest.webmanifest",
  // 手机加到主屏后按独立应用打开，标题栏跟随主题色
  appleWebApp: { capable: true, title: "HHStudio", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf5ec" },
    { media: "(prefers-color-scheme: dark)", color: "#141210" },
  ],
  width: "device-width",
  initialScale: 1,
  // 允许缩放：这是会计类页面，用户可能要放大看数字
  maximumScale: 5,
  viewportFit: "cover",
};

/** 在页面绘制前定好主题，避免深色模式闪白 */
const themeScript = `
(function(){
  try {
    var saved = localStorage.getItem('hh-theme');
    var dark = saved ? saved === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
