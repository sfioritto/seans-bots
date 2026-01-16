import type { ProcessedEmails, RawThread, ChildrenEmailInfo, BillingEmailInfo, ReceiptsEmailInfo } from '../types.js';

interface CategoryConfig {
  id: string;
  label: string;
  color: string;
  borderColor: string;
}

const categories: CategoryConfig[] = [
  { id: 'children', label: 'Children', color: '#ef4444', borderColor: '#dc2626' },
  { id: 'amazon', label: 'Amazon', color: '#ff9900', borderColor: '#e88b00' },
  { id: 'billing', label: 'Billing', color: '#059669', borderColor: '#047857' },
  { id: 'receipts', label: 'Receipts', color: '#10b981', borderColor: '#059669' },
  { id: 'investments', label: 'Investments', color: '#0891b2', borderColor: '#0e7490' },
  { id: 'kickstarter', label: 'Kickstarter', color: '#05ce78', borderColor: '#04b569' },
  { id: 'newsletters', label: 'Newsletters', color: '#6366f1', borderColor: '#4f46e5' },
  { id: 'marketing', label: 'Marketing', color: '#ec4899', borderColor: '#db2777' },
  { id: 'notifications', label: 'Notifications', color: '#8b5cf6', borderColor: '#7c3aed' },
];

function renderThreadList(threadIds: string[], threadsById: Record<string, RawThread>): string {
  return threadIds.map(threadId => {
    const thread = threadsById[threadId];
    if (!thread) return '';

    return `
      <div class="email-item">
        <label class="checkbox-label">
          <input type="checkbox" name="threadIds" value="${threadId}" checked>
          <div class="email-content">
            <span class="email-subject">${escapeHtml(thread.subject)}</span>
            <span class="email-from">${escapeHtml(thread.from)}</span>
            <span class="email-snippet">${escapeHtml(thread.snippet)}</span>
          </div>
        </label>
      </div>
    `;
  }).join('');
}

function renderChildrenThreadList(
  threadIds: string[],
  threadsById: Record<string, RawThread>,
  childrenInfo: Record<string, ChildrenEmailInfo>
): string {
  return threadIds.map(threadId => {
    const thread = threadsById[threadId];
    if (!thread) return '';

    const info = childrenInfo[threadId];
    const hasAction = info?.actionItem;

    return `
      <div class="email-item ${hasAction ? 'has-action' : ''}">
        <label class="checkbox-label">
          <input type="checkbox" name="threadIds" value="${threadId}" checked>
          <div class="email-content">
            <span class="email-subject">${escapeHtml(thread.subject)}</span>
            <span class="email-from">${escapeHtml(thread.from)}</span>
            ${info ? `<span class="email-summary">${escapeHtml(info.summary)}</span>` : ''}
            ${hasAction ? `<span class="action-item">Action: ${escapeHtml(info.actionItem!)}</span>` : ''}
          </div>
        </label>
      </div>
    `;
  }).join('');
}

function renderBillingThreadList(
  threadIds: string[],
  threadsById: Record<string, RawThread>,
  billingInfo: Record<string, BillingEmailInfo>
): string {
  return threadIds.map(threadId => {
    const thread = threadsById[threadId];
    if (!thread) return '';

    const info = billingInfo[threadId];

    return `
      <div class="email-item">
        <label class="checkbox-label">
          <input type="checkbox" name="threadIds" value="${threadId}" checked>
          <div class="email-content">
            <div class="billing-header">
              <span class="email-subject">${escapeHtml(thread.subject)}</span>
              ${info?.amount ? `<span class="billing-amount">${escapeHtml(info.amount)}</span>` : ''}
            </div>
            <span class="email-from">${escapeHtml(thread.from)}</span>
            ${info ? `<span class="email-summary">${escapeHtml(info.description)}</span>` : `<span class="email-snippet">${escapeHtml(thread.snippet)}</span>`}
          </div>
        </label>
      </div>
    `;
  }).join('');
}

function renderReceiptsThreadList(
  threadIds: string[],
  threadsById: Record<string, RawThread>,
  receiptsInfo: Record<string, ReceiptsEmailInfo>
): string {
  return threadIds.map(threadId => {
    const thread = threadsById[threadId];
    if (!thread) return '';

    const info = receiptsInfo[threadId];

    return `
      <div class="email-item">
        <label class="checkbox-label">
          <input type="checkbox" name="threadIds" value="${threadId}" checked>
          <div class="email-content">
            <div class="receipts-header">
              <span class="email-subject">${escapeHtml(thread.subject)}</span>
              ${info?.amount ? `<span class="receipts-amount">${escapeHtml(info.amount)}</span>` : ''}
            </div>
            <span class="email-from">${escapeHtml(thread.from)}</span>
            ${info ? `<span class="email-summary">${escapeHtml(info.description)}</span>` : `<span class="email-snippet">${escapeHtml(thread.snippet)}</span>`}
          </div>
        </label>
      </div>
    `;
  }).join('');
}

function renderNpmSection(
  threadIds: string[],
  threadsById: Record<string, RawThread>,
  npmSummary: string
): string {
  const threadList = threadIds.map(threadId => {
    const thread = threadsById[threadId];
    if (!thread) return '';

    return `
      <div class="email-item">
        <label class="checkbox-label">
          <input type="checkbox" name="threadIds" value="${threadId}" checked>
          <div class="email-content">
            <span class="email-subject">${escapeHtml(thread.subject)}</span>
            <span class="email-from">${escapeHtml(thread.from)}</span>
          </div>
        </label>
      </div>
    `;
  }).join('');

  return `
    <div class="npm-summary-container">
      <label class="checkbox-label npm-summary-label">
        <input type="checkbox" class="select-all-section" data-section="npm-section" checked>
        <div class="npm-summary-content">
          <span class="npm-summary-title">NPM Packages</span>
          <ul class="summary-list">${formatSummaryAsBullets(npmSummary)}</ul>
        </div>
      </label>
    </div>
    <details class="npm-details">
      <summary class="npm-details-toggle">${threadIds.length} notification${threadIds.length !== 1 ? 's' : ''}</summary>
      <div class="npm-emails-list">
        ${threadList}
      </div>
    </details>
  `;
}

function renderSecurityAlertsSection(
  threadIds: string[],
  threadsById: Record<string, RawThread>,
  securityAlertsSummary: string
): string {
  const threadList = threadIds.map(threadId => {
    const thread = threadsById[threadId];
    if (!thread) return '';

    return `
      <div class="email-item">
        <label class="checkbox-label">
          <input type="checkbox" name="threadIds" value="${threadId}" checked>
          <div class="email-content">
            <span class="email-subject">${escapeHtml(thread.subject)}</span>
            <span class="email-from">${escapeHtml(thread.from)}</span>
          </div>
        </label>
      </div>
    `;
  }).join('');

  return `
    <div class="security-summary-container">
      <label class="checkbox-label security-summary-label">
        <input type="checkbox" class="select-all-section" data-section="security-section" checked>
        <div class="security-summary-content">
          <span class="security-summary-title">Security Alerts</span>
          <ul class="summary-list">${formatSummaryAsBullets(securityAlertsSummary)}</ul>
        </div>
      </label>
    </div>
    <details class="security-details">
      <summary class="security-details-toggle">${threadIds.length} alert${threadIds.length !== 1 ? 's' : ''}</summary>
      <div class="security-emails-list">
        ${threadList}
      </div>
    </details>
  `;
}

function renderConfirmationCodesSection(
  threadIds: string[],
  threadsById: Record<string, RawThread>,
  confirmationCodesSummary: string
): string {
  const threadList = threadIds.map(threadId => {
    const thread = threadsById[threadId];
    if (!thread) return '';

    return `
      <div class="email-item">
        <label class="checkbox-label">
          <input type="checkbox" name="threadIds" value="${threadId}" checked>
          <div class="email-content">
            <span class="email-subject">${escapeHtml(thread.subject)}</span>
            <span class="email-from">${escapeHtml(thread.from)}</span>
          </div>
        </label>
      </div>
    `;
  }).join('');

  return `
    <div class="codes-summary-container">
      <label class="checkbox-label codes-summary-label">
        <input type="checkbox" class="select-all-section" data-section="codes-section" checked>
        <div class="codes-summary-content">
          <span class="codes-summary-title">Confirmation Codes</span>
          <ul class="summary-list">${formatSummaryAsBullets(confirmationCodesSummary)}</ul>
        </div>
      </label>
    </div>
    <details class="codes-details">
      <summary class="codes-details-toggle">${threadIds.length} code${threadIds.length !== 1 ? 's' : ''}</summary>
      <div class="codes-emails-list">
        ${threadList}
      </div>
    </details>
  `;
}

function renderRemindersSection(
  threadIds: string[],
  threadsById: Record<string, RawThread>,
  remindersSummary: string
): string {
  const threadList = threadIds.map(threadId => {
    const thread = threadsById[threadId];
    if (!thread) return '';

    return `
      <div class="email-item">
        <label class="checkbox-label">
          <input type="checkbox" name="threadIds" value="${threadId}" checked>
          <div class="email-content">
            <span class="email-subject">${escapeHtml(thread.subject)}</span>
            <span class="email-from">${escapeHtml(thread.from)}</span>
          </div>
        </label>
      </div>
    `;
  }).join('');

  return `
    <div class="reminders-summary-container">
      <label class="checkbox-label reminders-summary-label">
        <input type="checkbox" class="select-all-section" data-section="reminders-section" checked>
        <div class="reminders-summary-content">
          <span class="reminders-summary-title">Reminders</span>
          <ul class="summary-list">${formatSummaryAsBullets(remindersSummary)}</ul>
        </div>
      </label>
    </div>
    <details class="reminders-details">
      <summary class="reminders-details-toggle">${threadIds.length} reminder${threadIds.length !== 1 ? 's' : ''}</summary>
      <div class="reminders-emails-list">
        ${threadList}
      </div>
    </details>
  `;
}

function renderFinancialSection(
  threadIds: string[],
  threadsById: Record<string, RawThread>,
  financialSummary: string
): string {
  const threadList = threadIds.map(threadId => {
    const thread = threadsById[threadId];
    if (!thread) return '';

    return `
      <div class="email-item">
        <label class="checkbox-label">
          <input type="checkbox" name="threadIds" value="${threadId}" checked>
          <div class="email-content">
            <span class="email-subject">${escapeHtml(thread.subject)}</span>
            <span class="email-from">${escapeHtml(thread.from)}</span>
          </div>
        </label>
      </div>
    `;
  }).join('');

  return `
    <div class="financial-summary-container">
      <label class="checkbox-label financial-summary-label">
        <input type="checkbox" class="select-all-section" data-section="financial-section" checked>
        <div class="financial-summary-content">
          <span class="financial-summary-title">Financial</span>
          <ul class="summary-list">${formatSummaryAsBullets(financialSummary)}</ul>
        </div>
      </label>
    </div>
    <details class="financial-details">
      <summary class="financial-details-toggle">${threadIds.length} notification${threadIds.length !== 1 ? 's' : ''}</summary>
      <div class="financial-emails-list">
        ${threadList}
      </div>
    </details>
  `;
}

function renderShippingSection(
  threadIds: string[],
  threadsById: Record<string, RawThread>,
  shippingSummary: string
): string {
  const threadList = threadIds.map(threadId => {
    const thread = threadsById[threadId];
    if (!thread) return '';

    return `
      <div class="email-item">
        <label class="checkbox-label">
          <input type="checkbox" name="threadIds" value="${threadId}" checked>
          <div class="email-content">
            <span class="email-subject">${escapeHtml(thread.subject)}</span>
            <span class="email-from">${escapeHtml(thread.from)}</span>
          </div>
        </label>
      </div>
    `;
  }).join('');

  return `
    <div class="shipping-summary-container">
      <label class="checkbox-label shipping-summary-label">
        <input type="checkbox" class="select-all-section" data-section="shipping-section" checked>
        <div class="shipping-summary-content">
          <span class="shipping-summary-title">Shipping</span>
          <ul class="summary-list">${formatSummaryAsBullets(shippingSummary)}</ul>
        </div>
      </label>
    </div>
    <details class="shipping-details">
      <summary class="shipping-details-toggle">${threadIds.length} update${threadIds.length !== 1 ? 's' : ''}</summary>
      <div class="shipping-emails-list">
        ${threadList}
      </div>
    </details>
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatSummaryAsBullets(summary: string): string {
  if (!summary) return '<li>No summary available</li>';
  const items = summary.split(';').map(item => item.trim()).filter(Boolean);
  return items.map(item => `<li>${escapeHtml(item)}</li>`).join('');
}

export function generateUnifiedPage(
  processed: ProcessedEmails,
  sessionId: string,
  webhookUrl: string
): string {
  // Combine all notification types for the tab count
  const allNotificationsCount =
    processed.notifications.length +
    processed.npm.length +
    processed.securityAlerts.length +
    processed.confirmationCodes.length +
    processed.reminders.length +
    processed.financialNotifications.length +
    processed.shipping.length;

  const counts = {
    children: processed.children.length,
    amazon: processed.amazon.length,
    billing: processed.billing.length,
    receipts: processed.receipts.length,
    investments: processed.investments.length,
    kickstarter: processed.kickstarter.length,
    newsletters: processed.newsletters.length,
    marketing: processed.marketing.length,
    notifications: allNotificationsCount,
  };

  const totalThreads = Object.values(counts).reduce((a, b) => a + b, 0);

  const allThreadIds = [
    ...processed.children,
    ...processed.amazon,
    ...processed.billing,
    ...processed.receipts,
    ...processed.investments,
    ...processed.kickstarter,
    ...processed.newsletters,
    ...processed.marketing,
    ...processed.notifications,
    ...processed.npm,
    ...processed.securityAlerts,
    ...processed.confirmationCodes,
    ...processed.reminders,
    ...processed.financialNotifications,
    ...processed.shipping,
  ];

  const activeTabs = categories.filter(cat => counts[cat.id as keyof typeof counts] > 0);
  const firstActiveTab = activeTabs[0]?.id || 'children';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Digest</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 700px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    h1 {
      color: #1f2937;
      margin-bottom: 10px;
    }
    .summary-header {
      background: white;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-bottom: 20px;
    }
    .tab {
      padding: 10px 16px;
      border: none;
      background: white;
      border-radius: 8px 8px 0 0;
      cursor: pointer;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .tab.active {
      position: relative;
      z-index: 1;
    }
    .tab .count {
      background: #e5e7eb;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.85em;
    }
    .tab.active .count {
      background: white;
    }
    ${categories.map(cat => `
    .tab[data-tab="${cat.id}"] { border-left: 3px solid ${cat.color}; }
    .tab[data-tab="${cat.id}"].active { background: ${cat.color}; color: white; }
    `).join('')}
    .tab-content {
      display: none;
      background: white;
      padding: 20px;
      border-radius: 0 8px 8px 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .tab-content.active {
      display: block;
    }
    .select-all-container {
      padding: 10px 0;
      margin-bottom: 15px;
      border-bottom: 1px solid #e5e7eb;
    }
    .select-all-container label {
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      font-weight: bold;
    }
    .email-item {
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 10px;
      background: #f9fafb;
    }
    .email-item.has-action {
      border-left: 4px solid #ef4444;
      background: #fef2f2;
    }
    .checkbox-label {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      cursor: pointer;
    }
    .checkbox-label input[type="checkbox"] {
      margin-top: 3px;
      width: 18px;
      height: 18px;
      cursor: pointer;
    }
    .email-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .email-subject {
      font-weight: 600;
      color: #1f2937;
    }
    .email-from {
      color: #6b7280;
      font-size: 0.9em;
    }
    .email-snippet {
      color: #9ca3af;
      font-size: 0.85em;
      line-height: 1.4;
    }
    .email-summary {
      color: #4b5563;
      font-size: 0.9em;
      line-height: 1.4;
    }
    .action-item {
      color: #dc2626;
      font-weight: 600;
      font-size: 0.9em;
      margin-top: 4px;
    }
    .billing-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
    }
    .billing-amount {
      font-weight: 700;
      color: #059669;
      font-size: 1.1em;
      white-space: nowrap;
    }
    .receipts-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
    }
    .receipts-amount {
      font-weight: 700;
      color: #10b981;
      font-size: 1.1em;
      white-space: nowrap;
    }
    .npm-summary-container {
      background: #fef2f2;
      border: 1px solid #cb3837;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 15px;
    }
    .npm-summary-label {
      align-items: flex-start;
    }
    .npm-summary-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .npm-summary-title {
      font-weight: 700;
      color: #cb3837;
      font-size: 1em;
    }
    .summary-list {
      margin: 0;
      padding-left: 20px;
      color: #4b5563;
      font-size: 0.95em;
      line-height: 1.6;
    }
    .summary-list li {
      margin-bottom: 2px;
    }
    .npm-summary-text {
      color: #4b5563;
      font-size: 0.95em;
      line-height: 1.5;
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
    }
    .npm-details {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
    }
    .npm-details-toggle {
      padding: 12px 15px;
      background: #f9fafb;
      cursor: pointer;
      font-weight: 500;
      color: #6b7280;
      user-select: none;
    }
    .npm-details-toggle:hover {
      background: #f3f4f6;
    }
    .npm-details[open] .npm-details-toggle {
      border-bottom: 1px solid #e5e7eb;
    }
    .npm-emails-list {
      padding: 10px;
    }
    .npm-emails-list .email-item {
      margin-bottom: 8px;
    }
    .npm-emails-list .email-item:last-child {
      margin-bottom: 0;
    }
    .security-summary-container {
      background: #fef2f2;
      border: 1px solid #dc2626;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 15px;
    }
    .security-summary-label {
      align-items: flex-start;
    }
    .security-summary-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .security-summary-title {
      font-weight: 700;
      color: #dc2626;
      font-size: 1em;
    }
    .security-summary-text {
      color: #4b5563;
      font-size: 0.95em;
      line-height: 1.5;
    }
    .security-details {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
    }
    .security-details-toggle {
      padding: 12px 15px;
      background: #f9fafb;
      cursor: pointer;
      font-weight: 500;
      color: #6b7280;
      user-select: none;
    }
    .security-details-toggle:hover {
      background: #f3f4f6;
    }
    .security-details[open] .security-details-toggle {
      border-bottom: 1px solid #e5e7eb;
    }
    .security-emails-list {
      padding: 10px;
    }
    .security-emails-list .email-item {
      margin-bottom: 8px;
    }
    .security-emails-list .email-item:last-child {
      margin-bottom: 0;
    }
    .codes-summary-container {
      background: #f5f3ff;
      border: 1px solid #7c3aed;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 15px;
    }
    .codes-summary-label {
      align-items: flex-start;
    }
    .codes-summary-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .codes-summary-title {
      font-weight: 700;
      color: #7c3aed;
      font-size: 1em;
    }
    .codes-summary-text {
      color: #4b5563;
      font-size: 0.95em;
      line-height: 1.5;
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
    }
    .codes-details {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
    }
    .codes-details-toggle {
      padding: 12px 15px;
      background: #f9fafb;
      cursor: pointer;
      font-weight: 500;
      color: #6b7280;
      user-select: none;
    }
    .codes-details-toggle:hover {
      background: #f3f4f6;
    }
    .codes-details[open] .codes-details-toggle {
      border-bottom: 1px solid #e5e7eb;
    }
    .codes-emails-list {
      padding: 10px;
    }
    .codes-emails-list .email-item {
      margin-bottom: 8px;
    }
    .codes-emails-list .email-item:last-child {
      margin-bottom: 0;
    }
    .reminders-summary-container {
      background: #fefce8;
      border: 1px solid #ca8a04;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 15px;
    }
    .reminders-summary-label {
      align-items: flex-start;
    }
    .reminders-summary-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .reminders-summary-title {
      font-weight: 700;
      color: #ca8a04;
      font-size: 1em;
    }
    .reminders-summary-text {
      color: #4b5563;
      font-size: 0.95em;
      line-height: 1.5;
    }
    .reminders-details {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
    }
    .reminders-details-toggle {
      padding: 12px 15px;
      background: #f9fafb;
      cursor: pointer;
      font-weight: 500;
      color: #6b7280;
      user-select: none;
    }
    .reminders-details-toggle:hover {
      background: #f3f4f6;
    }
    .reminders-details[open] .reminders-details-toggle {
      border-bottom: 1px solid #e5e7eb;
    }
    .reminders-emails-list {
      padding: 10px;
    }
    .reminders-emails-list .email-item {
      margin-bottom: 8px;
    }
    .reminders-emails-list .email-item:last-child {
      margin-bottom: 0;
    }
    .financial-summary-container {
      background: #eff6ff;
      border: 1px solid #3b82f6;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 15px;
    }
    .financial-summary-label {
      align-items: flex-start;
    }
    .financial-summary-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .financial-summary-title {
      font-weight: 700;
      color: #3b82f6;
      font-size: 1em;
    }
    .financial-details {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
    }
    .financial-details-toggle {
      padding: 12px 15px;
      background: #f9fafb;
      cursor: pointer;
      font-weight: 500;
      color: #6b7280;
      user-select: none;
    }
    .financial-details-toggle:hover {
      background: #f3f4f6;
    }
    .financial-details[open] .financial-details-toggle {
      border-bottom: 1px solid #e5e7eb;
    }
    .financial-emails-list {
      padding: 10px;
    }
    .financial-emails-list .email-item {
      margin-bottom: 8px;
    }
    .financial-emails-list .email-item:last-child {
      margin-bottom: 0;
    }
    .shipping-summary-container {
      background: #fff7ed;
      border: 1px solid #f97316;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 15px;
    }
    .shipping-summary-label {
      align-items: flex-start;
    }
    .shipping-summary-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .shipping-summary-title {
      font-weight: 700;
      color: #f97316;
      font-size: 1em;
    }
    .shipping-details {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
    }
    .shipping-details-toggle {
      padding: 12px 15px;
      background: #f9fafb;
      cursor: pointer;
      font-weight: 500;
      color: #6b7280;
      user-select: none;
    }
    .shipping-details-toggle:hover {
      background: #f3f4f6;
    }
    .shipping-details[open] .shipping-details-toggle {
      border-bottom: 1px solid #e5e7eb;
    }
    .shipping-emails-list {
      padding: 10px;
    }
    .shipping-emails-list .email-item {
      margin-bottom: 8px;
    }
    .shipping-emails-list .email-item:last-child {
      margin-bottom: 0;
    }
    .notification-subsection {
      margin-bottom: 20px;
    }
    .notification-subsection:last-child {
      margin-bottom: 0;
    }
    .other-notifications-details {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
    }
    .other-notifications-toggle {
      padding: 12px 15px;
      background: #f9fafb;
      cursor: pointer;
      font-weight: 500;
      color: #6b7280;
      user-select: none;
    }
    .other-notifications-toggle:hover {
      background: #f3f4f6;
    }
    .other-notifications-details[open] .other-notifications-toggle {
      border-bottom: 1px solid #e5e7eb;
    }
    .other-notifications-list {
      padding: 10px;
    }
    .other-notifications-list .email-item {
      margin-bottom: 8px;
    }
    .other-notifications-list .email-item:last-child {
      margin-bottom: 0;
    }
    .archive-form {
      margin-top: 30px;
    }
    .form-actions {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }
    .archive-btn {
      background: #1f2937;
      color: white;
      border: none;
      padding: 15px 30px;
      font-size: 1.1em;
      border-radius: 8px;
      cursor: pointer;
      font-weight: bold;
    }
    .archive-btn:hover { background: #374151; }
    .archive-btn:active { transform: scale(0.98); }
    .select-btn {
      background: white;
      border: 1px solid #d1d5db;
      padding: 10px 16px;
      border-radius: 6px;
      cursor: pointer;
    }
    .select-btn:hover { background: #f9fafb; }
  </style>
</head>
<body>
  <h1>Email Digest</h1>
  <div class="summary-header">
    <strong>${totalThreads} threads</strong> found across ${activeTabs.length} categories
  </div>

  <div class="tabs">
    ${activeTabs.map(cat => `
      <button class="tab ${cat.id === firstActiveTab ? 'active' : ''}" data-tab="${cat.id}">
        ${cat.label} <span class="count">${counts[cat.id as keyof typeof counts]}</span>
      </button>
    `).join('')}
  </div>

  <form class="archive-form" action="${webhookUrl}" method="POST">
    <input type="hidden" name="sessionId" value="${sessionId}">
    <input type="hidden" name="allThreadIds" value='${JSON.stringify(allThreadIds)}'>

    ${counts.children > 0 ? `
      <div id="children" class="tab-content ${firstActiveTab === 'children' ? 'active' : ''}">
        <div class="select-all-container">
          <label>
            <input type="checkbox" class="select-all-tab" data-tab="children" checked>
            Select All Children
          </label>
        </div>
        ${renderChildrenThreadList(processed.children, processed.threadsById, processed.childrenInfo)}
      </div>
    ` : ''}

    ${counts.amazon > 0 ? `
      <div id="amazon" class="tab-content ${firstActiveTab === 'amazon' ? 'active' : ''}">
        <div class="select-all-container">
          <label>
            <input type="checkbox" class="select-all-tab" data-tab="amazon" checked>
            Select All Amazon
          </label>
        </div>
        ${renderThreadList(processed.amazon, processed.threadsById)}
      </div>
    ` : ''}

    ${counts.billing > 0 ? `
      <div id="billing" class="tab-content ${firstActiveTab === 'billing' ? 'active' : ''}">
        <div class="select-all-container">
          <label>
            <input type="checkbox" class="select-all-tab" data-tab="billing" checked>
            Select All Billing
          </label>
        </div>
        ${renderBillingThreadList(processed.billing, processed.threadsById, processed.billingInfo)}
      </div>
    ` : ''}

    ${counts.receipts > 0 ? `
      <div id="receipts" class="tab-content ${firstActiveTab === 'receipts' ? 'active' : ''}">
        <div class="select-all-container">
          <label>
            <input type="checkbox" class="select-all-tab" data-tab="receipts" checked>
            Select All Receipts
          </label>
        </div>
        ${renderReceiptsThreadList(processed.receipts, processed.threadsById, processed.receiptsInfo)}
      </div>
    ` : ''}

    ${counts.investments > 0 ? `
      <div id="investments" class="tab-content ${firstActiveTab === 'investments' ? 'active' : ''}">
        <div class="select-all-container">
          <label>
            <input type="checkbox" class="select-all-tab" data-tab="investments" checked>
            Select All Investments
          </label>
        </div>
        ${renderThreadList(processed.investments, processed.threadsById)}
      </div>
    ` : ''}

    ${counts.kickstarter > 0 ? `
      <div id="kickstarter" class="tab-content ${firstActiveTab === 'kickstarter' ? 'active' : ''}">
        <div class="select-all-container">
          <label>
            <input type="checkbox" class="select-all-tab" data-tab="kickstarter" checked>
            Select All Kickstarter
          </label>
        </div>
        ${renderThreadList(processed.kickstarter, processed.threadsById)}
      </div>
    ` : ''}

    ${counts.newsletters > 0 ? `
      <div id="newsletters" class="tab-content ${firstActiveTab === 'newsletters' ? 'active' : ''}">
        <div class="select-all-container">
          <label>
            <input type="checkbox" class="select-all-tab" data-tab="newsletters" checked>
            Select All Newsletters
          </label>
        </div>
        ${renderThreadList(processed.newsletters, processed.threadsById)}
      </div>
    ` : ''}

    ${counts.marketing > 0 ? `
      <div id="marketing" class="tab-content ${firstActiveTab === 'marketing' ? 'active' : ''}">
        <div class="select-all-container">
          <label>
            <input type="checkbox" class="select-all-tab" data-tab="marketing" checked>
            Select All Marketing
          </label>
        </div>
        ${renderThreadList(processed.marketing, processed.threadsById)}
      </div>
    ` : ''}

    ${counts.notifications > 0 ? `
      <div id="notifications" class="tab-content ${firstActiveTab === 'notifications' ? 'active' : ''}">
        <div class="select-all-container">
          <label>
            <input type="checkbox" class="select-all-tab" data-tab="notifications" checked>
            Select All Notifications
          </label>
        </div>

        ${processed.npm.length > 0 ? `
          <div id="npm-section" class="notification-subsection">
            ${renderNpmSection(processed.npm, processed.threadsById, processed.npmSummary || '')}
          </div>
        ` : ''}

        ${processed.securityAlerts.length > 0 ? `
          <div id="security-section" class="notification-subsection">
            ${renderSecurityAlertsSection(processed.securityAlerts, processed.threadsById, processed.securityAlertsSummary || '')}
          </div>
        ` : ''}

        ${processed.confirmationCodes.length > 0 ? `
          <div id="codes-section" class="notification-subsection">
            ${renderConfirmationCodesSection(processed.confirmationCodes, processed.threadsById, processed.confirmationCodesSummary || '')}
          </div>
        ` : ''}

        ${processed.reminders.length > 0 ? `
          <div id="reminders-section" class="notification-subsection">
            ${renderRemindersSection(processed.reminders, processed.threadsById, processed.remindersSummary || '')}
          </div>
        ` : ''}

        ${processed.financialNotifications.length > 0 ? `
          <div id="financial-section" class="notification-subsection">
            ${renderFinancialSection(processed.financialNotifications, processed.threadsById, processed.financialSummary || '')}
          </div>
        ` : ''}

        ${processed.shipping.length > 0 ? `
          <div id="shipping-section" class="notification-subsection">
            ${renderShippingSection(processed.shipping, processed.threadsById, processed.shippingSummary || '')}
          </div>
        ` : ''}

        ${processed.notifications.length > 0 ? `
          <div id="other-notifications-section" class="notification-subsection">
            <details class="other-notifications-details" open>
              <summary class="other-notifications-toggle">Other Notifications (${processed.notifications.length})</summary>
              <div class="other-notifications-list">
                ${renderThreadList(processed.notifications, processed.threadsById)}
              </div>
            </details>
          </div>
        ` : ''}
      </div>
    ` : ''}

    <div class="form-actions">
      <button type="button" class="select-btn" onclick="selectAll()">Select All</button>
      <button type="button" class="select-btn" onclick="selectNone()">Select None</button>
      <button type="submit" class="archive-btn">Archive Selected</button>
    </div>
  </form>

  <script>
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
      });
    });

    document.querySelectorAll('.select-all-tab').forEach(checkbox => {
      checkbox.addEventListener('change', function() {
        const tabId = this.dataset.tab;
        document.querySelectorAll('#' + tabId + ' input[name="threadIds"]').forEach(cb => {
          cb.checked = this.checked;
        });
        // Also update section checkboxes within this tab
        document.querySelectorAll('#' + tabId + ' .select-all-section').forEach(cb => {
          cb.checked = this.checked;
        });
      });
    });

    // Section-specific select all (for npm, security, codes subsections)
    document.querySelectorAll('.select-all-section').forEach(checkbox => {
      checkbox.addEventListener('change', function() {
        const sectionId = this.dataset.section;
        document.querySelectorAll('#' + sectionId + ' input[name="threadIds"]').forEach(cb => {
          cb.checked = this.checked;
        });
        // Update the parent tab's select-all state
        updateTabSelectAll(this);
      });
    });

    document.querySelectorAll('input[name="threadIds"]').forEach(cb => {
      cb.addEventListener('change', function() {
        // Update section select-all
        const section = this.closest('.notification-subsection');
        if (section) {
          const sectionAll = section.querySelectorAll('input[name="threadIds"]');
          const sectionChecked = section.querySelectorAll('input[name="threadIds"]:checked');
          const sectionSelectAll = section.querySelector('.select-all-section');
          if (sectionSelectAll) sectionSelectAll.checked = sectionAll.length === sectionChecked.length;
        }
        // Update tab select-all
        const tabContent = this.closest('.tab-content');
        if (!tabContent) return;
        const all = tabContent.querySelectorAll('input[name="threadIds"]');
        const checked = tabContent.querySelectorAll('input[name="threadIds"]:checked');
        const selectAll = tabContent.querySelector('.select-all-tab');
        if (selectAll) selectAll.checked = all.length === checked.length;
      });
    });

    function updateTabSelectAll(sectionCheckbox) {
      const tabContent = sectionCheckbox.closest('.tab-content');
      if (!tabContent) return;
      const all = tabContent.querySelectorAll('input[name="threadIds"]');
      const checked = tabContent.querySelectorAll('input[name="threadIds"]:checked');
      const selectAll = tabContent.querySelector('.select-all-tab');
      if (selectAll) selectAll.checked = all.length === checked.length;
    }

    function selectAll() {
      document.querySelectorAll('input[name="threadIds"]').forEach(cb => cb.checked = true);
      document.querySelectorAll('.select-all-tab').forEach(cb => cb.checked = true);
      document.querySelectorAll('.select-all-section').forEach(cb => cb.checked = true);
    }

    function selectNone() {
      document.querySelectorAll('input[name="threadIds"]').forEach(cb => cb.checked = false);
      document.querySelectorAll('.select-all-tab').forEach(cb => cb.checked = false);
      document.querySelectorAll('.select-all-section').forEach(cb => cb.checked = false);
    }

    document.querySelector('form').addEventListener('submit', function(e) {
      const checkedIds = Array.from(document.querySelectorAll('input[name="threadIds"]:checked'))
        .map(cb => cb.value);

      document.querySelectorAll('input[name="threadIds"]').forEach(cb => {
        cb.disabled = true;
      });

      const hiddenField = document.createElement('input');
      hiddenField.type = 'hidden';
      hiddenField.name = 'threadIds';
      hiddenField.value = JSON.stringify(checkedIds);
      this.appendChild(hiddenField);
    });
  </script>
</body>
</html>`;
}
