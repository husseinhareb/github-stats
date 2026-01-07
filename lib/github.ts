const GITHUB_GRAPHQL = "https://api.github.com/graphql";
const GITHUB_REST = "https://api.github.com";

// === In-memory cache with TTL ===
interface CacheEntry<T> {
  data: T;
  expiry: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const SHORT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes for pending repos

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T, ttl = CACHE_TTL): void {
  cache.set(key, { data, expiry: Date.now() + ttl });
}

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

// Pre-warm cache for contributor stats (fire-and-forget)
async function prewarmContributorStats(repos: string[], token: string, concurrency: number): Promise<void> {
  // Fire requests to trigger GitHub's computation without waiting
  await mapWithConcurrency(repos.slice(0, Math.min(repos.length, 20)), concurrency * 2, async (fullName) => {
    const [owner, name] = fullName.split("/");
    try {
      await fetch(`${GITHUB_REST}/repos/${owner}/${name}/stats/contributors`, {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `bearer ${token}`,
          "x-github-api-version": "2022-11-28",
        },
      });
    } catch {}
  });
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
  // Check cache
  const cacheKey = `contrib-all:${login.toLowerCase()}`;
  const cached = getCached<number>(cacheKey);
  if (cached !== null) return cached;

  try {
    const createdAtQ = /* GraphQL */ `
      query($login: String!) { user(login: $login) { createdAt } }
    `;
    const created = await graphqlRequest<CreatedAtResponse>(createdAtQ, { login }, token);
    const createdAt = new Date(created.user.createdAt);

    const windows = yearWindows(createdAt, new Date());
    
    // Batch all year queries in parallel (much faster than sequential)
    const contribQ = /* GraphQL */ `
      query($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            contributionCalendar { totalContributions }
          }
        }
      }
    `;

    const results = await Promise.all(
      windows.map(([from, to]) =>
        graphqlRequest<YearContribResponse>(
          contribQ,
          { login, from: from.toISOString(), to: to.toISOString() },
          token
        ).catch(() => null)
      )
    );

    let total = 0;
    for (const d of results) {
      if (d) {
        total += d.user.contributionsCollection.contributionCalendar.totalContributions ?? 0;
      }
    }

    setCache(cacheKey, total, CACHE_TTL);
    return total;
  } catch {
    return null;
  }
}

async function getContributorStatsForRepo(
  fullName: string,
  token: string
): Promise<{ status: "ok"; stats: ContributorStat[] } | { status: "pending" } | { status: "failed" }> {
  // Check cache first
  const cacheKey = `contrib:${fullName}`;
  const cached = getCached<{ status: "ok"; stats: ContributorStat[] } | { status: "pending" } | { status: "failed" }>(cacheKey);
  if (cached) return cached;

  const [owner, name] = fullName.split("/");

  // Reduced retries: 2 attempts with shorter delays (max ~500ms)
  const retries = 2;
  const delays = [100, 250];

  for (let attempt = 0; attempt <= retries; attempt++) {
    const { res, data } = await restRequest<ContributorStat[]>(
      `/repos/${owner}/${name}/stats/contributors`,
      token
    );

    if (res.status === 202) {
      if (attempt === retries) {
        const result = { status: "pending" as const };
        setCache(cacheKey, result, SHORT_CACHE_TTL);
        return result;
      }
      await sleep(delays[Math.min(attempt, delays.length - 1)]);
      continue;
    }

    if (!res.ok) {
      const result = { status: "failed" as const };
      setCache(cacheKey, result, SHORT_CACHE_TTL);
      return result;
    }
    if (!Array.isArray(data)) {
      const result = { status: "failed" as const };
      setCache(cacheKey, result, SHORT_CACHE_TTL);
      return result;
    }
    
    const result = { status: "ok" as const, stats: data };
    setCache(cacheKey, result, CACHE_TTL);
    return result;
  }

  const result = { status: "pending" as const };
  setCache(cacheKey, result, SHORT_CACHE_TTL);
  return result;
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
  // Increased default concurrency for better performance
  const concurrency = Math.max(options?.concurrency ?? 8, 4);

  // Check full stats cache first
  const statsCacheKey = `stats:${username.toLowerCase()}:${reposLimit}:${includeForks}`;
  const cachedStats = getCached<GitHubStatistics>(statsCacheKey);
  if (cachedStats) return cachedStats;

  const viewer = await getViewerLogin(token);
  if (viewer.toLowerCase() !== username.toLowerCase()) {
    throw new Error(
      `Token owner (${viewer}) does not match username (${username}). Use a token from the same account.`
    );
  }

  // Run all independent fetches in parallel for maximum speed
  const [repoTotals, contributionsAllTime, allRepos] = await Promise.all([
    getOwnedRepoTotals(token),
    getAllTimeContributions(username, token),
    listAccessibleReposForScan(token, includeForks),
  ]);

  const { stars, forks } = repoTotals;
  const reposToScan = allRepos.slice(0, Math.max(0, reposLimit));

  // Pre-warm contributor stats (fire-and-forget to trigger GitHub computation)
  prewarmContributorStats(reposToScan, token, concurrency).catch(() => {});

  const target = username.toLowerCase();

  let locChanged = 0;
  let commitsCounted = 0;

  let reposMatched = 0;
  let reposPending = 0;
  let reposFailed = 0;

  // Use higher concurrency for contributor stats
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

  const finalStats: GitHubStatistics = {
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

  // Only cache if we have good data (low pending/failed ratio)
  const successRate = reposToScan.length > 0 
    ? (reposMatched + reposFailed) / reposToScan.length 
    : 1;
  if (successRate > 0.5) {
    setCache(statsCacheKey, finalStats, CACHE_TTL);
  }

  return finalStats;
}
