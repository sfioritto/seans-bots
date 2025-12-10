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

// Action item that can be attached to any email
export interface ActionItem {
  description: string;
  exactQuote: string;
  context: string;
  link: string;
  steps: string[];
}

// Map of email ID to action items for that email
export interface ActionItemsMap {
  [emailId: string]: ActionItem[];
}

// Amazon emails
export interface AmazonEmail {
  emailId: string;
  rawEmail: RawEmail;
  category: 'order_confirmation' | 'shipping_notification' | 'delivery_notification' | 'delivery_delay' | 'billing' | 'return_refund' | 'promotional' | 'account_security' | 'other';
  summary: string;
}

// Receipt emails
export interface ReceiptEmail {
  emailId: string;
  rawEmail: RawEmail;
  merchant: string;
  summary: string;
  charges: Array<{ description: string; amount: string }>;
}

// Kickstarter emails
export interface KickstarterEmail {
  emailId: string;
  rawEmail: RawEmail;
  summary: string;
  actionItems: string[];
}

// Newsletter emails
export interface NewsletterEmail {
  emailId: string;
  rawEmail: RawEmail;
  newsletterName: string;
  summary: string;
  deadlines: string[];
}

// Processed results by category
export interface ProcessedEmails {
  amazon: AmazonEmail[];
  receipts: ReceiptEmail[];
  kickstarter: KickstarterEmail[];
  newsletters: NewsletterEmail[];
  actionItemsMap: ActionItemsMap;  // Action items keyed by email ID
}
