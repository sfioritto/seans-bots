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

// Categories are just arrays of email IDs
export interface ProcessedEmails {
  emailsById: Record<string, RawEmail>;
  isaac: string[];
  amazon: string[];
  billing: string[];
  investments: string[];
  kickstarter: string[];
  newsletters: string[];
  marketing: string[];
  notifications: string[];
}
