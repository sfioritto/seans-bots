import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createMockClient, runBrainTest } from './test-utils.js';
import emailDigestBrain from '../brains/email-digest.js';

describe('email-digest', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  const createMockGmail = (emails: any[] = [], accounts = [
    { name: 'account1', refreshToken: 'test-token-1' },
    { name: 'account2', refreshToken: 'test-token-2' },
    { name: 'account3', refreshToken: 'test-token-3' },
  ]) => ({
    getAccounts: () => accounts,
    searchMessages: jest.fn(async (token: string) => {
      // Return emails that match the account's token
      const account = accounts.find(a => a.refreshToken === token);
      const accountEmails = emails.filter(e => e.accountName === account?.name);
      return accountEmails.map((e) => ({ id: e.id, threadId: e.id, snippet: e.snippet }));
    }),
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

    // Mock responses for all 6 processors in order: isaac, amazon, receipts, kickstarter, newsletters, action items
    mockClient.mockResponses(
      { isaacEmails: [] },
      { categorizedEmails: [] },
      { receiptEmails: [] },
      { kickstarterEmails: [] },
      { newsletterEmails: [] },
      { emailActionItems: [] }
    );

    const result = await runBrainTest(emailDigestBrain, {
      client: mockClient,
      services: {
        gmail: mockGmail,
        ntfy: mockNtfy,
        pages: mockPages,
      },
    });

    expect(result.completed).toBe(true);
    expect(result.finalState.allEmails).toHaveLength(0);
    expect(mockNtfy.send).not.toHaveBeenCalled();
  });

  it('should process emails through all processors in priority order', async () => {
    const testEmails = [
      {
        id: 'email-1',
        subject: 'Isaac Field Trip Permission Slip',
        from: 'school@brooks.edu',
        date: '2024-01-15',
        body: 'Please sign and return the permission slip by Friday...',
        snippet: 'Permission slip needed',
        accountName: 'account1',
      },
      {
        id: 'email-2',
        subject: 'Your Amazon order has shipped',
        from: 'ship-confirm@amazon.com',
        date: '2024-01-16',
        body: 'Your package is on the way...',
        snippet: 'Package shipped',
        accountName: 'account2',
      },
      {
        id: 'email-3',
        subject: 'Uber Receipt',
        from: 'receipts@uber.com',
        date: '2024-01-17',
        body: 'Thanks for riding with Uber. Total: $15.50',
        snippet: 'Uber receipt',
        accountName: 'account1',
      },
      {
        id: 'email-4',
        subject: 'Kickstarter Update: Board Game Project',
        from: 'no-reply@kickstarter.com',
        date: '2024-01-18',
        body: 'Your backed project has shipped!',
        snippet: 'Project update',
        accountName: 'account3',
      },
      {
        id: 'email-5',
        subject: 'Morning Brew Daily',
        from: 'crew@morningbrew.com',
        date: '2024-01-19',
        body: 'Good morning! Here\'s your daily business news...',
        snippet: 'Daily business news',
        accountName: 'account2',
      },
    ];

    const mockGmail = createMockGmail(testEmails);
    const mockNtfy = createMockNtfy();
    const mockPages = createMockPages();

    mockClient.mockResponses(
      // 1. Isaac (claims email-1 - school related)
      {
        isaacEmails: [
          { emailId: 'email-1', isIsaacRelated: true, category: 'school', summary: 'Field trip permission slip reminder', actionItems: [
            { description: 'Sign permission slip', exactQuote: 'Please sign and return the permission slip by Friday', context: 'Field trip permission required', link: '', steps: ['Sign the slip', 'Return to school'] }
          ]},
          { emailId: 'email-2', isIsaacRelated: false },
          { emailId: 'email-3', isIsaacRelated: false },
          { emailId: 'email-4', isIsaacRelated: false },
          { emailId: 'email-5', isIsaacRelated: false },
        ],
      },
      // 2. Amazon (claims email-2, skips email-1)
      {
        categorizedEmails: [
          { emailId: 'email-2', isAmazon: true, category: 'shipping_notification', summary: 'Package shipped' },
          { emailId: 'email-3', isAmazon: false },
          { emailId: 'email-4', isAmazon: false },
          { emailId: 'email-5', isAmazon: false },
        ],
      },
      // 3. Receipts (claims email-3, skips email-1, email-2)
      {
        receiptEmails: [
          { emailId: 'email-3', isReceipt: true, merchant: 'Uber', summary: 'Ride receipt', charges: [{ description: 'Ride', amount: '$15.50' }] },
          { emailId: 'email-4', isReceipt: false },
          { emailId: 'email-5', isReceipt: false },
        ],
      },
      // 4. Kickstarter (claims email-4)
      {
        kickstarterEmails: [
          { emailId: 'email-4', isKickstarterRelated: true, summary: 'Board game project shipped', actionItems: [] },
          { emailId: 'email-5', isKickstarterRelated: false },
        ],
      },
      // 5. Newsletters (claims email-5)
      {
        newsletterEmails: [
          { emailId: 'email-5', isNewsletter: true, newsletterName: 'Morning Brew', summary: 'Daily business news roundup', deadlines: [] },
        ],
      },
      // 6. Action Items (runs last, extracts from non-Isaac categorized emails)
      {
        emailActionItems: [],
      }
    );

    const result = await runBrainTest(emailDigestBrain, {
      client: mockClient,
      services: {
        gmail: mockGmail,
        ntfy: mockNtfy,
        pages: mockPages,
      },
    });

    expect(result.completed).toBe(true);
    expect(result.finalState.allEmails).toHaveLength(5);

    // Check that each processor claimed the correct emails
    expect(result.finalState.processedIsaac).toHaveLength(1);
    expect(result.finalState.processedAmazon).toHaveLength(1);
    expect(result.finalState.processedReceipts).toHaveLength(1);
    expect(result.finalState.processedKickstarter).toHaveLength(1);
    expect(result.finalState.processedNewsletters).toHaveLength(1);

    // Isaac emails have action items embedded
    expect(result.finalState.processedIsaac[0].actionItems).toHaveLength(1);

    // Verify page was created
    expect(mockPages.create).toHaveBeenCalled();
    expect(mockPages.update).toHaveBeenCalled();

    // Verify notification was sent
    expect(mockNtfy.send).toHaveBeenCalled();
    const notificationMessage = (mockNtfy.send as any).mock.calls[0][0];
    expect(notificationMessage).toContain('action items');
    expect(notificationMessage).toContain('Isaac');
    expect(notificationMessage).toContain('Amazon');
    expect(notificationMessage).toContain('receipts');
    expect(notificationMessage).toContain('Kickstarter');
    expect(notificationMessage).toContain('newsletters');
  });

  it('should claim emails on first match (Amazon has priority over receipts)', async () => {
    // An email from Amazon that could be classified as a receipt
    // Amazon should claim it first, and action items can still be attached
    const testEmails = [
      {
        id: 'email-1',
        subject: 'Amazon: Your order has shipped',
        from: 'orders@amazon.com',
        date: '2024-01-15',
        body: 'Your order of School Supplies has shipped. Total: $45.99...',
        snippet: 'Order shipped',
        accountName: 'account1',
      },
    ];

    const mockGmail = createMockGmail(testEmails);
    const mockNtfy = createMockNtfy();
    const mockPages = createMockPages();

    mockClient.mockResponses(
      // Isaac doesn't claim it (not Isaac-related)
      { isaacEmails: [{ emailId: 'email-1', isIsaacRelated: false }] },
      // Amazon claims it first
      {
        categorizedEmails: [
          { emailId: 'email-1', isAmazon: true, category: 'shipping_notification', summary: 'School supplies shipped' },
        ],
      },
      // Receipts sees empty list (email-1 already claimed by Amazon)
      { receiptEmails: [] },
      { kickstarterEmails: [] },
      { newsletterEmails: [] },
      // Action items runs last on all categorized emails
      {
        emailActionItems: [
          {
            emailId: 'email-1',
            items: [
              {
                description: 'Track your package',
                exactQuote: 'Your order has shipped',
                context: 'School supplies delivery',
                link: 'https://amazon.com/track',
                steps: [],
              },
            ],
          },
        ],
      }
    );

    const result = await runBrainTest(emailDigestBrain, {
      client: mockClient,
      services: {
        gmail: mockGmail,
        ntfy: mockNtfy,
        pages: mockPages,
      },
    });

    expect(result.completed).toBe(true);
    // Amazon claimed it
    expect(result.finalState.processedAmazon).toHaveLength(1);
    // Receipts did not claim it (was already claimed by Amazon)
    expect(result.finalState.processedReceipts).toHaveLength(0);
    // Action items were attached to the Amazon email
    expect(result.finalState.actionItemsMap['email-1']).toHaveLength(1);
  });

  it('should generate unified page with tabs for each category', async () => {
    const testEmails = [
      {
        id: 'email-1',
        subject: 'Amazon order shipped',
        from: 'orders@amazon.com',
        date: '2024-01-15',
        body: 'Your order is on the way',
        snippet: 'Package shipped',
        accountName: 'account1',
      },
      {
        id: 'email-2',
        subject: 'Morning Brew Newsletter',
        from: 'crew@morningbrew.com',
        date: '2024-01-16',
        body: 'Daily news...',
        snippet: 'News',
        accountName: 'account2',
      },
    ];

    const mockGmail = createMockGmail(testEmails);
    const mockNtfy = createMockNtfy();
    const mockPages = createMockPages();

    mockClient.mockResponses(
      { isaacEmails: [{ emailId: 'email-1', isIsaacRelated: false }, { emailId: 'email-2', isIsaacRelated: false }] },
      { categorizedEmails: [{ emailId: 'email-1', isAmazon: true, category: 'shipping_notification', summary: 'Package shipped' }, { emailId: 'email-2', isAmazon: false }] },
      { receiptEmails: [{ emailId: 'email-2', isReceipt: false }] },
      { kickstarterEmails: [{ emailId: 'email-2', isKickstarterRelated: false }] },
      { newsletterEmails: [{ emailId: 'email-2', isNewsletter: true, newsletterName: 'Morning Brew', summary: 'Daily business news', deadlines: [] }] },
      { emailActionItems: [] }
    );

    const result = await runBrainTest(emailDigestBrain, {
      client: mockClient,
      services: {
        gmail: mockGmail,
        ntfy: mockNtfy,
        pages: mockPages,
      },
    });

    expect(result.completed).toBe(true);

    // Get the HTML that was passed to update
    const updateCall = mockPages.update.mock.calls[0];
    const html = updateCall[1] as string;

    // Verify HTML contains tabs (no action items tab anymore)
    expect(html).toContain('data-tab="amazon"');
    expect(html).toContain('data-tab="newsletters"');
    expect(html).toContain('Email Digest');
    expect(html).toContain('Archive Selected');
    // Action items tab should NOT exist
    expect(html).not.toContain('data-tab="actionItems"');
  });

  it('should handle account not configured', async () => {
    const mockGmail = {
      getAccounts: () => [], // No accounts
      searchMessages: jest.fn(async () => []),
      getMessageDetails: jest.fn(async () => ({})),
      archiveMessages: jest.fn(async () => {}),
    };
    const mockNtfy = createMockNtfy();
    const mockPages = createMockPages();

    mockClient.mockResponses(
      { isaacEmails: [] },
      { categorizedEmails: [] },
      { receiptEmails: [] },
      { kickstarterEmails: [] },
      { newsletterEmails: [] },
      { emailActionItems: [] }
    );

    const result = await runBrainTest(emailDigestBrain, {
      client: mockClient,
      services: {
        gmail: mockGmail,
        ntfy: mockNtfy,
        pages: mockPages,
      },
    });

    expect(result.completed).toBe(true);
    expect(result.finalState.allEmails).toHaveLength(0);
  });
});
