import { z } from 'zod';
import gmail from '../services/gmail.js';

/**
 * Gmail tools - wraps gmail service methods as AI-callable tools
 */

export const gmailGetAccounts = {
  description: 'Get all configured Gmail accounts from environment variables',
  inputSchema: z.object({}),
  execute: async () => {
    return gmail.getAccounts();
  },
};

export const gmailSearchThreads = {
  description: 'Search for email threads in a Gmail account',
  inputSchema: z.object({
    refreshToken: z.string().describe('OAuth refresh token for the Gmail account'),
    query: z.string().optional().describe('Gmail search query (e.g., "is:unread", "from:example@gmail.com"). Defaults to "is:unread"'),
    maxResults: z.number().optional().describe('Maximum number of threads to return. Defaults to 100'),
  }),
  execute: async (input: { refreshToken: string; query?: string; maxResults?: number }) => {
    return gmail.searchThreads(input.refreshToken, input.query, input.maxResults);
  },
};

export const gmailGetThreadDetails = {
  description: 'Get full details of an email thread including subject, sender, body, and all message IDs',
  inputSchema: z.object({
    refreshToken: z.string().describe('OAuth refresh token for the Gmail account'),
    threadId: z.string().describe('The Gmail thread ID'),
  }),
  execute: async (input: { refreshToken: string; threadId: string }) => {
    return gmail.getThreadDetails(input.refreshToken, input.threadId);
  },
};

export const gmailArchiveMessages = {
  description: 'Archive email messages by removing them from the inbox',
  inputSchema: z.object({
    refreshToken: z.string().describe('OAuth refresh token for the Gmail account'),
    messageIds: z.array(z.string()).describe('Array of message IDs to archive'),
  }),
  execute: async (input: { refreshToken: string; messageIds: string[] }) => {
    return gmail.archiveMessages(input.refreshToken, input.messageIds);
  },
};

export const gmailMarkAsRead = {
  description: 'Mark email messages as read',
  inputSchema: z.object({
    refreshToken: z.string().describe('OAuth refresh token for the Gmail account'),
    messageIds: z.array(z.string()).describe('Array of message IDs to mark as read'),
  }),
  execute: async (input: { refreshToken: string; messageIds: string[] }) => {
    return gmail.markAsRead(input.refreshToken, input.messageIds);
  },
};

export const gmailSendMessage = {
  description: 'Send an email message',
  inputSchema: z.object({
    refreshToken: z.string().describe('OAuth refresh token for the Gmail account'),
    to: z.string().describe('Recipient email address'),
    subject: z.string().describe('Email subject line'),
    body: z.string().describe('Email body text'),
  }),
  execute: async (input: { refreshToken: string; to: string; subject: string; body: string }) => {
    return gmail.sendMessage(input.refreshToken, {
      to: input.to,
      subject: input.subject,
      body: input.body,
    });
  },
};

export const gmailForwardMessage = {
  description: 'Forward an email message to a recipient, preserving attachments',
  inputSchema: z.object({
    refreshToken: z.string().describe('OAuth refresh token for the Gmail account'),
    messageId: z.string().describe('The message ID to forward'),
    to: z.string().describe('Recipient email address'),
    note: z.string().optional().describe('Optional note to include at the top of the forwarded message'),
  }),
  execute: async (input: { refreshToken: string; messageId: string; to: string; note?: string }) => {
    return gmail.forwardMessage(input.refreshToken, input.messageId, input.to, input.note);
  },
};

export const gmailTools = {
  gmailGetAccounts,
  gmailSearchThreads,
  gmailGetThreadDetails,
  gmailArchiveMessages,
  gmailMarkAsRead,
  gmailSendMessage,
  gmailForwardMessage,
};

export default gmailTools;
