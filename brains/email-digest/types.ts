// Shared types for email-digest brain

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

// Enrichment data for specific categories
export interface ChildrenEmailInfo {
  summary: string;
  actionItem: string | null;
}

export interface BillingEmailInfo {
  description: string;
  amount: string | null;
}

// Categories are arrays of email IDs, with optional enrichment data
export interface ProcessedEmails {
  emailsById: Record<string, RawEmail>;
  children: string[];
  amazon: string[];
  billing: string[];
  investments: string[];
  kickstarter: string[];
  newsletters: string[];
  marketing: string[];
  notifications: string[];
  npm: string[];
  // Enrichment data keyed by email ID
  childrenInfo: Record<string, ChildrenEmailInfo>;
  billingInfo: Record<string, BillingEmailInfo>;
  npmSummary?: string;
}
