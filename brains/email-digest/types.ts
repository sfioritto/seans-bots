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

// Isaac-related emails (school, rock climbing, summer camps, etc.)
export interface IsaacEmail {
  emailId: string;
  rawEmail: RawEmail;
  category: 'school' | 'rock_climbing' | 'summer_camp' | 'choir' | 'extracurricular' | 'health' | 'other';
  summary: string;
  actionItems: Array<{
    description: string;
    exactQuote: string;
    context: string;
    link: string;
    steps: string[];
  }>;
}

// Amazon emails
export interface AmazonEmail {
  emailId: string;
  rawEmail: RawEmail;
  category: 'order_confirmation' | 'shipping_notification' | 'delivery_notification' | 'delivery_delay' | 'billing' | 'return_refund' | 'promotional' | 'account_security' | 'other';
  summary: string;
}

// Billing emails (receipts, invoices, subscriptions, bank statements, etc.)
export interface BillingEmail {
  emailId: string;
  rawEmail: RawEmail;
  category: 'receipt' | 'invoice' | 'subscription_renewal' | 'payment_due' | 'bank_statement' | 'payment_confirmation' | 'refund' | 'other';
  source: string;
  summary: string;
  amounts: Array<{ description: string; amount: string }>;
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

// Marketing emails
export interface MarketingEmail {
  emailId: string;
  rawEmail: RawEmail;
  brand: string;
  summary: string;
}

// Low-value notification emails (product updates, policy changes, generic announcements)
export interface NotificationEmail {
  emailId: string;
  rawEmail: RawEmail;
  source: string;
  summary: string;
}

// Processed results by category
export interface ProcessedEmails {
  isaac: IsaacEmail[];
  amazon: AmazonEmail[];
  billing: BillingEmail[];
  kickstarter: KickstarterEmail[];
  newsletters: NewsletterEmail[];
  marketing: MarketingEmail[];
  notifications: NotificationEmail[];
  actionItemsMap: ActionItemsMap;  // Action items keyed by email ID
}
