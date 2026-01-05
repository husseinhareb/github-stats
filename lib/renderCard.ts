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

  const contribVal =
    stats.contributionsAllTime === null ? "—" : formatNumber(stats.contributionsAllTime);

  // ✅ NEW: repo with contributions is now consistent with LOC scan
  // (it equals reposMatched in lib/github.ts)
  const reposWithContribVal = formatNumber(stats.reposWithContributions);

  const locNotes: string[] = [];
  locNotes.push(
    `from ${formatNumber(stats.commitsCounted)} commits across ${stats.reposMatched}/${stats.reposScanned} repos`
  );
  if (stats.reposPending > 0) {
    locNotes.push(`${stats.reposPending} repos pending stats (GitHub computing)`);
  }
  if (stats.reposFailed > 0) {
    locNotes.push(`${stats.reposFailed} repos failed to read`);
  }

  const rows: Array<{ icon: string; name: string; val: string; note?: string | null }> = [
    { icon: "☆", name: "Stars", val: formatNumber(stats.stars) },
    { icon: "⑂", name: "Forks", val: formatNumber(stats.forks) },
    { icon: "⤴", name: "All-time contributions", val: contribVal },
    {
      icon: "+",
      name: "Lines of code changed",
      val: formatNumber(stats.locChanged),
      note: locNotes.join("\n"),
    },
    { icon: "▣", name: "Repositories with contributions", val: reposWithContribVal },
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

  const rowGap = 22;
  const noteGap = 14;
  const extraAfterNote = 6;

  let y = 72;
  const parts: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    // animate each row with staggered delays
    const cls = `row r${i + 1}`;
    const rowLines: string[] = [];

    rowLines.push(`
      <text x="${iconX}" y="${y}" font-size="${rowFont}" fill="${muted}"
            font-family="${fontSans}" dominant-baseline="middle">${esc(r.icon)}</text>
      <text x="${labelX}" y="${y}" font-size="${rowFont}" fill="${label}"
            font-family="${fontSans}" dominant-baseline="middle">${esc(r.name)}</text>
      <text x="${valueX}" y="${y}" font-size="${rowFont}" fill="${value}" text-anchor="end"
            font-family="${fontMono}" dominant-baseline="middle">${esc(r.val)}</text>
    `);

    const noteLines = r.note ? String(r.note).split("\n") : [];
    if (noteLines.length) {
      for (let j = 0; j < noteLines.length; j++) {
        rowLines.push(`
          <text x="${labelX}" y="${y + noteGap + j * (noteFont + 4)}"
                font-size="${noteFont}" fill="${muted}"
                font-family="${fontSans}" dominant-baseline="middle">${esc(noteLines[j])}</text>
        `);
      }

      parts.push(`<g class="${cls}">${rowLines.join("\n")}</g>`);
      y += rowGap + noteGap + (noteLines.length - 1) * (noteFont + 4) + extraAfterNote;
    } else {
      parts.push(`<g class="${cls}">${rowLines.join("\n")}</g>`);
      y += rowGap;
    }
  }

  const height = y + 24;

  const style = `
  <![CDATA[
    @keyframes slideRightIn {
      from { opacity: 0; transform: translateX(-18px); }
      to   { opacity: 1; transform: translateX(0px); }
    }

    .row {
      opacity: 0;
      transform: translateX(-18px);
      transform-box: fill-box;
      transform-origin: center;
      animation: slideRightIn 600ms ease-out forwards;
    }

    .r1 { animation-delay: 0ms; }
    .r2 { animation-delay: 60ms; }
    .r3 { animation-delay: 120ms; }
    .r4 { animation-delay: 180ms; }
    .r5 { animation-delay: 240ms; }

    @media (prefers-reduced-motion: reduce) {
      .row { animation: none; opacity: 1; transform: none; }
    }
  ]]>
  `;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
     xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision">
  <defs>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="2" stdDeviation="6" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>

  <style type="text/css">${style}</style>

  <rect x="${padOuter}" y="${padOuter}"
        width="${width - padOuter * 2}" height="${height - padOuter * 2}"
        rx="10" fill="${bg}" stroke="${border}" filter="url(#shadow)"/>

  <text x="${padOuter + padInnerX}" y="${titleY}"
        font-family="${fontSans}" font-size="16" font-weight="700"
        fill="${title}" dominant-baseline="middle">
    ${esc(stats.login)}'s GitHub Statistics
  </text>

  <g>
    ${parts.join("\n")}
  </g>
</svg>`;
}
