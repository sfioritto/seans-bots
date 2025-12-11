// Types for mercury-receipts brain

export interface RawEmail {
  id: string;
  subject: string;
  from: string;
  date: string;
  body: string;
  snippet: string;
  accountName: string;
  refreshToken: string;
}

// Mercury receipt request from email
export interface MercuryRequest {
  emailId: string;
  rawEmail: RawEmail;
  amount: string;        // e.g., "$200.00"
  merchant: string;      // e.g., "Anthropic"
  requestDate: string;   // Date of Mercury email
}

// Potential receipt match found in email archive
export interface ReceiptCandidate {
  emailId: string;
  rawEmail: RawEmail;
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
    selectedReceiptId: string | null;  // null = skip
  }>;
  mercuryEmailIds: string[];  // IDs to archive after forwarding
}
