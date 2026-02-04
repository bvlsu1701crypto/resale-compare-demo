export type Lang = "en" | "zh";

export const TEXT: Record<Lang, Record<string, string>> = {
  en: {
    title: "PreloveFinder",
    placeholder: "Describe the bag (optional), e.g. coach bag with C buckle",
    upload: "Upload image",
    search: "Search",
    switchTo: "切换中文",
  },
  zh: {
    title: "PreloveFinder",
    placeholder: "（可选）描述一下包，例如：coach 带 C 扣的包",
    upload: "上传图片",
    search: "搜索",
    switchTo: "Change to English",
  },
};
