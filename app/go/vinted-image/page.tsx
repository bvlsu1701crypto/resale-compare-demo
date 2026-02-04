"use client";

import { useEffect, useState } from "react";

export default function VintedImageRedirectPage() {
  const target = "https://www.vinted.co.uk/";
  const [status, setStatus] = useState("正在打开 Vinted 的识图入口…");

  useEffect(() => {
    const t = window.setTimeout(() => {
      setStatus("如果没有自动进入识图，请在 Vinted 顶部搜索框右侧点击 Image search 按钮。");
      window.location.href = target;
    }, 300);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[420px] px-5 py-10">
      <h1 className="font-display text-2xl text-brand-900">Vinted 识图</h1>
      <p className="mt-3 text-sm font-semibold text-zinc-700">{status}</p>

      <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <div className="font-extrabold text-zinc-900">说明</div>
        <ul className="mt-2 list-disc pl-5 leading-6">
          <li>浏览器无法把你在 PreloveFinder 里选的图片自动上传到 Vinted。</li>
          <li>进入 Vinted 后，点击顶部的 <b>Image search</b>，再手动上传同一张图片。</li>
        </ul>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <a
          className="rounded-2xl bg-brand-500 px-4 py-3 text-center text-sm font-extrabold text-white"
          href={target}
        >
          打开 Vinted
        </a>
        <a
          className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-center text-sm font-extrabold text-zinc-700"
          href="/detail"
        >
          返回 PreloveFinder
        </a>
      </div>
    </main>
  );
}
