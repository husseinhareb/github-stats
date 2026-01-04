const GITHUB_GRAPHQL = "https://api.github.com/graphql";
const GITHUB_REST = "https://api.github.com";

type RepoNode = {
  nameWithOwner: string;
  stargazerCount: number;
  forkCount: number;
  isFork: boolean;
};

type PageInfo = {
  hasNextPage: boolean;
  endCursor: string | null;
};

type RepoTotalsResponse = {
  user: {
    repositories: {
      nodes: RepoNode[];
      pageInfo: PageInfo;
    };
  };
};

type ReposContributedToResponse = {
  user: {
    repositoriesContributedTo: {
      totalCount: number;
    };
  };
};

type UserCreatedAtResponse = {
  user: {
    createdAt: string;
  };
};

type YearContribResponse = {
  user: {
    contributionsCollection: {
      contributionCalendar: {
        totalContributions: number;
      };
    };
  };
};

type MergedPrsResponse = {
  user: {
    pullRequests: {
      nodes: Array<{ additions: number; deletions: number }>;
      pageInfo: PageInfo;
    };
  };
};

type UserIdResponse = {
  user: {
    id: string;
  };
};

type RepoCommitHistoryResponse = {
  repository: {
    defaultBranchRef: null | {
      target: null | {
        history: {
          nodes: Array<{ additions: number; deletions: number }>;
          pageInfo: PageInfo;
        };
      };
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
    const data: RepoTotalsResponse = await graphqlRequest(
      query,
      { login, cursor },
      token
    );

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

  const data: ReposContributedToResponse = await graphqlRequest(
    query,
    { login },
    token
  );

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

  const data: UserCreatedAtResponse = await graphqlRequest(query, { login }, token);
  return new Date(data.user.createdAt);
}

async function getAllTimeContributions(login: string, token: string) {
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
    const data: YearContribResponse = await graphqlRequest(
      contribQuery,
      { login, from: from.toISOString(), to: to.toISOString() },
      token
    );

    total +=
      data.user.contributionsCollection.contributionCalendar.totalContributions ??
      0;
  }

  return total;
}

async function getMergedPrLocChanged(login: string, token: string, maxPrs: number) {
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
    const data: MergedPrsResponse = await graphqlRequest(
      query,
      { login, cursor },
      token
    );

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

async function getUserNodeId(login: string, token: string) {
  const q = /* GraphQL */ `
    query($login: String!) {
      user(login: $login) { id }
    }
  `;

  const data: UserIdResponse = await graphqlRequest(q, { login }, token);
  return data.user.id;
}

async function getCommitLocChangedFromDefaultBranches(
  login: string,
  token: string,
  repos: { nameWithOwner: string }[],
  opts: { reposLimit: number; maxCommitsPerRepo: number }
) {
  const userId = await getUserNodeId(login, token);

  const q = /* GraphQL */ `
    query($owner: String!, $name: String!, $userId: ID!, $cursor: String) {
      repository(owner: $owner, name: $name) {
        defaultBranchRef {
          target {
            ... on Commit {
              history(first: 100, after: $cursor, author: { id: $userId }) {
                nodes { additions deletions }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        }
      }
    }
  `;

  let loc = 0;
  let commitsCounted = 0;
  let reposScanned = 0;

  const slice = repos.slice(0, Math.min(opts.reposLimit, repos.length));

  for (const r of slice) {
    const [owner, name] = r.nameWithOwner.split("/");
    reposScanned += 1;

    let cursor: string | null = null;
    let perRepoCount = 0;

    while (true) {
      const data: RepoCommitHistoryResponse = await graphqlRequest(
        q,
        { owner, name, userId, cursor },
        token
      );

      const history = data.repository?.defaultBranchRef?.target?.history;
      if (!history) break;

      for (const c of history.nodes) {
        loc += (c.additions ?? 0) + (c.deletions ?? 0);
        commitsCounted += 1;
        perRepoCount += 1;
        if (perRepoCount >= opts.maxCommitsPerRepo) break;
      }

      if (perRepoCount >= opts.maxCommitsPerRepo) break;
      if (!history.pageInfo.hasNextPage) break;

      cursor = history.pageInfo.endCursor;
    }
  }

  return { loc, commitsCounted, reposScanned };
}

async function getRepoViews14Days(repos: RepoNode[], token: string, reposLimit: number) {
  let totalViews = 0;
  let attempted = 0;
  let succeeded = 0;

  const slice = repos.slice(0, Math.min(reposLimit, repos.length));

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
      const json: any = await res.json();

      if (typeof json.count === "number") {
        totalViews += json.count;
        succeeded += 1;
      }
    } catch {
      // ignore per-repo failure
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
  locItemsCounted: number;
  locSource: "prs" | "commits";

  reposContributedTo: number;
  views14d: null | { totalViews: number; attempted: number; succeeded: number };
};

export async function getGitHubStatistics(
  login: string,
  options?: {
    includeTraffic?: boolean;
    reposLimit?: number;

    maxPrs?: number;

    locSource?: "prs" | "commits";
    maxCommitsPerRepo?: number;
  }
): Promise<GitHubStatistics> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Missing GITHUB_TOKEN env var");

  const includeTraffic = options?.includeTraffic ?? false;
  const reposLimit = options?.reposLimit ?? 25;

  const locSource = options?.locSource ?? "prs";
  const maxPrs = options?.maxPrs ?? 400;
  const maxCommitsPerRepo = options?.maxCommitsPerRepo ?? 200;

  const [{ stars, forks, repos }, reposContributedTo, contributionsAllTime] =
    await Promise.all([
      getRepoTotals(login, token),
      getReposContributedToCount(login, token),
      getAllTimeContributions(login, token),
    ]);

  let locChanged = 0;
  let locItemsCounted = 0;

  if (locSource === "commits") {
    const commitLoc = await getCommitLocChangedFromDefaultBranches(
      login,
      token,
      repos,
      { reposLimit, maxCommitsPerRepo }
    );
    locChanged = commitLoc.loc;
    locItemsCounted = commitLoc.commitsCounted;
  } else {
    const prLoc = await getMergedPrLocChanged(login, token, maxPrs);
    locChanged = prLoc.loc;
    locItemsCounted = prLoc.scanned;
  }

  let views14d: GitHubStatistics["views14d"] = null;
  if (includeTraffic) {
    views14d = await getRepoViews14Days(repos, token, reposLimit);
  }

  return {
    login,
    stars,
    forks,
    contributionsAllTime,
    locChanged,
    locItemsCounted,
    locSource,
    reposContributedTo,
    views14d,
  };
}
