"use client";

import { useEffect, useMemo, useState } from "react";

function isIOS(ua: string) {
  return /iPhone|iPad|iPod/i.test(ua);
}

function isAndroid(ua: string) {
  return /Android/i.test(ua);
}

export default function XianyuImageRedirectPage() {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";

  const platform = useMemo(() => {
    if (isIOS(ua)) return "ios";
    if (isAndroid(ua)) return "android";
    return "other";
  }, [ua]);

  // NOTE: Deep link schemes may change; this is a best-effort.
  // Many devices will prompt the user; some browsers block silent redirects.
  const deepLink = "fleamarket://";

  // Fallback targets
  const iosStore = "https://apps.apple.com/cn/app/%E9%97%B2%E9%B1%BC-%E9%97%B2%E7%BD%AE%E4%BA%A4%E6%98%93%E7%A4%BE%E5%8C%BA/id510909506";
  const androidStore = "https://a.app.qq.com/o/simple.jsp?pkgname=com.taobao.idlefish";
  const webFallback = "https://www.goofish.com/";

  const fallbackUrl = platform === "ios" ? iosStore : platform === "android" ? androidStore : webFallback;

  const [status, setStatus] = useState("正在尝试打开闲鱼 App…");

  useEffect(() => {
    const start = Date.now();

    // Attempt to open app
    try {
      window.location.href = deepLink;
    } catch {
      // ignore
    }

    // If the app isn't installed, redirect after a short delay.
    // If the app opens successfully, the browser typically gets backgrounded.
    const t = window.setTimeout(() => {
      const elapsed = Date.now() - start;
      setStatus(`未检测到 App（${elapsed}ms），正在跳转到下载/网页版…`);
      window.location.href = fallbackUrl;
    }, 1200);

    return () => window.clearTimeout(t);
  }, [deepLink, fallbackUrl]);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[420px] px-5 py-10">
      <h1 className="font-display text-2xl text-brand-900">闲鱼识图</h1>
      <p className="mt-3 text-sm font-semibold text-zinc-700">{status}</p>

      <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <div className="font-extrabold text-zinc-900">说明</div>
        <ul className="mt-2 list-disc pl-5 leading-6">
          <li>浏览器无法把你在 PreloveFinder 里选的图片自动上传到闲鱼。</li>
          <li>打开闲鱼后，请在闲鱼内选择“识图/相机”并手动上传同一张图片。</li>
        </ul>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <a
          className="rounded-2xl bg-brand-500 px-4 py-3 text-center text-sm font-extrabold text-white"
          href={deepLink}
        >
          再试一次打开 App
        </a>
        <a
          className="rounded-2xl border border-brand-500 bg-white px-4 py-3 text-center text-sm font-extrabold text-zinc-900"
          href={fallbackUrl}
        >
          去下载/网页版
        </a>
      </div>
    </main>
  );
}
