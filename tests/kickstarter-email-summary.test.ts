import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createMockClient, runBrainTest } from './test-utils.js';
import kickstarterEmailSummaryBrain from '../brains/kickstarter-email-summary.js';

describe('kickstarter-email-summary', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  const createMockGmail = (emails: any[] = []) => ({
    getAccounts: () => [{ name: 'account2', refreshToken: 'test-token' }],
    searchMessages: jest.fn(async () => emails.map((e) => ({ id: e.id, threadId: e.id, snippet: e.snippet }))),
    getMessageDetails: jest.fn(async (_token: string, messageId: string) => {
      const email = emails.find((e) => e.id === messageId);
      return email || { id: messageId, subject: '', from: '', date: '', body: '', snippet: '' };
    }),
    archiveMessages: jest.fn(async () => {}),
  });

  const createMockNtfy = () => ({
    send: jest.fn(async () => {}),
  });

  const createMockPages = () => ({
    create: jest.fn(async (slug: string) => ({
      slug,
      url: `https://test.workers.dev/pages/${slug}`,
      brainRunId: 'test-run-id',
      persist: false,
      createdAt: new Date().toISOString(),
    })),
    get: jest.fn(async () => null),
    exists: jest.fn(async () => null),
    update: jest.fn(async (slug: string) => ({
      slug,
      url: `https://test.workers.dev/pages/${slug}`,
      brainRunId: 'test-run-id',
      persist: false,
      createdAt: new Date().toISOString(),
    })),
  });

  it('should complete immediately when no emails found', async () => {
    const mockGmail = createMockGmail([]);
    const mockNtfy = createMockNtfy();
    const mockPages = createMockPages();

    // Need to mock both prompt responses even when empty
    mockClient.mockResponses(
      { kickstarterEmails: [] },
      { emailSummaries: [] }
    );

    const result = await runBrainTest(kickstarterEmailSummaryBrain, {
      client: mockClient,
      services: {
        gmail: mockGmail,
        ntfy: mockNtfy,
      },
    });

    expect(result.completed).toBe(true);
    expect(result.finalState.allEmails).toHaveLength(0);
    expect(mockNtfy.send).not.toHaveBeenCalled();
  });

  it('should identify Kickstarter-related emails from all inbox emails', async () => {
    const testEmails = [
      {
        id: 'email-1',
        subject: 'Your Kickstarter project update',
        from: 'no-reply@kickstarter.com',
        date: '2024-01-15',
        body: 'The board game you backed has a new update...',
        snippet: 'New update from the project creator',
      },
      {
        id: 'email-2',
        subject: 'Your order has shipped',
        from: 'orders@amazon.com',
        date: '2024-01-16',
        body: 'Your package is on the way...',
        snippet: 'Package shipped',
      },
      {
        id: 'email-3',
        subject: 'Survey for your pledge',
        from: 'no-reply@backerkit.com',
        date: '2024-01-17',
        body: 'Please complete your survey for the Kickstarter project...',
        snippet: 'Complete your backer survey',
      },
    ];

    const mockGmail = createMockGmail(testEmails);
    const mockNtfy = createMockNtfy();
    const mockPages = createMockPages();

    // First response: identify which emails are Kickstarter-related
    mockClient.mockResponses(
      {
        kickstarterEmails: [
          { emailId: 'email-1', isKickstarterRelated: true },
          { emailId: 'email-2', isKickstarterRelated: false },
          { emailId: 'email-3', isKickstarterRelated: true },
        ],
      },
      // Second response: summarize Kickstarter emails with action items
      {
        emailSummaries: [
          {
            emailId: 'email-1',
            summary: 'Board game project has a manufacturing update',
            actionItems: [],
          },
          {
            emailId: 'email-3',
            summary: 'BackerKit survey ready for your pledge',
            actionItems: ['Complete the backer survey to confirm shipping address'],
          },
        ],
      }
    );

    const result = await runBrainTest(kickstarterEmailSummaryBrain, {
      client: mockClient,
      services: {
        gmail: mockGmail,
        ntfy: mockNtfy,
        pages: mockPages,
      },
    });

    expect(mockGmail.searchMessages).toHaveBeenCalled();
    expect(result.finalState.allEmails).toHaveLength(3);
    expect(result.finalState.kickstarterEmailIds).toHaveLength(2);
    expect(result.finalState.emailSummaries.emailSummaries).toHaveLength(2);
    // Verify action items are captured
    const emailWithAction = result.finalState.emailSummaries.emailSummaries.find(
      (e: any) => e.emailId === 'email-3'
    );
    expect(emailWithAction.actionItems).toHaveLength(1);
  });

  it('should handle account not configured', async () => {
    const mockGmail = {
      getAccounts: () => [], // No accounts
      searchMessages: jest.fn(async () => []),
      getMessageDetails: jest.fn(async () => ({})),
      archiveMessages: jest.fn(async () => {}),
    };
    const mockNtfy = createMockNtfy();

    // Need to mock both prompt responses
    mockClient.mockResponses(
      { kickstarterEmails: [] },
      { emailSummaries: [] }
    );

    const result = await runBrainTest(kickstarterEmailSummaryBrain, {
      client: mockClient,
      services: {
        gmail: mockGmail,
        ntfy: mockNtfy,
      },
    });

    expect(result.completed).toBe(true);
    expect(result.finalState.allEmails).toHaveLength(0);
  });

  it('should create summary page with checkboxes for archiving', async () => {
    const testEmails = [
      {
        id: 'email-1',
        subject: 'Kickstarter project update',
        from: 'no-reply@kickstarter.com',
        date: '2024-01-15',
        body: 'Update content...',
        snippet: 'Project update',
      },
    ];

    const mockGmail = createMockGmail(testEmails);
    const mockNtfy = createMockNtfy();
    const mockPages = createMockPages();

    mockClient.mockResponses(
      {
        kickstarterEmails: [{ emailId: 'email-1', isKickstarterRelated: true }],
      },
      {
        emailSummaries: [
          {
            emailId: 'email-1',
            summary: 'Project manufacturing is on track',
            actionItems: [],
          },
        ],
      }
    );

    const result = await runBrainTest(kickstarterEmailSummaryBrain, {
      client: mockClient,
      services: {
        gmail: mockGmail,
        ntfy: mockNtfy,
        pages: mockPages,
      },
    });

    // Verify page was created
    expect(mockPages.create).toHaveBeenCalled();
    expect(mockPages.update).toHaveBeenCalled();

    // Get the HTML that was passed to update
    const updateCall = mockPages.update.mock.calls[0];
    const html = updateCall[1] as string;

    // Verify HTML contains checkboxes
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked'); // Should be checked by default
    expect(html).toContain('Select All');
    expect(html).toContain('Archive Selected');
  });
});
