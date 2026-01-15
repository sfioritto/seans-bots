// Types for mercury-receipts brain

export interface RawThread {
  threadId: string;
  subject: string;
  from: string;
  date: string;
  body: string;
  snippet: string;
  messageCount: number;
  messageIds: string[];
  accountName: string;
  refreshToken: string;
}

// Mercury receipt request from email thread
export interface MercuryRequest {
  threadId: string;
  rawThread: RawThread;
  amount: string;        // e.g., "$200.00"
  merchant: string;      // e.g., "Anthropic"
  requestDate: string;   // Date of Mercury email
}

// Potential receipt match found in email archive
export interface ReceiptCandidate {
  threadId: string;
  rawThread: RawThread;
  merchant: string;      // Extracted merchant name
  amount: string;        // Amount from receipt
  receiptDate: string;   // Date on receipt
  confidence: number;    // AI confidence in match (0-1)
  matchReason: string;   // Why AI thinks this matches
}

// A Mercury request with its matched receipts
export interface MercuryRequestWithMatches {
  request: MercuryRequest;
  matches: ReceiptCandidate[];
}

// Webhook response type
export interface MercuryReceiptsWebhookResponse {
  confirmed: boolean;
  selections: Array<{
    mercuryRequestId: string;
    selectedReceiptId: string | null;  // null = skip (now threadId)
  }>;
  mercuryThreadIds: string[];  // Thread IDs to archive after forwarding
}
