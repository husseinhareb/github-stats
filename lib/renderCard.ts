import type { GitHubStatistics } from "./github";

function esc(s: unknown) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatNumber(n: number) {
  try {
    return n.toLocaleString("en-US");
  } catch {
    return String(n);
  }
}

export function renderStatisticsCard(
  stats: GitHubStatistics,
  opts?: {
    bg?: string;
    border?: string;
    title?: string;
    label?: string;
    value?: string;
    muted?: string;
    hideBorder?: boolean;
  }
) {
  const width = 520;
  const height = 190;

  const bg = opts?.bg ?? "#0d1117";
  const border = opts?.hideBorder ? "transparent" : (opts?.border ?? "#30363d");
  const title = opts?.title ?? "#58a6ff";
  const label = opts?.label ?? "#c9d1d9";
  const value = opts?.value ?? "#c9d1d9";
  const muted = opts?.muted ?? "#8b949e";

  const rows: Array<{
    icon: string;
    name: string;
    val: string;
    note?: string | null;
  }> = [
    { icon: "☆", name: "Stars", val: formatNumber(stats.stars) },
    { icon: "⑂", name: "Forks", val: formatNumber(stats.forks) },
    {
      icon: "⤴",
      name: "All-time contributions",
      val: formatNumber(stats.contributionsAllTime),
    },
    {
      icon: "+",
      name: "Lines of code changed",
      val: formatNumber(stats.locChanged),
      note: `from last ${stats.locPrsCounted} merged PRs`,
    },
    {
      icon: "◔",
      name: "Repository views (past two weeks)",
      val: stats.views14d ? formatNumber(stats.views14d.totalViews) : "—",
      note: stats.views14d
        ? `(${stats.views14d.succeeded}/${stats.views14d.attempted} repos)`
        : "enable include_traffic=true",
    },
    {
      icon: "▣",
      name: "Repositories with contributions",
      val: formatNumber(stats.reposContributedTo),
    },
  ];

  const leftX = 34;
  const iconX = 34;
  const labelX = 62;
  const valueX = 488;

  const startY = 66;
  const lineH = 22;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="2" stdDeviation="6" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>

  <rect x="10" y="10" width="${width - 20}" height="${height - 20}" rx="10"
        fill="${bg}" stroke="${border}" filter="url(#shadow)"/>

  <text x="${leftX}" y="44"
        font-family="ui-sans-serif, system-ui, -apple-system"
        font-size="16" font-weight="700"
        fill="${title}">
    ${esc(stats.login)}'s GitHub Statistics
  </text>

  <g font-family="ui-sans-serif, system-ui, -apple-system" font-size="13" fill="${label}">
    ${rows
      .map((r, i) => {
        const y = startY + i * lineH;
        const note =
          r.note
            ? `<text x="${labelX}" y="${y + 13}" font-size="10" fill="${muted}">${esc(
                r.note
              )}</text>`
            : "";
        return `
      <text x="${iconX}" y="${y}" font-size="13" fill="${muted}">${esc(r.icon)}</text>
      <text x="${labelX}" y="${y}">${esc(r.name)}</text>
      <text x="${valueX}" y="${y}" text-anchor="end"
            font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
            fill="${value}">${esc(r.val)}</text>
      ${note}
        `;
      })
      .join("")}
  </g>
</svg>`;
}
