import { jest } from '@jest/globals';
import { createMockClient, runBrainTest } from './test-utils.js';
import weeklyDevSummaryBrain from '../brains/weekly-dev-summary.js';

// Mock environment variables for Slack
const originalEnv = process.env;
const originalFetch = global.fetch;

beforeAll(() => {
  process.env = {
    ...originalEnv,
    SLACK_BOT_TOKEN: 'xoxb-test-token',
  };
});

afterAll(() => {
  process.env = originalEnv;
  global.fetch = originalFetch;
});

// Mock global fetch for Slack API calls
const mockFetch = jest.fn();

beforeEach(() => {
  global.fetch = mockFetch as any;
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, ts: '1234567890.123456', channel: 'C12345678' }),
  });
});

afterEach(() => {
  global.fetch = originalFetch;
});

function createMockGitHub() {
  let commits: any[] = [];
  let prs: any[] = [];
  let changelog: string | null = null;

  return {
    getRepoList: () => [
      { owner: 'SOFware', repo: 'test-repo-1' },
      { owner: 'SOFware', repo: 'test-repo-2' },
    ],
    getCommits: async () => commits,
    getMergedPRs: async () => prs,
    getChangelog: async () => changelog,
    getCommitStats: async () => ({
      additions: 50,
      deletions: 10,
      total: 60,
      files: [
        { filename: 'src/auth.ts', status: 'modified', additions: 40, deletions: 5 },
        { filename: 'src/utils.ts', status: 'modified', additions: 10, deletions: 5 },
      ],
    }),
    getPRReviews: async () => [
      { user: 'jsmith', count: 2 },
    ],
    getPRReviewComments: async () => [
      { user: 'jsmith', count: 5 },
    ],
    mockCommits: (c: any[]) => { commits = c; },
    mockPRs: (p: any[]) => { prs = p; },
    mockChangelog: (c: string | null) => { changelog = c; },
  };
}

describe('weekly-dev-summary brain', () => {
  it('should aggregate commits by developer and generate summaries', async () => {
    // Arrange: Mock GitHub responses
    const mockGithub = createMockGitHub();
    mockGithub.mockCommits([
      {
        sha: 'abc123',
        repo: 'test-repo-1',
        author: { name: 'John Smith', email: 'john@example.com', date: '2025-12-05' },
        message: 'Add user authentication\n\nImplements OAuth2 login flow',
      },
      {
        sha: 'def456',
        repo: 'test-repo-1',
        author: { name: 'John Smith', email: 'john@example.com', date: '2025-12-06' },
        message: 'Fix auth bug in token refresh',
      },
      {
        sha: 'ghi789',
        repo: 'test-repo-2',
        author: { name: 'Jane Doe', email: 'jane@example.com', date: '2025-12-05' },
        message: 'Update dashboard widget',
      },
    ]);
    mockGithub.mockPRs([
      {
        number: 42,
        repo: 'test-repo-1',
        title: 'Authentication feature',
        body: 'This PR adds OAuth2 authentication support for the application.',
        author: 'jsmith',
        mergedAt: '2025-12-05',
        branch: 'feature/auth',
      },
    ]);
    mockGithub.mockChangelog('## v1.0.0 - 2025-12-04\n- Added authentication feature\n- Fixed login issues');

    const mockClient = createMockClient();

    // Mock AI responses in order:
    // 1. Name deduplication
    mockClient.mockResponses(
      {
        developerGroups: [
          { canonicalName: 'John Smith', emails: ['john@example.com'], githubUsernames: ['jsmith'] },
          { canonicalName: 'Jane Doe', emails: ['jane@example.com'], githubUsernames: [] },
        ],
      },
      // 2. Developer summaries (casual one-liner + impact-focused bullets with PR links)
      {
        summaries: [
          {
            name: 'John Smith',
            summary: 'Focused on the auth system this week',
            accomplishments: [
              {
                text: 'Added OAuth2 login flow so users can sign in with their Google accounts instead of creating new passwords.',
                relatedPRs: [{ repo: 'test-repo-1', number: 42 }],
              },
              {
                text: 'Fixed a bug where auth tokens would expire too early, which was causing users to get logged out unexpectedly.',
                relatedPRs: [],
              },
            ],
          },
          {
            name: 'Jane Doe',
            summary: 'Shipped some dashboard improvements',
            accomplishments: [
              {
                text: 'Updated the dashboard widget to show real-time data, giving the ops team better visibility into current orders.',
                relatedPRs: [],
              },
            ],
          },
        ],
      }
    );

    // Act
    const result = await runBrainTest(weeklyDevSummaryBrain, {
      client: mockClient,
      services: { github: mockGithub },
    });

    // Assert
    expect(result.completed).toBe(true);
    expect(result.error).toBeNull();
    expect(result.finalState.developerSummaries).toBeDefined();
    expect(result.finalState.developerSummaries.summaries).toHaveLength(2);
    // Check thread starter
    expect(result.finalState.threadStarter).toContain('Developer Summary for week of');
    expect(result.finalState.threadStarter).toContain('🧵');
    // Check thread reply contains names and summaries
    expect(result.finalState.threadReply).toContain('John Smith');
    expect(result.finalState.threadReply).toContain('Jane Doe');
    expect(result.finalState.threadReply).toContain('Focused on the auth system');
    expect(result.finalState.threadReply).toContain('Shipped some dashboard improvements');
    // Check for impact-focused bullet points
    expect(result.finalState.threadReply).toContain('OAuth2 login flow so users can sign in');
    expect(result.finalState.threadReply).toContain('giving the ops team better visibility');
    // Check for PR link
    expect(result.finalState.threadReply).toContain('github.com/SOFware/test-repo-1/pull/42');
    // Check for metadata
    expect(result.finalState.threadReply).toContain('lines changed');
    expect(result.finalState.threadReply).toContain('commits');
    expect(result.finalState.threadReply).toContain('PRs merged');
    expect(result.finalState.threadReply).toContain('PRs reviewed');
    expect(result.finalState.threadReply).toContain('PR comments');
    // Check for Summary header
    expect(result.finalState.threadReply).toContain('Summary:');
  });

  it('should handle repos with no commits gracefully', async () => {
    // Arrange: Empty responses
    const mockGithub = createMockGitHub();
    mockGithub.mockCommits([]);
    mockGithub.mockPRs([]);
    mockGithub.mockChangelog(null);

    const mockClient = createMockClient();
    mockClient.mockResponses(
      { developerGroups: [] },
      { summaries: [] }
    );

    // Act
    const result = await runBrainTest(weeklyDevSummaryBrain, {
      client: mockClient,
      services: { github: mockGithub },
    });

    // Assert
    expect(result.completed).toBe(true);
    expect(result.finalState.rawCommits).toHaveLength(0);
    expect(result.finalState.developerSummaries.summaries).toHaveLength(0);
    expect(result.finalState.threadReply).toContain('No developer activity this week');
  });

  it('should deduplicate developers with multiple email addresses', async () => {
    // Arrange: Same person with different emails
    // Use a custom mock that only returns commits once
    const mockGithub = {
      getRepoList: () => [{ owner: 'SOFware', repo: 'test-repo' }], // Single repo
      getCommits: async () => [
        {
          sha: 'abc123',
          repo: 'test-repo',
          author: { name: 'John Smith', email: 'john@example.com', date: '2025-12-05' },
          message: 'Add feature A',
        },
        {
          sha: 'def456',
          repo: 'test-repo',
          author: { name: 'John', email: 'john.smith@company.com', date: '2025-12-06' },
          message: 'Add feature B',
        },
      ],
      getMergedPRs: async () => [],
      getChangelog: async () => null,
      getCommitStats: async () => ({
        additions: 30,
        deletions: 5,
        total: 35,
        files: [{ filename: 'src/feature.ts', status: 'added', additions: 30, deletions: 5 }],
      }),
      getPRReviews: async () => [],
      getPRReviewComments: async () => [],
    };

    const mockClient = createMockClient();
    mockClient.mockResponses(
      // AI correctly identifies these as the same person
      {
        developerGroups: [
          {
            canonicalName: 'John Smith',
            emails: ['john@example.com', 'john.smith@company.com'],
            githubUsernames: [],
          },
        ],
      },
      {
        summaries: [
          {
            name: 'John Smith',
            summary: 'Knocked out a couple quick features',
            accomplishments: [
              {
                text: 'Added feature A to improve the onboarding flow for new users.',
                relatedPRs: [],
              },
              {
                text: 'Added feature B to help the support team track customer issues more easily.',
                relatedPRs: [],
              },
            ],
          },
        ],
      }
    );

    // Act
    const result = await runBrainTest(weeklyDevSummaryBrain, {
      client: mockClient,
      services: { github: mockGithub },
    });

    // Assert
    expect(result.completed).toBe(true);
    expect(result.finalState.developers).toHaveLength(1);
    expect(result.finalState.developers[0].name).toBe('John Smith');
    expect(result.finalState.developers[0].commits).toHaveLength(2);
  });
});
