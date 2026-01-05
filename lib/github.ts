const GITHUB_GRAPHQL = "https://api.github.com/graphql";
const GITHUB_REST = "https://api.github.com";

type RepoRest = {
  full_name: string;
  fork: boolean;
  stargazers_count: number;
  forks_count: number;
};

type ContributorWeek = { a: number; d: number; c: number };
type ContributorStat = {
  author: null | { login: string };
  total: number; // commits
  weeks: ContributorWeek[];
};

type ViewerResponse = { login: string };

type CreatedAtResponse = { user: { createdAt: string } };
type YearContribResponse = {
  user: {
    contributionsCollection: {
      contributionCalendar: { totalContributions: number };
    };
  };
};

async function graphqlRequest<T>(
  query: string,
  variables: Record<string, unknown>,
  token: string
): Promise<T> {
  const res = await fetch(GITHUB_GRAPHQL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json: any = await res.json();
  if (!res.ok || json.errors) {
    const msg = json.errors?.map((e: any) => e.message).join("; ") || res.statusText;
    throw new Error(`GitHub GraphQL error: ${msg}`);
  }
  return json.data as T;
}

async function restRequest<T>(path: string, token: string): Promise<{ res: Response; data: T }> {
  const res = await fetch(`${GITHUB_REST}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  });

  // 202 endpoints sometimes return empty body; caller must handle via res.status.
  if (res.status === 202) return { res, data: undefined as unknown as T };

  const data = (await res.json()) as T;
  return { res, data };
}

function parseLinkHeader(link: string | null): Record<string, string> {
  if (!link) return {};
  const out: Record<string, string> = {};
  for (const part of link.split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (m) out[m[2]] = m[1];
  }
  return out;
}

async function paginateRest<T>(firstPath: string, token: string, maxPages = 20): Promise<T[]> {
  let path = firstPath;
  const out: T[] = [];

  for (let i = 0; i < maxPages; i++) {
    const { res, data } = await restRequest<T[]>(path, token);
    if (!res.ok) break;

    out.push(...data);

    const links = parseLinkHeader(res.headers.get("link"));
    if (!links.next) break;

    const u = new URL(links.next);
    path = `${u.pathname}${u.search}`;
  }

  return out;
}

function yearWindows(fromDate: Date, toDate: Date): Array<[Date, Date]> {
  const windows: Array<[Date, Date]> = [];
  const start = new Date(fromDate);
  const end = new Date(toDate);

  let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  while (cur < end) {
    const next = new Date(Date.UTC(cur.getUTCFullYear() + 1, cur.getUTCMonth(), cur.getUTCDate()));
    const wEnd = next < end ? next : end;
    windows.push([new Date(cur), new Date(wEnd)]);
    cur = next;
  }
  return windows;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getViewerLogin(token: string): Promise<string> {
  const { res, data } = await restRequest<ViewerResponse>("/user", token);
  if (!res.ok) throw new Error("Failed to read /user from GitHub. Check token permissions.");
  return data.login;
}

async function getOwnedRepoTotals(token: string) {
  const owned = await paginateRest<RepoRest>(
    "/user/repos?per_page=100&sort=pushed&direction=desc&affiliation=owner",
    token,
    50
  );

  let stars = 0;
  let forks = 0;

  for (const r of owned) {
    if (r.fork) continue; // keep totals for non-forks
    stars += r.stargazers_count ?? 0;
    forks += r.forks_count ?? 0;
  }

  return { stars, forks };
}

async function listAccessibleReposForScan(token: string, includeForks: boolean) {
  const repos = await paginateRest<RepoRest>(
    "/user/repos?per_page=100&sort=pushed&direction=desc&affiliation=owner,collaborator,organization_member",
    token,
    50
  );

  return repos
    .filter((r) => (includeForks ? true : !r.fork))
    .map((r) => r.full_name);
}

async function getAllTimeContributions(login: string, token: string): Promise<number | null> {
  try {
    const createdAtQ = /* GraphQL */ `
      query($login: String!) { user(login: $login) { createdAt } }
    `;
    const created = await graphqlRequest<CreatedAtResponse>(createdAtQ, { login }, token);
    const createdAt = new Date(created.user.createdAt);

    const contribQ = /* GraphQL */ `
      query($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            contributionCalendar { totalContributions }
          }
        }
      }
    `;

    const windows = yearWindows(createdAt, new Date());
    let total = 0;

    for (const [from, to] of windows) {
      const d = await graphqlRequest<YearContribResponse>(
        contribQ,
        { login, from: from.toISOString(), to: to.toISOString() },
        token
      );
      total += d.user.contributionsCollection.contributionCalendar.totalContributions ?? 0;
    }

    return total;
  } catch {
    return null;
  }
}

async function getContributorStatsForRepo(
  fullName: string,
  token: string
): Promise<{ status: "ok"; stats: ContributorStat[] } | { status: "pending" } | { status: "failed" }> {
  const [owner, name] = fullName.split("/");

  // Retry because 202 is common (GitHub computing stats)
  const retries = 4;
  const delays = [300, 600, 1200, 2000];

  for (let attempt = 0; attempt <= retries; attempt++) {
    const { res, data } = await restRequest<ContributorStat[]>(
      `/repos/${owner}/${name}/stats/contributors`,
      token
    );

    if (res.status === 202) {
      if (attempt === retries) return { status: "pending" };
      await sleep(delays[Math.min(attempt, delays.length - 1)]);
      continue;
    }

    if (!res.ok) return { status: "failed" };
    if (!Array.isArray(data)) return { status: "failed" };
    return { status: "ok", stats: data };
  }

  return { status: "pending" };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (true) {
      const cur = idx++;
      if (cur >= items.length) return;
      results[cur] = await fn(items[cur]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export type GitHubStatistics = {
  login: string;

  stars: number;
  forks: number;

  contributionsAllTime: number | null;

  locChanged: number;     // additions + deletions
  commitsCounted: number; // commits attributed to you (from contributor stats)

  reposScanned: number;
  reposMatched: number; // repos where you appear in contributor stats
  reposPending: number; // 202 computing
  reposFailed: number;

  // IMPORTANT: keep this consistent with LOC source:
  reposWithContributions: number; // == reposMatched
};

export async function getGitHubStatistics(
  username: string,
  options?: {
    reposLimit?: number;
    includeForks?: boolean;
    concurrency?: number;
  }
): Promise<GitHubStatistics> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Missing GITHUB_TOKEN env var");

  const reposLimit = options?.reposLimit ?? 50;
  const includeForks = options?.includeForks ?? false;
  const concurrency = options?.concurrency ?? 4;

  const viewer = await getViewerLogin(token);
  if (viewer.toLowerCase() !== username.toLowerCase()) {
    throw new Error(
      `Token owner (${viewer}) does not match username (${username}). Use a token from the same account.`
    );
  }

  const { stars, forks } = await getOwnedRepoTotals(token);
  const contributionsAllTime = await getAllTimeContributions(username, token);

  const allRepos = await listAccessibleReposForScan(token, includeForks);
  const reposToScan = allRepos.slice(0, Math.max(0, reposLimit));

  const target = username.toLowerCase();

  let locChanged = 0;
  let commitsCounted = 0;

  let reposMatched = 0;
  let reposPending = 0;
  let reposFailed = 0;

  const results = await mapWithConcurrency(
    reposToScan,
    concurrency,
    async (fullName) => ({ fullName, res: await getContributorStatsForRepo(fullName, token) })
  );

  for (const item of results) {
    const r = item.res;

    if (r.status === "pending") {
      reposPending += 1;
      continue;
    }
    if (r.status === "failed") {
      reposFailed += 1;
      continue;
    }

    const me = r.stats.find((x) => x.author?.login?.toLowerCase() === target);
    if (!me) continue;

    reposMatched += 1;
    commitsCounted += me.total ?? 0;

    for (const w of me.weeks ?? []) {
      locChanged += (w.a ?? 0) + (w.d ?? 0);
    }
  }

  return {
    login: username,
    stars,
    forks,
    contributionsAllTime,
    locChanged,
    commitsCounted,
    reposScanned: reposToScan.length,
    reposMatched,
    reposPending,
    reposFailed,
    reposWithContributions: reposMatched, // ✅ consistent with LOC scan
  };
}
