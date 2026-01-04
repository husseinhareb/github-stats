import { NextResponse } from "next/server";
import { getGitHubStatistics } from "@/lib/github";
import { renderStatisticsCard } from "@/lib/renderCard";

// Ensure Node runtime (traffic + longer work is safer here)
export const runtime = "nodejs";

function getParam(url: URL, key: string, fallback?: string) {
  return url.searchParams.get(key) ?? fallback ?? null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const username = getParam(url, "username");
    if (!username) {
      return new NextResponse("Missing ?username=", { status: 400 });
    }

    const includeTraffic = getParam(url, "include_traffic", "false") === "true";
    const reposLimit = Number(getParam(url, "repos_limit", "25")) || 25;
    const maxPrs = Number(getParam(url, "max_prs", "400")) || 400;

    // styling params (optional)
    const hideBorder = getParam(url, "hide_border", "false") === "true";
    const bg = getParam(url, "bg", "#0d1117")!;
    const border = getParam(url, "border", "#30363d")!;
    const title = getParam(url, "title", "#58a6ff")!;
    const label = getParam(url, "label", "#c9d1d9")!;
    const value = getParam(url, "value", "#c9d1d9")!;
    const muted = getParam(url, "muted", "#8b949e")!;

    const stats = await getGitHubStatistics(username, {
      includeTraffic,
      reposLimit,
      maxPrs,
    });

    const svg = renderStatisticsCard(stats, {
      bg,
      border,
      title,
      label,
      value,
      muted,
      hideBorder,
    });

    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        // Cache at Vercel edge; GitHub also caches images, so keep it stable.
        "Cache-Control":
          "public, max-age=0, s-maxage=21600, stale-while-revalidate=21600",
      },
    });
  } catch (e: any) {
    return new NextResponse(e?.message ?? "Server error", { status: 500 });
  }
}
