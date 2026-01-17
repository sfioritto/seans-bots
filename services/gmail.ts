import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';

/**
 * Gmail service for reading emails from multiple accounts
 */

interface GmailThread {
  threadId: string;
  subject: string;
  from: string;
  date: string;
  body: string;
  snippet: string;
  messageCount: number;
  messageIds: string[];
}

interface GmailAccount {
  name: string;
  refreshToken: string;
}

interface BodyParts {
  text: string;
  html: string | null;
}

interface AttachmentInfo {
  partId: string;
  filename: string;
  mimeType: string;
  attachmentId: string | null;
  data: string | null;
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
 * Returns both text and HTML versions when available, clearly labeled
 */
function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';

  // Try to get body from the main payload (single-part message)
  if (payload.body?.data) {
    return decodeBody(payload.body.data);
  }

  // If multipart, extract both text and HTML
  if (payload.parts) {
    let textBody = '';
    let htmlBody = '';

    function findParts(parts: gmail_v1.Schema$MessagePart[]): void {
      for (const part of parts) {
        if (part.mimeType === 'text/plain' && part.body?.data && !textBody) {
          textBody = decodeBody(part.body.data);
        }
        if (part.mimeType === 'text/html' && part.body?.data && !htmlBody) {
          htmlBody = decodeBody(part.body.data);
        }
        if (part.parts) {
          findParts(part.parts);
        }
      }
    }

    findParts(payload.parts);

    // Return both versions if available, clearly labeled
    if (textBody && htmlBody) {
      return `=== TEXT VERSION ===\n${textBody}\n\n=== HTML VERSION ===\n${htmlBody}`;
    }

    return htmlBody || textBody;
  }

  return '';
}

/**
 * Extract both text/plain and text/html body content from Gmail message payload
 */
function extractBodyParts(payload: gmail_v1.Schema$MessagePart | undefined): BodyParts {
  const result: BodyParts = { text: '', html: null };

  if (!payload) return result;

  function findParts(part: gmail_v1.Schema$MessagePart): void {
    if (part.mimeType === 'text/plain' && part.body?.data && !result.text) {
      result.text = decodeBody(part.body.data);
    }
    if (part.mimeType === 'text/html' && part.body?.data && !result.html) {
      result.html = decodeBody(part.body.data);
    }
    if (part.parts) {
      for (const subpart of part.parts) {
        findParts(subpart);
      }
    }
  }

  // Check if the payload itself is a simple text message
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    result.text = decodeBody(payload.body.data);
  } else if (payload.mimeType === 'text/html' && payload.body?.data) {
    result.html = decodeBody(payload.body.data);
  } else {
    findParts(payload);
  }

  return result;
}

/**
 * Extract attachment information from Gmail message payload
 */
function extractAttachments(payload: gmail_v1.Schema$MessagePart | undefined): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = [];

  if (!payload) return attachments;

  function findAttachments(part: gmail_v1.Schema$MessagePart): void {
    // Check if this part is an attachment (has filename and is not a body part)
    const filename = part.filename;
    const mimeType = part.mimeType || 'application/octet-stream';

    // Skip text/plain and text/html body parts (they're the email body, not attachments)
    const isBodyPart = (mimeType === 'text/plain' || mimeType === 'text/html') && !filename;

    if (filename && !isBodyPart) {
      attachments.push({
        partId: part.partId || '',
        filename,
        mimeType,
        attachmentId: part.body?.attachmentId || null,
        data: part.body?.data || null
      });
    }

    // Recursively search nested parts
    if (part.parts) {
      for (const subpart of part.parts) {
        findAttachments(subpart);
      }
    }
  }

  findAttachments(payload);
  return attachments;
}

/**
 * Fetch attachment data for large attachments that aren't inline
 */
async function fetchAttachmentData(
  gmail: gmail_v1.Gmail,
  messageId: string,
  attachmentId: string
): Promise<string> {
  const response = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId
  });

  return response.data.data || '';
}

/**
 * Build a properly formatted forwarded message with inline body and top-level attachments
 */
function buildForwardedMessage(params: {
  to: string;
  subject: string;
  note: string;
  originalFrom: string;
  originalDate: string;
  originalSubject: string;
  bodyParts: BodyParts;
  attachments: Array<{
    filename: string;
    mimeType: string;
    data: string; // base64url encoded
  }>;
}): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2)}`;

  // Build the forward header
  const forwardHeader = [
    '---------- Forwarded message ---------',
    `From: ${params.originalFrom}`,
    `Date: ${params.originalDate}`,
    `Subject: ${params.originalSubject}`,
    ''
  ].join('\r\n');

  // Combine note with forward header and original body
  const textBody = [
    params.note || '',
    '',
    forwardHeader,
    params.bodyParts.text
  ].join('\r\n');

  const parts: string[] = [];

  // Add headers
  parts.push(`To: ${params.to}`);
  parts.push(`Subject: ${params.subject}`);
  parts.push('MIME-Version: 1.0');
  parts.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  parts.push('');

  // Add text body part
  parts.push(`--${boundary}`);
  parts.push('Content-Type: text/plain; charset=utf-8');
  parts.push('Content-Transfer-Encoding: quoted-printable');
  parts.push('');
  parts.push(textBody);

  // Add each attachment at the top level
  for (const attachment of params.attachments) {
    // Convert base64url to standard base64
    const base64Data = attachment.data.replace(/-/g, '+').replace(/_/g, '/');

    parts.push(`--${boundary}`);
    parts.push(`Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`);
    parts.push('Content-Transfer-Encoding: base64');
    parts.push(`Content-Disposition: attachment; filename="${attachment.filename}"`);
    parts.push('');
    // Split base64 into 76-character lines per RFC 2045
    const lines = base64Data.match(/.{1,76}/g) || [];
    parts.push(lines.join('\r\n'));
  }

  // Close the multipart
  parts.push(`--${boundary}--`);

  return parts.join('\r\n');
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
 * Search for threads in a Gmail account
 */
async function searchThreads(
  refreshToken: string,
  query: string = 'is:unread',
  maxResults: number = 100
): Promise<{ threadId: string }[]> {
  const gmail = createGmailClient(refreshToken);

  const response = await gmail.users.threads.list({
    userId: 'me',
    q: query,
    maxResults
  });

  return (response.data.threads || []).map(thread => ({
    threadId: thread.id || ''
  }));
}

/**
 * Get full details of a thread (returns latest message details + all message IDs)
 */
async function getThreadDetails(
  refreshToken: string,
  threadId: string
): Promise<GmailThread> {
  const gmail = createGmailClient(refreshToken);

  const response = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full'
  });

  const thread = response.data;
  const messages = thread.messages || [];

  // Collect all message IDs
  const messageIds = messages.map(msg => msg.id || '').filter(Boolean);

  // Sort messages by internalDate to find the latest
  const sortedMessages = [...messages].sort((a, b) => {
    const dateA = parseInt(a.internalDate || '0', 10);
    const dateB = parseInt(b.internalDate || '0', 10);
    return dateB - dateA;
  });

  const latestMessage = sortedMessages[0];
  const headers = latestMessage?.payload?.headers;

  return {
    threadId: thread.id || '',
    subject: getHeader(headers, 'Subject'),
    from: getHeader(headers, 'From'),
    date: getHeader(headers, 'Date'),
    body: extractBody(latestMessage?.payload),
    snippet: latestMessage?.snippet || '',
    messageCount: messages.length,
    messageIds
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
 * Mark messages as read by removing the UNREAD label
 */
async function markAsRead(
  refreshToken: string,
  messageIds: string[]
): Promise<void> {
  const gmail = createGmailClient(refreshToken);

  for (const messageId of messageIds) {
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: ['UNREAD']
      }
    });

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/**
 * Send an email message
 */
interface SendMessageOptions {
  to: string;
  subject: string;
  body: string;
}

async function sendMessage(
  refreshToken: string,
  options: SendMessageOptions
): Promise<{ id: string; threadId: string }> {
  const gmail = createGmailClient(refreshToken);

  // Build RFC 2822 formatted email
  const messageParts = [
    `To: ${options.to}`,
    `Subject: ${options.subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    options.body
  ];

  const raw = Buffer.from(messageParts.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw }
  });

  return {
    id: response.data.id || '',
    threadId: response.data.threadId || ''
  };
}

/**
 * Forward an email message to a recipient, preserving attachments at top level
 */
async function forwardMessage(
  refreshToken: string,
  messageId: string,
  to: string,
  note?: string
): Promise<{ id: string; threadId: string }> {
  const gmail = createGmailClient(refreshToken);

  // Get the original message with full MIME structure
  const response = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full'
  });

  const message = response.data;
  const headers = message.payload?.headers;

  // Extract headers
  const originalFrom = getHeader(headers, 'From');
  const originalDate = getHeader(headers, 'Date');
  const originalSubject = getHeader(headers, 'Subject');

  // Build forwarded subject
  const subject = originalSubject.startsWith('Fwd:')
    ? originalSubject
    : `Fwd: ${originalSubject}`;

  // Extract body parts (text and HTML)
  const bodyParts = extractBodyParts(message.payload);

  // Extract attachments
  const attachmentInfos = extractAttachments(message.payload);

  // Fetch attachment data for any large attachments
  const attachments: Array<{ filename: string; mimeType: string; data: string }> = [];

  for (const info of attachmentInfos) {
    let data = info.data;

    // If attachment data is not inline, fetch it
    if (!data && info.attachmentId) {
      data = await fetchAttachmentData(gmail, messageId, info.attachmentId);
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (data) {
      attachments.push({
        filename: info.filename,
        mimeType: info.mimeType,
        data
      });
    }
  }

  // Build the forwarded message with attachments at top level
  const newMessage = buildForwardedMessage({
    to,
    subject,
    note: note || '',
    originalFrom,
    originalDate,
    originalSubject,
    bodyParts,
    attachments
  });

  const raw = Buffer.from(newMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const sendResponse = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw }
  });

  return {
    id: sendResponse.data.id || '',
    threadId: sendResponse.data.threadId || ''
  };
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
   * Search for threads in a specific account
   */
  searchThreads,

  /**
   * Get full details of a thread (latest message + all message IDs)
   */
  getThreadDetails,

  /**
   * Archive messages by removing from inbox
   */
  archiveMessages,

  /**
   * Mark messages as read
   */
  markAsRead,

  /**
   * Send an email message
   */
  sendMessage,

  /**
   * Forward an email message to a recipient
   */
  forwardMessage,
};

export default gmail;
