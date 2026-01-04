const GITHUB_GRAPHQL = "https://api.github.com/graphql";
const GITHUB_REST = "https://api.github.com";

type Repo = {
  owner: string;
  name: string;
  fullName: string; // owner/name
  stars: number;
  forks: number;
  isFork: boolean;
  isPrivate: boolean;
};

type ContributorWeek = { a: number; d: number; c: number };
type ContributorStat = {
  author: null | { login: string };
  total: number; // commits
  weeks: ContributorWeek[];
};

type ViewerResponse = { login: string };

type RepoContribToNode = { nameWithOwner: string };
type ReposContributedToResponse = {
  user: {
    repositoriesContributedTo: {
      nodes: RepoContribToNode[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
};

type CreatedAtResponse = { user: { createdAt: string } };
type YearContribResponse = {
  user: {
    contributionsCollection: {
      contributionCalendar: { totalContributions: number };
    };
  };
};

async function restRequest<T>(path: string, token: string): Promise<{ res: Response; data: T }> {
  const res = await fetch(`${GITHUB_REST}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  });

  // some endpoints return 202 with no JSON body we can parse
  if (res.status === 202) {
    return { res, data: undefined as unknown as T };
  }

  const data = (await res.json()) as T;
  return { res, data };
}

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

function parseLinkHeader(link: string | null): Record<string, string> {
  if (!link) return {};
  const out: Record<string, string> = {};
  const parts = link.split(",");
  for (const p of parts) {
    const m = p.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (m) out[m[2]] = m[1];
  }
  return out;
}

async function paginateRest<T>(
  firstPath: string,
  token: string,
  maxPages = 10
): Promise<T[]> {
  let urlPath = firstPath;
  const all: T[] = [];
  for (let i = 0; i < maxPages; i++) {
    const { res, data } = await restRequest<T[]>(urlPath, token);
    if (!res.ok) break;
    all.push(...data);

    const links = parseLinkHeader(res.headers.get("link"));
    const nextUrl = links["next"];
    if (!nextUrl) break;

    // nextUrl is a full URL; convert to path+query
    const u = new URL(nextUrl);
    urlPath = `${u.pathname}${u.search}`;
  }
  return all;
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

async function getViewerLogin(token: string): Promise<string> {
  const { res, data } = await restRequest<ViewerResponse>("/user", token);
  if (!res.ok) throw new Error("Failed to read /user from GitHub. Check token permissions.");
  return data.login;
}

async function listAccessibleRepos(token: string, includeForks: boolean): Promise<Repo[]> {
  // Only works reliably for the authenticated user (viewer).
  // affiliation=owner,collaborator,organization_member gives broad access.
  const repos = await paginateRest<any>(
    "/user/repos?per_page=100&sort=pushed&direction=desc&affiliation=owner,collaborator,organization_member",
    token,
    20
  );

  return repos
    .map((r) => ({
      owner: r.owner.login as string,
      name: r.name as string,
      fullName: `${r.owner.login}/${r.name}`,
      stars: r.stargazers_count as number,
      forks: r.forks_count as number,
      isFork: r.fork as boolean,
      isPrivate: r.private as boolean,
    }))
    .filter((r) => (includeForks ? true : !r.isFork));
}

async function listContributedReposViaGraphQL(login: string, token: string): Promise<string[]> {
  // Best-effort: if GraphQL permissions block this, caller will catch and ignore.
  const query = /* GraphQL */ `
    query($login: String!, $cursor: String) {
      user(login: $login) {
        repositoriesContributedTo(
          first: 100
          after: $cursor
          includeUserRepositories: true
          contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, PULL_REQUEST_REVIEW]
        ) {
          nodes { nameWithOwner }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `;

  let cursor: string | null = null;
  const names: string[] = [];

  while (true) {
    const data = await graphqlRequest<ReposContributedToResponse>(query, { login, cursor }, token);
    for (const n of data.user.repositoriesContributedTo.nodes) names.push(n.nameWithOwner);
    if (!data.user.repositoriesContributedTo.pageInfo.hasNextPage) break;
    cursor = data.user.repositoriesContributedTo.pageInfo.endCursor;
  }

  return names;
}

async function getAllTimeContributions(login: string, token: string): Promise<number | null> {
  // Best-effort (GraphQL can be blocked by PAT settings). If blocked, return null.
  try {
    const createdAtQ = /* GraphQL */ `
      query($login: String!) { user(login: $login) { createdAt } }
    `;
    const created = await graphqlRequest<CreatedAtResponse>(createdAtQ, { login }, token);
    const createdAt = new Date(created.user.createdAt);
    const now = new Date();
    const windows = yearWindows(createdAt, now);

    const contribQ = /* GraphQL */ `
      query($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            contributionCalendar { totalContributions }
          }
        }
      }
    `;

    let total = 0;
    for (const [from, to] of windows) {
      const data = await graphqlRequest<YearContribResponse>(
        contribQ,
        { login, from: from.toISOString(), to: to.toISOString() },
        token
      );
      total += data.user.contributionsCollection.contributionCalendar.totalContributions ?? 0;
    }
    return total;
  } catch {
    return null;
  }
}

async function getRepoViews14Days(fullName: string, token: string): Promise<number | null> {
  // Requires repo admin permissions; if it fails, return null.
  try {
    const [owner, name] = fullName.split("/");
    const { res, data } = await restRequest<{ count: number }>(
      `/repos/${owner}/${name}/traffic/views`,
      token
    );
    if (!res.ok) return null;
    return typeof data.count === "number" ? data.count : null;
  } catch {
    return null;
  }
}

async function getContributorStatsForRepo(
  fullName: string,
  token: string
): Promise<{ status: "ok"; stats: ContributorStat[] } | { status: "pending" } | { status: "failed" }> {
  const [owner, name] = fullName.split("/");
  const { res, data } = await restRequest<ContributorStat[]>(
    `/repos/${owner}/${name}/stats/contributors`,
    token
  );

  if (res.status === 202) return { status: "pending" };
  if (!res.ok) return { status: "failed" };
  if (!Array.isArray(data)) return { status: "failed" };
  return { status: "ok", stats: data };
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

  // LOC across all your commits (additions+deletions) in scanned repos
  locChanged: number;
  commitsCounted: number;

  reposScanned: number;
  reposMatched: number;   // repos where you appear in contributor stats
  reposPending: number;   // 202 computing
  reposFailed: number;    // non-ok

  reposWithContributions: number; // same as reposMatched (kept for display)
  views14d: number | null;        // optional sum across repos (we keep single value or null)
};

export async function getGitHubStatistics(
  username: string,
  options?: {
    reposLimit?: number;
    includeForks?: boolean;
    includeContributedRepos?: boolean; // adds reposContributedTo list (best-effort)
    includeTraffic?: boolean;          // traffic/views (best-effort)
    concurrency?: number;              // contributor stats concurrency
  }
): Promise<GitHubStatistics> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Missing GITHUB_TOKEN env var");

  const reposLimit = options?.reposLimit ?? 50;
  const includeForks = options?.includeForks ?? false;
  const includeContributedRepos = options?.includeContributedRepos ?? true;
  const includeTraffic = options?.includeTraffic ?? false;
  const concurrency = options?.concurrency ?? 4;

  const viewer = await getViewerLogin(token);

  // For "all my changes" we expect token owner == username.
  // If not, we can still do partial public-only stats but it won’t be complete.
  if (viewer.toLowerCase() !== username.toLowerCase()) {
    throw new Error(
      `Token owner (${viewer}) does not match username (${username}). Use a token created from the same account as the username.`
    );
  }

  const accessible = await listAccessibleRepos(token, includeForks);

  // Merge in contributed repos (GraphQL) if enabled + available
  const repoSet = new Map<string, Repo>();
  for (const r of accessible) repoSet.set(r.fullName.toLowerCase(), r);

  if (includeContributedRepos) {
    try {
      const contributed = await listContributedReposViaGraphQL(username, token);
      for (const fullName of contributed) {
        const key = fullName.toLowerCase();
        if (!repoSet.has(key)) {
          // We don’t know stars/forks/private for these without extra REST calls;
          // but for LOC we only need fullName.
          const [owner, name] = fullName.split("/");
          repoSet.set(key, {
            owner,
            name,
            fullName,
            stars: 0,
            forks: 0,
            isFork: false,
            isPrivate: false,
          });
        }
      }
    } catch {
      // ignore: GraphQL may be blocked by PAT; LOC still works for accessible repos.
    }
  }

  // Prefer scanning most relevant repos first (those with known metadata / recently pushed)
  const reposAll = Array.from(repoSet.values()).slice(0, reposLimit);

  // Stars/Forks only meaningful for repos we actually fetched from /user/repos
  let totalStars = 0;
  let totalForks = 0;
  for (const r of reposAll) {
    totalStars += r.stars ?? 0;
    totalForks += r.forks ?? 0;
  }

  // Contributions all-time (best-effort)
  const contributionsAllTime = await getAllTimeContributions(username, token);

  // LOC: sum contributor stats across repos
  const targetLogin = username.toLowerCase();

  let locChanged = 0;
  let commitsCounted = 0;

  let reposMatched = 0;
  let reposPending = 0;
  let reposFailed = 0;

  const contribResults = await mapWithConcurrency(reposAll, concurrency, async (r) => {
    const res = await getContributorStatsForRepo(r.fullName, token);
    return { repo: r.fullName, res };
  });

  for (const item of contribResults) {
    const r = item.res;
    if (r.status === "pending") {
      reposPending += 1;
      continue;
    }
    if (r.status === "failed") {
      reposFailed += 1;
      continue;
    }

    const me = r.stats.find((x) => x.author?.login?.toLowerCase() === targetLogin);
    if (!me) continue;

    reposMatched += 1;
    commitsCounted += me.total ?? 0;

    for (const w of me.weeks ?? []) {
      locChanged += (w.a ?? 0) + (w.d ?? 0);
    }
  }

  // Traffic (best-effort): sum views across scanned repos
  let views14d: number | null = null;
  if (includeTraffic) {
    let sum = 0;
    let any = false;
    for (const r of reposAll) {
      const v = await getRepoViews14Days(r.fullName, token);
      if (typeof v === "number") {
        sum += v;
        any = true;
      }
    }
    views14d = any ? sum : null;
  }

  return {
    login: username,
    stars: totalStars,
    forks: totalForks,
    contributionsAllTime,

    locChanged,
    commitsCounted,

    reposScanned: reposAll.length,
    reposMatched,
    reposPending,
    reposFailed,

    reposWithContributions: reposMatched,
    views14d,
  };
}
