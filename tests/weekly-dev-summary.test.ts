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
      // 2. Developer summaries
      {
        summaries: [
          {
            name: 'John Smith',
            accomplishments: [
              'Implemented OAuth2 authentication system',
              'Fixed token refresh bug in authentication flow',
            ],
          },
          {
            name: 'Jane Doe',
            accomplishments: ['Updated dashboard widget'],
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
    expect(result.finalState.slackMessage).toContain('John Smith');
    expect(result.finalState.slackMessage).toContain('Jane Doe');
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
            accomplishments: ['Added feature A', 'Added feature B'],
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
