import { createMockClient, runBrainTest } from './test-utils.js';
import emailActionItemsBrain from '../brains/email-action-items.js';

describe('email-action-items brain', () => {
  it('should fetch emails and extract action items', async () => {
    // Arrange - create mock Gmail service
    const mockGmail = {
      getAccounts: () => [
        { name: 'account1', refreshToken: 'fake-token-1' },
        { name: 'account2', refreshToken: 'fake-token-2' },
      ],
      searchMessages: async (refreshToken: string, query: string) => {
        // Return mock messages based on which account
        if (refreshToken === 'fake-token-1') {
          return [
            { id: 'msg1', threadId: 'thread1', snippet: 'District 97 meeting tomorrow' },
            { id: 'msg2', threadId: 'thread2', snippet: 'Rock climbing session this weekend' },
          ];
        }
        return [
          { id: 'msg3', threadId: 'thread3', snippet: 'Isaac needs to finish homework' },
        ];
      },
      getMessageDetails: async (refreshToken: string, messageId: string) => {
        const messages: Record<string, any> = {
          msg1: {
            id: 'msg1',
            threadId: 'thread1',
            subject: 'District 97 Board Meeting',
            from: 'school@district97.org',
            date: '2025-11-04',
            body: 'The District 97 board meeting is tomorrow at 7pm. Please review the agenda and prepare your questions.',
            snippet: 'District 97 meeting tomorrow',
          },
          msg2: {
            id: 'msg2',
            threadId: 'thread2',
            subject: 'Rock Climbing This Weekend',
            from: 'climbing@gym.com',
            date: '2025-11-04',
            body: 'Hey! Rock climbing session is scheduled for Saturday at 10am. Bring your gear and sign the waiver.',
            snippet: 'Rock climbing session this weekend',
          },
          msg3: {
            id: 'msg3',
            threadId: 'thread3',
            subject: 'Isaac Homework Reminder',
            from: 'teacher@oakpark.edu',
            date: '2025-11-04',
            body: 'This is a reminder that Isaac needs to complete his math homework by Friday.',
            snippet: 'Isaac needs to finish homework',
          },
        };
        return messages[messageId];
      },
      searchAllAccounts: async (query: string) => {
        return [
          {
            account: 'account1',
            messageCount: 2,
            messages: [
              { id: 'msg1', threadId: 'thread1', snippet: 'District 97 meeting tomorrow' },
              { id: 'msg2', threadId: 'thread2', snippet: 'Rock climbing session this weekend' },
            ],
          },
          {
            account: 'account2',
            messageCount: 1,
            messages: [
              { id: 'msg3', threadId: 'thread3', snippet: 'Isaac needs to finish homework' },
            ],
          },
        ];
      },
    };

    const mockClient = createMockClient();

    // Mock AI response for action items extraction
    mockClient.mockResponses({
      actionItems: [
        {
          email: 'District 97 Board Meeting',
          items: ['Review the agenda for tomorrow\'s board meeting', 'Prepare questions for the meeting'],
        },
        {
          email: 'Rock Climbing This Weekend',
          items: ['Bring climbing gear on Saturday', 'Sign waiver before climbing session'],
        },
        {
          email: 'Isaac Homework Reminder',
          items: ['Ensure Isaac completes math homework by Friday'],
        },
      ],
    });

    // Act
    const result = await runBrainTest(emailActionItemsBrain, {
      client: mockClient,
      services: { gmail: mockGmail },
    });

    // Assert
    expect(result.completed).toBe(true);
    expect(result.error).toBeNull();
    expect(result.finalState.actionItems).toBeDefined();
    expect(result.finalState.actionItems.actionItems).toHaveLength(3);
    expect(result.finalState.actionItems.actionItems[0].email).toBe('District 97 Board Meeting');
    expect(result.finalState.actionItems.actionItems[0].items).toContain('Review the agenda for tomorrow\'s board meeting');
  });

  it('should handle no emails found', async () => {
    // Arrange - Gmail service with no messages
    const mockGmail = {
      getAccounts: () => [
        { name: 'account1', refreshToken: 'fake-token-1' },
      ],
      searchMessages: async () => [],
      getMessageDetails: async () => null,
      searchAllAccounts: async () => [
        {
          account: 'account1',
          messageCount: 0,
          messages: [],
        },
      ],
    };

    const mockClient = createMockClient();

    // Mock the AI response for empty emails case
    mockClient.mockResponses({
      actionItems: [],
    });

    // Act
    const result = await runBrainTest(emailActionItemsBrain, {
      client: mockClient,
      services: { gmail: mockGmail },
    });

    // Assert
    expect(result.completed).toBe(true);
    expect(result.finalState.allMessages).toHaveLength(0);
    expect(result.finalState.summary.totalEmails).toBe(0);
    expect(result.finalState.summary.totalActionItems).toBe(0);
  });
});
