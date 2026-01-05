import { NextResponse } from "next/server";
import { getGitHubStatistics } from "@/lib/github";
import { renderStatisticsCard } from "@/lib/renderCard";

export const runtime = "nodejs";

function getParam(url: URL, key: string, fallback?: string) {
  return url.searchParams.get(key) ?? fallback ?? null;
}

function toBool(v: string | null, fallback = false) {
  if (v === null) return fallback;
  return v === "true" || v === "1" || v.toLowerCase() === "yes";
}

function toNum(v: string | null, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const username = getParam(url, "username");
    if (!username) return new NextResponse("Missing ?username=", { status: 400 });

    const raw = toBool(getParam(url, "raw", "false"));
    const accept = req.headers.get("accept") || "";
    const wantsHtml = accept.includes("text/html") && !raw;

    // LOC scan options
    const reposLimit = toNum(getParam(url, "repos_limit", "50"), 50);
    const includeForks = toBool(getParam(url, "include_forks", "false"));
    const concurrency = toNum(getParam(url, "concurrency", "4"), 4);

    // style
    const hideBorder = toBool(getParam(url, "hide_border", "false"));
    const width = toNum(getParam(url, "width", "560"), 560);

    const bg = getParam(url, "bg", "#0d1117")!;
    const border = getParam(url, "border", "#30363d")!;
    const title = getParam(url, "title", "#58a6ff")!;
    const label = getParam(url, "label", "#c9d1d9")!;
    const value = getParam(url, "value", "#c9d1d9")!;
    const muted = getParam(url, "muted", "#8b949e")!;

    if (wantsHtml) {
      const imgUrl = new URL(req.url);
      imgUrl.searchParams.set("raw", "true");

      const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${username}'s GitHub Stats</title>
  <style>
    body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0d1117; }
    img { max-width: 95vw; height:auto; }
  </style>
</head>
<body>
  <img src="${imgUrl.toString()}" alt="GitHub Stats" />
</body>
</html>`;

      return new NextResponse(html, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    const stats = await getGitHubStatistics(username, {
      reposLimit,
      includeForks,
      concurrency,
    });

    const svg = renderStatisticsCard(stats, {
      bg,
      border,
      title,
      label,
      value,
      muted,
      hideBorder,
      width,
    });

    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=0, s-maxage=21600, stale-while-revalidate=21600",
      },
    });
  } catch (e: any) {
    return new NextResponse(e?.message ?? "Server error", { status: 500 });
  }
}
