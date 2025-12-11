import { z } from 'zod';
import type { RawEmail, InvestmentEmail } from '../types.js';

export const investmentCategoryEnum = z.enum([
  'portfolio_update',
  'dividend',
  'trade_confirmation',
  'statement',
  'tax_document',
  'prospectus',
  'shareholder_notice',
  'performance_report',
  'other',
]);

export const investmentIdentificationSchema = z.object({
  investmentEmails: z.array(
    z.object({
      emailId: z.string().describe('The Gmail message ID'),
      isInvestment: z.boolean().describe('Whether this email is investment-related'),
      category: investmentCategoryEnum.optional().describe('The category of investment email'),
      source: z.string().optional().describe('The brokerage, fund, or company name'),
      summary: z.string().optional().describe('One sentence summary'),
    })
  ),
});

export function buildIdentificationPrompt(emails: RawEmail[]): string {
  if (emails.length === 0) {
    return 'No emails to analyze. Return an empty investmentEmails array.';
  }

  const emailSummaries = emails
    .map(
      (email, index) => `
Email ${index + 1}:
ID: ${email.id}
Subject: ${email.subject}
From: ${email.from}
Date: ${email.date}
Snippet: ${email.snippet}
Body Preview:
${email.body}
---`
    )
    .join('\n');

  return `You are identifying investment-related emails.

For each email, determine if it relates to investments, stocks, funds, retirement accounts, or financial portfolios.

INVESTMENT EMAILS INCLUDE:

PORTFOLIO UPDATES:
- Account value updates
- Performance summaries
- Asset allocation changes
- Market updates specific to your holdings
- Quarterly/monthly portfolio reviews

DIVIDENDS:
- Dividend payment notifications
- Dividend reinvestment confirmations
- Distribution notices

TRADE CONFIRMATIONS:
- Buy/sell confirmations
- Order executed notifications
- Trade settlement notices

STATEMENTS:
- Monthly/quarterly account statements
- Year-end statements
- Account summaries

TAX DOCUMENTS:
- 1099 forms available
- Tax document ready notifications
- Cost basis reports
- Year-end tax summaries

PROSPECTUS:
- Fund prospectus updates
- Prospectus supplements
- Annual/semi-annual reports

SHAREHOLDER NOTICES:
- Proxy voting materials
- Annual meeting notices
- Corporate actions (splits, mergers)
- Fund policy changes

PERFORMANCE REPORTS:
- Fund performance reports
- Annual reports
- Market commentary from your investment providers

DO NOT INCLUDE:
- Marketing emails promoting new investment products
- General financial news not specific to your investments
- Banking emails (checking, savings) - those are billing
- Credit card emails
- Cryptocurrency exchange marketing
- Generic newsletters about investing tips

CATEGORIES:
- portfolio_update: Updates on your portfolio value or holdings
- dividend: Dividend payments or reinvestments
- trade_confirmation: Confirmation of buy/sell orders
- statement: Account statements
- tax_document: Tax-related documents (1099s, etc.)
- prospectus: Fund prospectus or related documents
- shareholder_notice: Proxy votes, meeting notices, corporate actions
- performance_report: Performance reports from funds you own
- other: Other investment-related emails

SUMMARY GUIDELINES:
- Keep summaries to ONE sentence
- Focus on what the update is about
- Examples:
  - "Vanguard Total Stock Market quarterly performance report"
  - "Fidelity 401k balance update: $52,340"
  - "Dividend payment of $127.50 from VTSAX"
  - "Your 1099-DIV is ready for 2024"

Here are ${emails.length} emails to analyze:

${emailSummaries}

For each email, return its ID, whether it is investment-related, and if so the category, source, and summary.`;
}

export function processResults(
  emails: RawEmail[],
  identification: z.infer<typeof investmentIdentificationSchema>
): InvestmentEmail[] {
  const emailMap = new Map(emails.map(e => [e.id, e]));

  return identification.investmentEmails
    .filter(item => item.isInvestment && item.source && item.summary)
    .map(item => {
      const rawEmail = emailMap.get(item.emailId);
      if (!rawEmail) return null;

      return {
        emailId: item.emailId,
        rawEmail,
        category: item.category || 'other',
        source: item.source!,
        summary: item.summary!,
      };
    })
    .filter((item): item is InvestmentEmail => item !== null);
}

export function getClaimedIds(processed: InvestmentEmail[]): string[] {
  return processed.map(p => p.emailId);
}

export const categoryLabels: Record<string, string> = {
  portfolio_update: 'Portfolio Updates',
  dividend: 'Dividends',
  trade_confirmation: 'Trade Confirmations',
  statement: 'Statements',
  tax_document: 'Tax Documents',
  prospectus: 'Prospectus',
  shareholder_notice: 'Shareholder Notices',
  performance_report: 'Performance Reports',
  other: 'Other',
};
