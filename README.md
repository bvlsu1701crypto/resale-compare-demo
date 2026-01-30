This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

### Environment variables

Create `.env.local` (or set these in Vercel) with:

```bash
# Required for eBay Browse API (recommended)
EBAY_CLIENT_ID=...
EBAY_CLIENT_SECRET=...
# Optional: defaults to EBAY_GB
EBAY_MARKETPLACE_ID=EBAY_GB

# If you use the vision demo
OPENAI_API_KEY=...
```

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

1) Push this repo to GitHub
2) Import into Vercel
3) Set environment variables in Vercel:
   - `EBAY_CLIENT_ID`
   - `EBAY_CLIENT_SECRET`
   - `EBAY_MARKETPLACE_ID` (optional, e.g. `EBAY_GB`)
   - `OPENAI_API_KEY` (only if you need the vision demo)
4) Deploy → you’ll get a shareable test link

Notes:
- The server route `GET /api/search?q=...` calls eBay Browse API when credentials exist; otherwise it falls back to HTML scraping.
