/**
 * GitHub service for fetching repository activity data
 * Uses GitHub REST API v3 with personal access token
 */

interface FileChange {
  filename: string;
  status: string; // added, modified, removed, renamed
  additions: number;
  deletions: number;
}

interface CommitStats {
  additions: number;
  deletions: number;
  total: number;
  files: FileChange[];
}

interface Commit {
  sha: string;
  repo: string;
  author: {
    name: string;
    email: string;
    date: string;
  };
  message: string;
  stats?: CommitStats;
}

interface PullRequest {
  number: number;
  repo: string;
  title: string;
  body: string;
  author: string;
  mergedAt: string;
  branch: string;
}

interface RepoInfo {
  owner: string;
  repo: string;
}

const REPO_LIST: RepoInfo[] = [
  { owner: 'SOFware', repo: 'sofjtac' },
  { owner: 'SOFware', repo: 'qualify' },
  { owner: 'SOFware', repo: 'FORGE' },
  { owner: 'SOFware', repo: 'skedify' },
  { owner: 'SOFware', repo: 'discharger' },
  { owner: 'SOFware', repo: 'activerecord-null' },
  { owner: 'SOFware', repo: 'sof-mcm' },
  { owner: 'SOFware', repo: 'close_encounters' },
  { owner: 'SOFware', repo: 'gov_codes' },
  { owner: 'SOFware', repo: 'pundit-plus' },
  { owner: 'SOFware', repo: 'rails-plant_uml' },
  { owner: 'SOFware', repo: 'sof_connect' },
  { owner: 'SOFware', repo: 'sof-cycle' },
  { owner: 'SOFware', repo: 'newshound' },
  { owner: 'SOFware', repo: 'air_support' },
  { owner: 'SOFware', repo: 'contours' },
  { owner: 'SOFware', repo: 'reissue' },
  { owner: 'SOFware', repo: 'etl-ruby' },
  { owner: 'SOFware', repo: 'flipbook' },
  { owner: 'SOFware', repo: 'tp2-web' },
  { owner: 'SOFware', repo: 'tp2-api' },
  { owner: 'SOFware', repo: 'FORGE-AF-CLOUD' },
  { owner: 'SOFware', repo: 'pipeline' },
  { owner: 'SOFware', repo: 'talonpoint' },
];

/**
 * Make an authenticated request to the GitHub API
 */
async function makeGitHubRequest(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is not set');
  }

  const response = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'seans-bots-weekly-dev-summary',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `GitHub API error: ${response.status} ${response.statusText} - ${errorBody}`
    );
  }

  return response;
}

/**
 * Fetch commits for a repository within a date range
 */
async function getCommits(
  owner: string,
  repo: string,
  since: string,
  until: string
): Promise<Commit[]> {
  const allCommits: Commit[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      since,
      until,
      per_page: '100',
      page: String(page),
    });

    try {
      const response = await makeGitHubRequest(
        `/repos/${owner}/${repo}/commits?${params}`
      );
      const data = await response.json();

      if (!Array.isArray(data) || data.length === 0) {
        hasMore = false;
        break;
      }

      for (const commit of data) {
        if (commit.commit?.author) {
          allCommits.push({
            sha: commit.sha,
            repo: repo,
            author: {
              name: commit.commit.author.name || '',
              email: commit.commit.author.email || '',
              date: commit.commit.author.date || '',
            },
            message: commit.commit.message || '',
          });
        }
      }

      // Check if there are more pages
      const linkHeader = response.headers.get('Link');
      hasMore = linkHeader?.includes('rel="next"') ?? false;
      page++;

      // Rate limit protection
      await new Promise(r => setTimeout(r, 100));
    } catch (error) {
      // Log error but don't fail - some repos may have no commits
      console.error(`Error fetching commits for ${owner}/${repo}:`, error);
      hasMore = false;
    }
  }

  return allCommits;
}

/**
 * Fetch merged pull requests for a repository within a date range
 */
async function getMergedPRs(
  owner: string,
  repo: string,
  since: Date
): Promise<PullRequest[]> {
  const mergedPRs: PullRequest[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      state: 'closed',
      sort: 'updated',
      direction: 'desc',
      per_page: '100',
      page: String(page),
    });

    try {
      const response = await makeGitHubRequest(
        `/repos/${owner}/${repo}/pulls?${params}`
      );
      const data = await response.json();

      if (!Array.isArray(data) || data.length === 0) {
        hasMore = false;
        break;
      }

      for (const pr of data) {
        // Only include merged PRs within the date range
        if (pr.merged_at && new Date(pr.merged_at) >= since) {
          mergedPRs.push({
            number: pr.number,
            repo: repo,
            title: pr.title || '',
            body: pr.body || '',
            author: pr.user?.login || '',
            mergedAt: pr.merged_at,
            branch: pr.head?.ref || '',
          });
        }
      }

      // Check if there are more pages and if the oldest PR in this page
      // is still within our date range
      const linkHeader = response.headers.get('Link');
      const hasNextPage = linkHeader?.includes('rel="next"') ?? false;
      const oldestPR = data[data.length - 1];
      const oldestUpdated = oldestPR?.updated_at
        ? new Date(oldestPR.updated_at)
        : new Date(0);

      // Stop if no more pages or if we've gone past our date range
      hasMore = hasNextPage && oldestUpdated >= since;
      page++;

      // Rate limit protection
      await new Promise(r => setTimeout(r, 100));
    } catch (error) {
      console.error(`Error fetching PRs for ${owner}/${repo}:`, error);
      hasMore = false;
    }
  }

  return mergedPRs;
}

/**
 * Fetch the CHANGELOG.md content for a repository
 */
async function getChangelog(owner: string, repo: string): Promise<string | null> {
  try {
    const response = await makeGitHubRequest(
      `/repos/${owner}/${repo}/contents/CHANGELOG.md`,
      {
        headers: {
          'Accept': 'application/vnd.github.raw',
        },
      }
    );
    return await response.text();
  } catch (error) {
    // CHANGELOG.md may not exist in all repos - that's fine
    return null;
  }
}

/**
 * Fetch stats (additions/deletions) and file changes for a specific commit
 */
async function getCommitStats(
  owner: string,
  repo: string,
  sha: string
): Promise<CommitStats | null> {
  try {
    const response = await makeGitHubRequest(
      `/repos/${owner}/${repo}/commits/${sha}`
    );
    const data = await response.json();

    const files: FileChange[] = (data.files || []).map((f: any) => ({
      filename: f.filename || '',
      status: f.status || 'modified',
      additions: f.additions || 0,
      deletions: f.deletions || 0,
    }));

    return {
      additions: data.stats?.additions || 0,
      deletions: data.stats?.deletions || 0,
      total: data.stats?.total || 0,
      files,
    };
  } catch (error) {
    console.error(`Error fetching stats for commit ${sha}:`, error);
    return null;
  }
}

/**
 * Get the list of repositories to analyze
 */
function getRepoList(): RepoInfo[] {
  return REPO_LIST;
}

/**
 * GitHub service interface for use in brains
 */
export const github = {
  getRepoList,
  getCommits,
  getMergedPRs,
  getChangelog,
  getCommitStats,
};

export default github;
