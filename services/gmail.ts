/**
 * Gmail service for reading emails from multiple accounts
 * Uses direct REST API calls (no googleapis SDK) for Cloudflare Workers compatibility
 */

// =============================================================================
// Types
// =============================================================================

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

interface SendMessageOptions {
  to: string;
  subject: string;
  body: string;
}

// Gmail API response types (replacing gmail_v1.Schema$* types)
interface GmailMessagePartHeader {
  name?: string;
  value?: string;
}

interface GmailMessagePartBody {
  attachmentId?: string;
  size?: number;
  data?: string;
}

interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailMessagePartHeader[];
  body?: GmailMessagePartBody;
  parts?: GmailMessagePart[];
}

interface GmailMessage {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
  raw?: string;
}

interface GmailThreadResponse {
  id?: string;
  snippet?: string;
  messages?: GmailMessage[];
}

interface GmailThreadListResponse {
  threads?: Array<{ id?: string; snippet?: string }>;
  nextPageToken?: string;
}

interface GmailAttachmentResponse {
  size?: number;
  data?: string;
}

interface GmailSendResponse {
  id?: string;
  threadId?: string;
  labelIds?: string[];
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

// =============================================================================
// Base64 Utilities (Cloudflare Workers compatible - no Node.js Buffer)
// =============================================================================

/**
 * Encode a string to base64url format
 */
function encodeBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode base64url encoded data to a UTF-8 string
 */
function decodeBase64Url(data: string): string {
  // Convert base64url to standard base64
  let base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Decode base64url encoded message body (wrapper with error handling)
 */
function decodeBody(data: string | undefined): string {
  if (!data) return '';

  try {
    return decodeBase64Url(data);
  } catch (error) {
    console.error('Error decoding message body:', error);
    return '';
  }
}

// =============================================================================
// OAuth2 Token Management
// =============================================================================

const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

/**
 * Get an access token using a refresh token (cached until near expiry)
 */
async function getAccessToken(refreshToken: string): Promise<string> {
  const cached = tokenCache.get(refreshToken);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.accessToken;
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OAuth2 token refresh failed: ${response.status} - ${errorBody}`);
  }

  const data = await response.json() as TokenResponse;

  // Cache with 60s safety margin before expiry
  tokenCache.set(refreshToken, {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  });

  return data.access_token;
}

// =============================================================================
// Gmail API Helper
// =============================================================================

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1';

/**
 * Make an authenticated call to the Gmail API with retry on rate limits
 */
async function gmailApiCall<T>(
  accessToken: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const maxRetries = 5;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let response: Response;
    try {
      response = await fetch(`${GMAIL_API_BASE}${endpoint}`, {
        ...options,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      if (attempt < maxRetries) {
        const backoff = Math.min(1000 * Math.pow(2, attempt), 32000);
        console.warn(`[gmail] Fetch failed (${fetchError.name}: ${fetchError.message}), retrying in ${backoff}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }
      throw new Error(`Gmail API fetch failed after ${maxRetries} retries: ${fetchError.message}`);
    }
    clearTimeout(timeoutId);

    if (response.ok) {
      return response.json() as Promise<T>;
    }

    if (response.status === 429 && attempt < maxRetries) {
      const retryAfter = response.headers.get('Retry-After');
      const backoff = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : Math.min(1000 * Math.pow(2, attempt), 32000);
      console.warn(`[gmail] Rate limited, retrying in ${backoff}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      continue;
    }

    const errorBody = await response.text();
    throw new Error(`Gmail API error: ${response.status} - ${errorBody}`);
  }

  throw new Error(`Gmail API error: max retries exceeded for ${endpoint}`);
}

// =============================================================================
// Message Parsing Helpers
// =============================================================================

/**
 * Extract header value from message headers
 */
function getHeader(headers: GmailMessagePartHeader[] | undefined, name: string): string {
  if (!headers) return '';
  const header = headers.find(h => h.name?.toLowerCase() === name.toLowerCase());
  return header?.value || '';
}

/**
 * Extract body content from Gmail message payload
 * Returns both text and HTML versions when available, clearly labeled
 */
function extractBody(payload: GmailMessagePart | undefined): string {
  if (!payload) return '';

  // Try to get body from the main payload (single-part message)
  if (payload.body?.data) {
    return decodeBody(payload.body.data);
  }

  // If multipart, extract both text and HTML
  if (payload.parts) {
    let textBody = '';
    let htmlBody = '';

    function findParts(parts: GmailMessagePart[]): void {
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
function extractBodyParts(payload: GmailMessagePart | undefined): BodyParts {
  const result: BodyParts = { text: '', html: null };

  if (!payload) return result;

  function findParts(part: GmailMessagePart): void {
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
function extractAttachments(payload: GmailMessagePart | undefined): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = [];

  if (!payload) return attachments;

  function findAttachments(part: GmailMessagePart): void {
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
  accessToken: string,
  messageId: string,
  attachmentId: string
): Promise<string> {
  const response = await gmailApiCall<GmailAttachmentResponse>(
    accessToken,
    `/users/me/messages/${messageId}/attachments/${attachmentId}`
  );

  return response.data || '';
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

// =============================================================================
// Gmail API Operations
// =============================================================================

/**
 * Search for threads in a Gmail account
 */
async function searchThreads(
  refreshToken: string,
  query: string = 'is:unread',
  maxResults?: number
): Promise<{ threadId: string }[]> {
  const accessToken = await getAccessToken(refreshToken);

  const allThreads: { threadId: string }[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ q: query });
    if (maxResults !== undefined) {
      params.set('maxResults', maxResults.toString());
    }
    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const response = await gmailApiCall<GmailThreadListResponse>(
      accessToken,
      `/users/me/threads?${params}`
    );

    const threads = (response.threads || []).map(thread => ({
      threadId: thread.id || ''
    }));
    allThreads.push(...threads);

    pageToken = response.nextPageToken;

    // If a maxResults was specified and we've reached it, stop
    if (maxResults !== undefined && allThreads.length >= maxResults) {
      return allThreads.slice(0, maxResults);
    }
  } while (pageToken);

  return allThreads;
}

/**
 * Get full details of a thread (returns latest message details + all message IDs)
 */
async function getThreadDetails(
  refreshToken: string,
  threadId: string
): Promise<GmailThread> {
  const accessToken = await getAccessToken(refreshToken);

  const thread = await gmailApiCall<GmailThreadResponse>(
    accessToken,
    `/users/me/threads/${threadId}?format=full`
  );

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
 * Get thread metadata without body (uses format=metadata for lighter payloads)
 */
async function getThreadMetadata(
  refreshToken: string,
  threadId: string
): Promise<Omit<GmailThread, 'body'>> {
  const accessToken = await getAccessToken(refreshToken);

  const thread = await gmailApiCall<GmailThreadResponse>(
    accessToken,
    `/users/me/threads/${threadId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`
  );

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
  const accessToken = await getAccessToken(refreshToken);

  for (const messageId of messageIds) {
    await gmailApiCall<GmailMessage>(
      accessToken,
      `/users/me/messages/${messageId}/modify`,
      {
        method: 'POST',
        body: JSON.stringify({
          removeLabelIds: ['INBOX']
        })
      }
    );

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
  const accessToken = await getAccessToken(refreshToken);

  for (const messageId of messageIds) {
    await gmailApiCall<GmailMessage>(
      accessToken,
      `/users/me/messages/${messageId}/modify`,
      {
        method: 'POST',
        body: JSON.stringify({
          removeLabelIds: ['UNREAD']
        })
      }
    );

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/**
 * Send an email message
 */
async function sendMessage(
  refreshToken: string,
  options: SendMessageOptions
): Promise<{ id: string; threadId: string }> {
  const accessToken = await getAccessToken(refreshToken);

  // Build RFC 2822 formatted email
  const messageParts = [
    `To: ${options.to}`,
    `Subject: ${options.subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    options.body
  ];

  const raw = encodeBase64Url(messageParts.join('\r\n'));

  const response = await gmailApiCall<GmailSendResponse>(
    accessToken,
    '/users/me/messages/send',
    {
      method: 'POST',
      body: JSON.stringify({ raw })
    }
  );

  return {
    id: response.id || '',
    threadId: response.threadId || ''
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
  const accessToken = await getAccessToken(refreshToken);

  // Get the original message with full MIME structure
  const message = await gmailApiCall<GmailMessage>(
    accessToken,
    `/users/me/messages/${messageId}?format=full`
  );

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
      data = await fetchAttachmentData(accessToken, messageId, info.attachmentId);
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

  const raw = encodeBase64Url(newMessage);

  const sendResponse = await gmailApiCall<GmailSendResponse>(
    accessToken,
    '/users/me/messages/send',
    {
      method: 'POST',
      body: JSON.stringify({ raw })
    }
  );

  return {
    id: sendResponse.id || '',
    threadId: sendResponse.threadId || ''
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

// =============================================================================
// Exported Gmail Service
// =============================================================================

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
   * Get thread metadata without body (lighter API call)
   */
  getThreadMetadata,

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
