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
}

// All possible email categories
export type EmailCategory =
  | 'skip'
  | 'children'
  | 'amazon'
  | 'billing'
  | 'receipts'
  | 'investments'
  | 'kickstarter'
  | 'newsletters'
  | 'marketing'
  | 'notifications'
  | 'npm'
  | 'securityAlerts'
  | 'confirmationCodes'
  | 'reminders'
  | 'financialNotifications'
  | 'shipping';

// Enrichment data for specific categories
export interface ChildrenEmailInfo {
  summary: string;
  actionItem: string | null;
}

export interface BillingEmailInfo {
  description: string;
  amount: string;
}

export interface ReceiptLineItem {
  item: string;
  amount: string | null;
}

export interface ReceiptsEmailInfo {
  description: string;
  totalAmount: string | null;
  lineItems: ReceiptLineItem[];
}

export interface NewsletterEmailInfo {
  webLink: string | null;
  unsubscribeLink: string | null;
}

export interface FinancialEmailInfo {
  description: string;
  amount: string | null;
}

// Discriminated union for enrichment data
export type EnrichmentData =
  | { type: 'children'; info: ChildrenEmailInfo }
  | { type: 'billing'; info: BillingEmailInfo }
  | { type: 'receipts'; info: ReceiptsEmailInfo }
  | { type: 'newsletters'; info: NewsletterEmailInfo }
  | { type: 'financial'; info: FinancialEmailInfo }
  | null;

// Unified email entry - everything about one email in one place
export interface CategorizedEmail {
  thread: RawThread;
  category: EmailCategory;
  enrichment: EnrichmentData;
}

// Category-level summaries (aggregate across threads, not per-thread)
export interface CategorySummaries {
  npm?: string;
  securityAlerts?: string;
  confirmationCodes?: string;
  reminders?: string;
  financial?: string;
  shipping?: string;
}

// Simplified ProcessedEmails for the template
export interface ProcessedEmails {
  emails: CategorizedEmail[];
  summaries: CategorySummaries;
}
