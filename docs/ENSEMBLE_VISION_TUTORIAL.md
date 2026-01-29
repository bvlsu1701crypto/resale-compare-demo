# Ensemble Vision (方案3) — 全品类图片→关键词识别（可复现实操教程）

> 目标：把「图片识别出的关键词不太好」升级成 **3 路识别 + 合并投票**，得到稳定的 `suggestedQueries.{broad,exact,strict}`，用于 eBay 等平台搜索。

本项目已实现 API 路由：`app/api/vision/route.ts`（三路并行 + 合并 + 本地缓存）。

---

## 0. 你需要准备什么

- Node.js（你当前项目已是 Next.js）
- 一个可用的 `OPENAI_API_KEY`（**API 计费已开通**）

> 安全：不要把 key 放在 `public/` 目录。建议放在：
> - `~/.clawdbot/.env`（给 Clawdbot 用）
> - 项目根目录 `.env.local`（给 Next.js dev server 用）

项目根目录 `.env.local` 示例：
```bash
OPENAI_API_KEY=sk-...
```

---

## 1. 启动项目（保证 /api/vision 可用）

在项目目录：
```bash
cd /Users/beverlysu/projects/resale-compare-demo
npm run dev
```

打开：<http://localhost:3000>

上传一张图，点击「生成关键词」。

---

## 2. 方案3的输出是什么（你要看什么字段）

`/api/vision` 返回 JSON（核心字段）：

- `itemType`: bag/shoes/clothing/accessory/jewelry/watch/other
- `category`: 例如 "sneakers" / "hoodie" / "tote bag" / "leather jacket"
- `brand`, `model`, `color`, `material`, `pattern`
- `keywords`: 合并后关键词池（用于 chips/候选词）
- `suggestedQueries`:
  - `broad`：默认用它搜（高召回）
  - `exact`：更精确（仅在确实很确定时才会包含 model）
  - `strict`：加上 "authentic genuine"（更严格）
- `confidence`: high/medium/low

前端 `app/page.tsx` 已改为默认使用 `broad`，并可切换 `exact/strict/chips`。

---

## 3. 测评集怎么做（你要准备哪些图片）

### 3.1 目标
做一个小而覆盖广的测评集，避免“只对包好用”。

建议 **40–60 张图**，分布：
- shoes：10–15
- clothing（hoodie/jacket/coat/jeans）：15–20
- bags：10–15
- accessory/jewelry/watch：5–10

图片来源：
- 你自己的拍摄
- 你日常截图（eBay/Vinted/IG/小红书截图都可）

> 注意：尽量包含「难例」：
> - 低清晰度
> - 多物体
> - logo 不清晰
> - 纯色无特征

### 3.2 文件放置
把图片放到：
```
eval/images/
```
命名建议：
```
001_nike_dunk_low.jpg
002_arcteryx_shell.jpg
...
```

---

## 4. 标注格式（dataset.jsonl）

在：
```
eval/dataset.jsonl
```
每行一个 JSON：

最小标注（推荐先做这个）：
```json
{"id":"001","image":"eval/images/001.jpg","expected":{"category":"sneakers","brand":"nike"}}
```

可选增强字段（你有精力再加）：
```json
{
  "id":"010",
  "image":"eval/images/010.jpg",
  "expected": {
    "category":"leather jacket",
    "brand": null,
    "mustInclude":["leather","jacket"],
    "mustNotInclude":["replica","dupe"]
  }
}
```

---

## 5. 指标怎么做（建议的 KPI）

### 5.1 自动化指标（脚本可算）
- **Brand hit rate**：
  - expected.brand 非空时，输出 brand 是否大小写无关匹配
- **Category hit rate**：
  - expected.category 是否被输出 category 包含（或反向包含）
- **Query hygiene**：
  - strict 是否包含 "authentic genuine"
  - queries 是否包含禁词：replica/dupe/inspired/lookalike

### 5.2 人工指标（你自己打分）
- **Search usefulness score (1–5)**：
  - 5：复制 broad 去 eBay 搜，前两页就有大量相关结果
  - 3：需要手动删/改 1–2 个词
  - 1：完全跑偏

建议你在 dataset 里加：
- `humanScoreBroad`
- `humanNote`

---

## 6. 怎么跑评测（一步步）

### 6.1 先启动 dev server
```bash
npm run dev
```

### 6.2 运行评测脚本
```bash
node scripts/eval-vision.mjs --baseUrl http://localhost:3000 --dataset eval/dataset.jsonl
```

输出：
- 控制台 summary
- `eval/report.json`（机器可读）

---

## 7. 如何迭代（最有效的三招）

1) **先修 prompt A（事实抽取）**
   - 类别 taxonomy
   - 禁止猜测 brand/model

2) **再修 merge 规则**
   - brand disagreement -> confidence 降级
   - model 只有高置信度才进入 exact

3) **最后才修 prompt B（query 生成）**
   - broad 不要塞太多词
   - strict 一定加 authentic genuine

---

## 8. 你回来了之后要做的清单（按顺序）

1) 确认项目能跑：`npm run dev`
2) 试 5 张你常搜的图：看 broad 是否明显更好
3) 建 `eval/images/` 放 40–60 张图
4) 写 `eval/dataset.jsonl`（先只标注 brand/category）
5) 跑 `node scripts/eval-vision.mjs ...`
6) 挑出最差的 10 张图，我们针对性优化 prompt/merge

