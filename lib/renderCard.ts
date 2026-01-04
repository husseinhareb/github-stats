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
  opts: {
    bg?: string;
    border?: string;
    title?: string;
    label?: string;
    value?: string;
    muted?: string;
    hideBorder?: boolean;
    width?: number;
  } = {}
) {
  const width = opts.width ?? 560;

  const bg = opts.bg ?? "#0d1117";
  const border = opts.hideBorder ? "transparent" : (opts.border ?? "#30363d");
  const title = opts.title ?? "#58a6ff";
  const label = opts.label ?? "#c9d1d9";
  const value = opts.value ?? "#c9d1d9";
  const muted = opts.muted ?? "#8b949e";

  const fontSans =
    "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica, Arial";
  const fontMono =
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

  const rows: Array<{ icon: string; name: string; val: string; note?: string | null }> = [
    { icon: "☆", name: "Stars", val: formatNumber(stats.stars) },
    { icon: "⑂", name: "Forks", val: formatNumber(stats.forks) },
    { icon: "⤴", name: "All-time contributions", val: formatNumber(stats.contributionsAllTime) },
    {
      icon: "+",
      name: "Lines of code changed",
      val: formatNumber(stats.locChanged),
      note:
        stats.locSource === "commits"
          ? `from ${stats.locItemsCounted} commits (default branches)`
          : `from last ${stats.locItemsCounted} merged PRs`,
    },
    {
      icon: "◔",
      name: "Repository views (past two weeks)",
      val: stats.views14d ? formatNumber(stats.views14d.totalViews) : "—",
      note: stats.views14d
        ? `(${stats.views14d.succeeded}/${stats.views14d.attempted} repos)`
        : "enable include_traffic=true",
    },
    { icon: "▣", name: "Repositories with contributions", val: formatNumber(stats.reposContributedTo) },
  ];

  // Layout
  const padOuter = 10;
  const padInnerX = 26;

  const titleY = 44;

  const iconX = padOuter + padInnerX;
  const labelX = iconX + 28;
  const valueX = width - (padOuter + padInnerX);

  const rowFont = 13;
  const noteFont = 10;

  const rowGap = 22;        // spacing per row
  const noteGap = 14;       // distance from row baseline to note baseline
  const extraAfterNote = 6; // extra space after note

  let y = 72; // first row baseline
  const rowSvgs: string[] = [];

  for (const r of rows) {
    rowSvgs.push(`
      <text x="${iconX}" y="${y}" font-size="${rowFont}" fill="${muted}"
            font-family="${fontSans}" dominant-baseline="middle">${esc(r.icon)}</text>
      <text x="${labelX}" y="${y}" font-size="${rowFont}" fill="${label}"
            font-family="${fontSans}" dominant-baseline="middle">${esc(r.name)}</text>
      <text x="${valueX}" y="${y}" font-size="${rowFont}" fill="${value}" text-anchor="end"
            font-family="${fontMono}" dominant-baseline="middle">${esc(r.val)}</text>
    `);

    if (r.note) {
      rowSvgs.push(`
        <text x="${labelX}" y="${y + noteGap}" font-size="${noteFont}" fill="${muted}"
              font-family="${fontSans}" dominant-baseline="middle">${esc(r.note)}</text>
      `);
      y += rowGap + noteGap + extraAfterNote;
    } else {
      y += rowGap;
    }
  }

  // Dynamic height (prevents clipping and overlap)
  const height = y + 24;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
     xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision">
  <defs>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="2" stdDeviation="6" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>

  <rect x="${padOuter}" y="${padOuter}"
        width="${width - padOuter * 2}" height="${height - padOuter * 2}"
        rx="10" fill="${bg}" stroke="${border}" filter="url(#shadow)"/>

  <text x="${padOuter + padInnerX}" y="${titleY}"
        font-family="${fontSans}" font-size="16" font-weight="700"
        fill="${title}" dominant-baseline="middle">
    ${esc(stats.login)}'s GitHub Statistics
  </text>

  <g>
    ${rowSvgs.join("\n")}
  </g>
</svg>`;
}
