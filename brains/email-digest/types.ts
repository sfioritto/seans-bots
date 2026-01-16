// Shared types for email-digest brain

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

// Enrichment data for specific categories
export interface ChildrenEmailInfo {
  summary: string;
  actionItem: string | null;
}

export interface BillingEmailInfo {
  description: string;
  amount: string | null;
}

export interface ReceiptsEmailInfo {
  description: string;
  amount: string | null;
}

// Categories are arrays of thread IDs, with optional enrichment data
export interface ProcessedEmails {
  threadsById: Record<string, RawThread>;
  children: string[];
  amazon: string[];
  billing: string[];
  receipts: string[];
  investments: string[];
  kickstarter: string[];
  newsletters: string[];
  marketing: string[];
  notifications: string[];
  npm: string[];
  securityAlerts: string[];
  confirmationCodes: string[];
  reminders: string[];
  financialNotifications: string[];
  shipping: string[];
  // Enrichment data keyed by thread ID
  childrenInfo: Record<string, ChildrenEmailInfo>;
  billingInfo: Record<string, BillingEmailInfo>;
  receiptsInfo: Record<string, ReceiptsEmailInfo>;
  npmSummary?: string;
  securityAlertsSummary?: string;
  confirmationCodesSummary?: string;
  remindersSummary?: string;
  financialSummary?: string;
  shippingSummary?: string;
}
