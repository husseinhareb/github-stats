const GITHUB_GRAPHQL = "https://api.github.com/graphql";
const GITHUB_REST = "https://api.github.com";

type RepoNode = {
  nameWithOwner: string;
  stargazerCount: number;
  forkCount: number;
  isFork: boolean;
};

async function graphqlRequest<T>(
  query: string,
  variables: Record<string, any>,
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

  const json = await res.json();
  if (!res.ok || json.errors) {
    const msg =
      json.errors?.map((e: any) => e.message).join("; ") || res.statusText;
    throw new Error(`GitHub GraphQL error: ${msg}`);
  }
  return json.data as T;
}

function yearWindows(fromDate: Date, toDate: Date): Array<[Date, Date]> {
  const windows: Array<[Date, Date]> = [];
  const start = new Date(fromDate);
  const end = new Date(toDate);

  // normalize to UTC day boundary
  let cur = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
  );

  while (cur < end) {
    const next = new Date(
      Date.UTC(cur.getUTCFullYear() + 1, cur.getUTCMonth(), cur.getUTCDate())
    );
    const wEnd = next < end ? next : end;
    windows.push([new Date(cur), new Date(wEnd)]);
    cur = next;
  }

  return windows;
}

async function getRepoTotals(login: string, token: string) {
  const query = /* GraphQL */ `
    query($login: String!, $cursor: String) {
      user(login: $login) {
        repositories(
          first: 100
          after: $cursor
          ownerAffiliations: OWNER
          isFork: false
          orderBy: { field: PUSHED_AT, direction: DESC }
        ) {
          nodes {
            nameWithOwner
            stargazerCount
            forkCount
            isFork
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  `;

  let cursor: string | null = null;
  let stars = 0;
  let forks = 0;
  const repos: RepoNode[] = [];

  while (true) {
    const data = await graphqlRequest<{
      user: {
        repositories: {
          nodes: RepoNode[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      };
    }>(query, { login, cursor }, token);

    const r = data.user.repositories;

    for (const repo of r.nodes) {
      stars += repo.stargazerCount;
      forks += repo.forkCount;
      repos.push(repo);
    }

    if (!r.pageInfo.hasNextPage) break;
    cursor = r.pageInfo.endCursor;
  }

  return { stars, forks, repos };
}

async function getReposContributedToCount(login: string, token: string) {
  const query = /* GraphQL */ `
    query($login: String!) {
      user(login: $login) {
        repositoriesContributedTo(
          contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, PULL_REQUEST_REVIEW]
          includeUserRepositories: true
        ) {
          totalCount
        }
      }
    }
  `;

  const data = await graphqlRequest<{
    user: { repositoriesContributedTo: { totalCount: number } };
  }>(query, { login }, token);

  return data.user.repositoriesContributedTo.totalCount ?? 0;
}

async function getAccountCreatedAt(login: string, token: string) {
  const query = /* GraphQL */ `
    query($login: String!) {
      user(login: $login) {
        createdAt
      }
    }
  `;

  const data = await graphqlRequest<{ user: { createdAt: string } }>(
    query,
    { login },
    token
  );

  return new Date(data.user.createdAt);
}

async function getAllTimeContributions(login: string, token: string) {
  // GitHub doesn't provide a single "all-time contributions" value directly.
  // We sum yearly contributionCalendar.totalContributions from createdAt -> now.
  const createdAt = await getAccountCreatedAt(login, token);
  const now = new Date();
  const windows = yearWindows(createdAt, now);

  const contribQuery = /* GraphQL */ `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
          }
        }
      }
    }
  `;

  let total = 0;
  for (const [from, to] of windows) {
    const data = await graphqlRequest<{
      user: {
        contributionsCollection: {
          contributionCalendar: { totalContributions: number };
        };
      };
    }>(contribQuery, { login, from: from.toISOString(), to: to.toISOString() }, token);

    total += data.user.contributionsCollection.contributionCalendar
      .totalContributions ?? 0;
  }

  return total;
}

async function getMergedPrLocChanged(
  login: string,
  token: string,
  maxPrs: number
) {
  const query = /* GraphQL */ `
    query($login: String!, $cursor: String) {
      user(login: $login) {
        pullRequests(
          first: 100
          after: $cursor
          states: [MERGED]
          orderBy: { field: CREATED_AT, direction: DESC }
        ) {
          nodes {
            additions
            deletions
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  `;

  let cursor: string | null = null;
  let scanned = 0;
  let loc = 0;

  while (true) {
    const data = await graphqlRequest<{
      user: {
        pullRequests: {
          nodes: Array<{ additions: number; deletions: number }>;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      };
    }>(query, { login, cursor }, token);

    const prs = data.user.pullRequests;

    for (const pr of prs.nodes) {
      loc += (pr.additions ?? 0) + (pr.deletions ?? 0);
      scanned += 1;
      if (scanned >= maxPrs) return { loc, scanned };
    }

    if (!prs.pageInfo.hasNextPage) break;
    cursor = prs.pageInfo.endCursor;
  }

  return { loc, scanned };
}

async function getRepoViews14Days(
  repos: RepoNode[],
  token: string,
  reposLimit: number
) {
  // Traffic API: GET /repos/{owner}/{repo}/traffic/views
  // Only works if token has access. We'll best-effort sum across the first N repos.
  let totalViews = 0;
  let attempted = 0;
  let succeeded = 0;

  const slice = repos.slice(0, Math.max(0, Math.min(reposLimit, repos.length)));

  for (const r of slice) {
    attempted += 1;
    try {
      const [owner, name] = r.nameWithOwner.split("/");
      const res = await fetch(
        `${GITHUB_REST}/repos/${owner}/${name}/traffic/views`,
        {
          headers: {
            accept: "application/vnd.github+json",
            authorization: `bearer ${token}`,
            "x-github-api-version": "2022-11-28",
          },
        }
      );

      if (!res.ok) continue;
      const json = await res.json();
      if (typeof json.count === "number") {
        totalViews += json.count;
        succeeded += 1;
      }
    } catch {
      // ignore failures per repo
    }
  }

  return { totalViews, attempted, succeeded };
}

export type GitHubStatistics = {
  login: string;
  stars: number;
  forks: number;
  contributionsAllTime: number;
  locChanged: number;
  locPrsCounted: number;
  reposContributedTo: number;
  views14d: null | { totalViews: number; attempted: number; succeeded: number };
};

export async function getGitHubStatistics(
  login: string,
  options?: {
    includeTraffic?: boolean;
    reposLimit?: number;
    maxPrs?: number;
  }
): Promise<GitHubStatistics> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Missing GITHUB_TOKEN env var");

  const includeTraffic = options?.includeTraffic ?? false;
  const reposLimit = options?.reposLimit ?? 25;
  const maxPrs = options?.maxPrs ?? 400;

  const [{ stars, forks, repos }, reposContributedTo, contributionsAllTime, prLoc] =
    await Promise.all([
      getRepoTotals(login, token),
      getReposContributedToCount(login, token),
      getAllTimeContributions(login, token),
      getMergedPrLocChanged(login, token, maxPrs),
    ]);

  let views14d: GitHubStatistics["views14d"] = null;
  if (includeTraffic) {
    views14d = await getRepoViews14Days(repos, token, reposLimit);
  }

  return {
    login,
    stars,
    forks,
    contributionsAllTime,
    locChanged: prLoc.loc,
    locPrsCounted: prLoc.scanned,
    reposContributedTo,
    views14d,
  };
}
