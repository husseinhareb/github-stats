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
  const width = opts.width ?? 495;

  const bg = opts.bg ?? "#282A36";
  const border = opts.hideBorder ? "transparent" : (opts.border ?? "#E4E2E2");
  const title = opts.title ?? "#F76B92";
  const label = opts.label ?? "#F8F8F2";
  const value = opts.value ?? "#F8F8F2";
  const muted = opts.muted ?? "#77D5F5";

  const fontSans =
    "'Segoe UI', Ubuntu, Sans-Serif";
  const fontMono =
    "'Segoe UI', Ubuntu, Sans-Serif";

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

  // Font Awesome SVG icon paths (viewBox 0 0 16 16, scaled to fit)
  const icons = {
    // fa-star (regular)
    star: "M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z",
    // fa-code-fork
    fork: "M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm0 2.122a2.25 2.25 0 1 0-1.5 0v.878A2.25 2.25 0 0 0 5.75 8.5h1.5v2.128a2.251 2.251 0 1 0 1.5 0V8.5h1.5a2.25 2.25 0 0 0 2.25-2.25v-.878a2.25 2.25 0 1 0-1.5 0v.878a.75.75 0 0 1-.75.75h-4.5a.75.75 0 0 1-.75-.75v-.878zM8 12.75a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5zM10.5 4a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0z",
    // git-commit icon (circle with lines) for contributions
    commit: "M10.5 7.75a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zm1.43.75a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5h-3.32z",
    // fa-code (lines of code)
    code: "M4.72 3.22a.75.75 0 0 1 1.06 1.06L2.56 7.5l3.22 3.22a.75.75 0 1 1-1.06 1.06l-3.75-3.75a.75.75 0 0 1 0-1.06l3.75-3.75zm6.56 0a.75.75 0 1 0-1.06 1.06L13.44 7.5l-3.22 3.22a.75.75 0 1 0 1.06 1.06l3.75-3.75a.75.75 0 0 0 0-1.06l-3.75-3.75z",
    // octicon-repo (GitHub repository icon)
    repo: "M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z",
  };

  const rows: Array<{ iconPath: string; name: string; val: string; note?: string | null }> = [
    { iconPath: icons.star, name: "Total Stars Earned:", val: formatNumber(stats.stars) },
    { iconPath: icons.fork, name: "Total Forks:", val: formatNumber(stats.forks) },
    { iconPath: icons.commit, name: "All-time Contributions:", val: contribVal },
    {
      iconPath: icons.code,
      name: "Lines of Code Changed:",
      val: formatNumber(stats.locChanged),
      note: locNotes.join("\n"),
    },
    { iconPath: icons.repo, name: "Contributed Repositories:", val: reposWithContribVal },
  ];

  // Layout
  const padOuter = 0;
  const padInnerX = 25;

  const titleY = 35;

  const iconX = padOuter + padInnerX;
  const labelX = iconX + 24;
  const valueX = width - (padOuter + padInnerX);

  const rowFont = 14;
  const noteFont = 10;

  const rowGap = 25;
  const noteGap = 14;
  const extraAfterNote = 6;

  let y = 65;
  const parts: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    // animate each row with staggered delays
    const cls = `row r${i + 1}`;
    const rowLines: string[] = [];

    // SVG icon using path - positioned and scaled
    const iconSize = 14;
    rowLines.push(`
      <svg x="${iconX}" y="${y - iconSize / 2}" width="${iconSize}" height="${iconSize}" viewBox="0 0 16 16">
        <path fill="${muted}" d="${r.iconPath}"/>
      </svg>
      <text x="${labelX}" y="${y}" font-size="${rowFont}" fill="${label}"
            font-family="${fontSans}" dominant-baseline="middle" font-weight="600">${esc(r.name)}</text>
      <text x="${valueX}" y="${y}" font-size="${rowFont}" fill="${value}" text-anchor="end"
            font-family="${fontMono}" dominant-baseline="middle" font-weight="700">${esc(r.val)}</text>
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

  const height = y + 20;

  const style = `
  <![CDATA[
    @keyframes fadeIn {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    .row {
      opacity: 0;
      animation: fadeIn 300ms ease-in-out forwards;
    }

    .r1 { animation-delay: 150ms; }
    .r2 { animation-delay: 300ms; }
    .r3 { animation-delay: 450ms; }
    .r4 { animation-delay: 600ms; }
    .r5 { animation-delay: 750ms; }

    @media (prefers-reduced-motion: reduce) {
      .row { animation: none; opacity: 1; }
    }
  ]]>
  `;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
     xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="descId">
  <title id="descId">${esc(stats.login)}'s GitHub Stats</title>
  <style type="text/css">${style}</style>

  <rect x="0.5" y="0.5"
        width="${width - 1}" height="${height - 1}"
        rx="4.5" fill="${bg}" stroke="${border}" stroke-opacity="1"/>

  <text x="${padOuter + padInnerX}" y="${titleY}"
        font-family="${fontSans}" font-size="18" font-weight="700"
        fill="${title}">
    ${esc(stats.login)}'s GitHub Stats
  </text>

  <g>
    ${parts.join("\n")}
  </g>
</svg>`;
}
