import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';

/**
 * Gmail service for reading emails from multiple accounts
 */

interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
}

interface GmailMessageDetails {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  body: string;
  snippet: string;
}

interface GmailAccount {
  name: string;
  refreshToken: string;
}

/**
 * Create an authenticated Gmail client for a specific account
 */
function createGmailClient(refreshToken: string): gmail_v1.Gmail {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'
  );

  oauth2Client.setCredentials({
    refresh_token: refreshToken
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

/**
 * Decode base64url encoded message body
 */
function decodeBody(data: string | undefined): string {
  if (!data) return '';

  try {
    return Buffer.from(
      data.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf-8');
  } catch (error) {
    console.error('Error decoding message body:', error);
    return '';
  }
}

/**
 * Extract body content from Gmail message payload
 */
function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';

  // Try to get body from the main payload
  if (payload.body?.data) {
    return decodeBody(payload.body.data);
  }

  // If multipart, try to find text/plain or text/html part
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBody(part.body.data);
      }
    }

    // Fall back to HTML if no plain text
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return decodeBody(part.body.data);
      }
    }

    // Recursively search nested parts
    for (const part of payload.parts) {
      const body = extractBody(part);
      if (body) return body;
    }
  }

  return '';
}

/**
 * Extract header value from message headers
 */
function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  if (!headers) return '';
  const header = headers.find(h => h.name?.toLowerCase() === name.toLowerCase());
  return header?.value || '';
}

/**
 * Search for messages in a Gmail account
 */
async function searchMessages(
  refreshToken: string,
  query: string = 'is:unread',
  maxResults: number = 100
): Promise<GmailMessage[]> {
  const gmail = createGmailClient(refreshToken);

  const response = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults
  });

  return (response.data.messages || []).map(msg => ({
    id: msg.id || '',
    threadId: msg.threadId || '',
    snippet: ''
  }));
}

/**
 * Get full details of a specific message
 */
async function getMessageDetails(
  refreshToken: string,
  messageId: string
): Promise<GmailMessageDetails> {
  const gmail = createGmailClient(refreshToken);

  const response = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full'
  });

  const message = response.data;
  const headers = message.payload?.headers;

  return {
    id: message.id || '',
    threadId: message.threadId || '',
    subject: getHeader(headers, 'Subject'),
    from: getHeader(headers, 'From'),
    date: getHeader(headers, 'Date'),
    body: extractBody(message.payload),
    snippet: message.snippet || ''
  };
}

/**
 * Archive messages by removing the INBOX label
 */
async function archiveMessages(
  refreshToken: string,
  messageIds: string[]
): Promise<void> {
  const gmail = createGmailClient(refreshToken);

  for (const messageId of messageIds) {
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: ['INBOX']
      }
    });

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/**
 * Get configured Gmail accounts from environment variables
 */
function getConfiguredAccounts(): GmailAccount[] {
  const accounts: GmailAccount[] = [];

  // Check for up to 10 accounts
  for (let i = 1; i <= 10; i++) {
    const refreshToken = process.env[`GMAIL_REFRESH_TOKEN_ACCOUNT${i}`];
    if (refreshToken) {
      accounts.push({
        name: `account${i}`,
        refreshToken
      });
    }
  }

  return accounts;
}

/**
 * Gmail service interface for use in brains
 */
export const gmail = {
  /**
   * Get all configured Gmail accounts
   */
  getAccounts: getConfiguredAccounts,

  /**
   * Search for messages in a specific account
   */
  searchMessages,

  /**
   * Get full details of a message
   */
  getMessageDetails,

  /**
   * Archive messages by removing from inbox
   */
  archiveMessages,

  /**
   * Search across all configured accounts
   */
  searchAllAccounts: async (query: string = 'is:unread', maxResults: number = 100) => {
    const accounts = getConfiguredAccounts();
    const results = [];

    for (const account of accounts) {
      const messages = await searchMessages(account.refreshToken, query, maxResults);
      results.push({
        account: account.name,
        messageCount: messages.length,
        messages
      });

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return results;
  }
};

export default gmail;
