import type { ProcessedEmails, ActionItem, IsaacEmail } from '../types.js';
import { categoryLabels as amazonCategoryLabels } from '../processors/amazon.js';
import { categoryLabels as isaacCategoryLabels } from '../processors/isaac.js';
import { countActionItems } from '../processors/action-items.js';

interface CategoryConfig {
  id: string;
  label: string;
  color: string;
  borderColor: string;
}

const categories: CategoryConfig[] = [
  { id: 'isaac', label: 'Isaac', color: '#ef4444', borderColor: '#dc2626' },
  { id: 'amazon', label: 'Amazon', color: '#ff9900', borderColor: '#e88b00' },
  { id: 'receipts', label: 'Receipts', color: '#059669', borderColor: '#047857' },
  { id: 'kickstarter', label: 'Kickstarter', color: '#05ce78', borderColor: '#04b569' },
  { id: 'newsletters', label: 'Newsletters', color: '#6366f1', borderColor: '#4f46e5' },
];

// Helper to render action items inline under an email
function renderInlineActionItems(actionItems: ActionItem[] | undefined): string {
  if (!actionItems || actionItems.length === 0) return '';

  return `
    <ul class="action-list">
      ${actionItems.map(item => `
        <li class="action-item">
          <strong>${item.description}</strong>
          ${item.context ? `<span class="context">${item.context}</span>` : ''}
          ${item.link ? `<a href="${item.link}" target="_blank" class="action-link">Complete action</a>` : ''}
          ${item.steps.length > 0 ? `
            <ol class="action-steps">
              ${item.steps.map(step => `<li>${step}</li>`).join('')}
            </ol>
          ` : ''}
        </li>
      `).join('')}
    </ul>
  `;
}

// Helper to render Isaac action items (they have a slightly different structure)
function renderIsaacActionItems(actionItems: IsaacEmail['actionItems']): string {
  if (!actionItems || actionItems.length === 0) return '';

  return `
    <ul class="action-list">
      ${actionItems.map(item => `
        <li class="action-item">
          <strong>${item.description}</strong>
          ${item.context ? `<span class="context">${item.context}</span>` : ''}
          ${item.link ? `<a href="${item.link}" target="_blank" class="action-link">Complete action</a>` : ''}
          ${item.steps.length > 0 ? `
            <ol class="action-steps">
              ${item.steps.map(step => `<li>${step}</li>`).join('')}
            </ol>
          ` : ''}
        </li>
      `).join('')}
    </ul>
  `;
}

function renderIsaacSection(processed: ProcessedEmails): string {
  if (processed.isaac.length === 0) return '';

  // Group by category
  const byCategory: Record<string, typeof processed.isaac> = {};
  for (const email of processed.isaac) {
    if (!byCategory[email.category]) byCategory[email.category] = [];
    byCategory[email.category].push(email);
  }

  return Object.entries(byCategory).map(([category, emails]) => `
    <div class="subcategory">
      <h3>${isaacCategoryLabels[category] || category}</h3>
      ${emails.map(email => `
        <div class="email-item ${email.actionItems.length > 0 ? 'has-action-items' : ''}">
          <label class="checkbox-label">
            <input type="checkbox" name="emailIds" value="${email.emailId}" checked>
            <div class="email-content">
              <span class="email-subject">${email.rawEmail.subject}</span>
              <span class="summary">${email.summary}</span>
              ${renderIsaacActionItems(email.actionItems)}
            </div>
          </label>
        </div>
      `).join('')}
    </div>
  `).join('');
}

function renderAmazonSection(processed: ProcessedEmails): string {
  if (processed.amazon.length === 0) return '';

  // Group by category
  const byCategory: Record<string, typeof processed.amazon> = {};
  for (const email of processed.amazon) {
    if (!byCategory[email.category]) byCategory[email.category] = [];
    byCategory[email.category].push(email);
  }

  return Object.entries(byCategory).map(([category, emails]) => `
    <div class="subcategory">
      <h3>${amazonCategoryLabels[category] || category}</h3>
      ${emails.map(email => `
        <div class="email-item">
          <label class="checkbox-label">
            <input type="checkbox" name="emailIds" value="${email.emailId}" checked>
            <div class="email-content">
              <span class="summary">${email.summary}</span>
              ${renderInlineActionItems(processed.actionItemsMap[email.emailId])}
            </div>
          </label>
        </div>
      `).join('')}
    </div>
  `).join('');
}

function renderReceiptsSection(processed: ProcessedEmails): string {
  if (processed.receipts.length === 0) return '';

  return processed.receipts.map(email => `
    <div class="email-item">
      <label class="checkbox-label">
        <input type="checkbox" name="emailIds" value="${email.emailId}" checked>
        <div class="receipt-content">
          <span class="merchant-name">${email.merchant}</span>
          <span class="summary">${email.summary}</span>
          ${email.charges.length > 0 ? `
            <ul class="charges">
              ${email.charges.map(charge => `
                <li><span class="charge-desc">${charge.description}</span><span class="charge-amount">${charge.amount}</span></li>
              `).join('')}
            </ul>
          ` : ''}
          ${renderInlineActionItems(processed.actionItemsMap[email.emailId])}
        </div>
      </label>
    </div>
  `).join('');
}

function renderKickstarterSection(processed: ProcessedEmails): string {
  if (processed.kickstarter.length === 0) return '';

  return processed.kickstarter.map(email => `
    <div class="email-item">
      <label class="checkbox-label">
        <input type="checkbox" name="emailIds" value="${email.emailId}" checked>
        <div class="kickstarter-content">
          <span class="summary">${email.summary}</span>
          ${email.actionItems.length > 0 ? `
            <ul class="kickstarter-actions">
              ${email.actionItems.map(action => `<li>${action}</li>`).join('')}
            </ul>
          ` : ''}
          ${renderInlineActionItems(processed.actionItemsMap[email.emailId])}
        </div>
      </label>
    </div>
  `).join('');
}

function renderNewslettersSection(processed: ProcessedEmails): string {
  if (processed.newsletters.length === 0) return '';

  return processed.newsletters.map(email => `
    <div class="email-item">
      <label class="checkbox-label">
        <input type="checkbox" name="emailIds" value="${email.emailId}" checked>
        <div class="newsletter-content">
          <span class="newsletter-name">${email.newsletterName}</span>
          <span class="summary">${email.summary}</span>
          ${email.deadlines.length > 0 ? `
            <ul class="deadlines">
              ${email.deadlines.map(deadline => `<li>${deadline}</li>`).join('')}
            </ul>
          ` : ''}
          ${renderInlineActionItems(processed.actionItemsMap[email.emailId])}
        </div>
      </label>
    </div>
  `).join('');
}

export function generateUnifiedPage(
  processed: ProcessedEmails,
  sessionId: string,
  webhookUrl: string
): string {
  const counts = {
    isaac: processed.isaac.length,
    amazon: processed.amazon.length,
    receipts: processed.receipts.length,
    kickstarter: processed.kickstarter.length,
    newsletters: processed.newsletters.length,
  };

  const totalEmails = Object.values(counts).reduce((a, b) => a + b, 0);
  // Count action items from both the map and Isaac emails
  const actionItemsFromMap = countActionItems(processed.actionItemsMap);
  const isaacActionItems = processed.isaac.reduce((sum, e) => sum + e.actionItems.length, 0);
  const totalActionItems = actionItemsFromMap + isaacActionItems;

  // Collect all email IDs
  const allEmailIds = [
    ...processed.isaac.map(e => e.emailId),
    ...processed.amazon.map(e => e.emailId),
    ...processed.receipts.map(e => e.emailId),
    ...processed.kickstarter.map(e => e.emailId),
    ...processed.newsletters.map(e => e.emailId),
  ];

  // Build tabs for categories with emails
  const activeTabs = categories.filter(cat => counts[cat.id as keyof typeof counts] > 0);
  const firstActiveTab = activeTabs[0]?.id || 'isaac';

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
    .email-content, .receipt-content, .kickstarter-content, .newsletter-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .email-subject, .merchant-name, .newsletter-name {
      font-weight: 600;
      color: #1f2937;
    }
    .summary {
      line-height: 1.4;
      color: #6b7280;
      font-size: 0.95em;
    }
    .subcategory h3 {
      font-size: 0.95em;
      color: #4b5563;
      margin: 15px 0 10px 0;
      padding-bottom: 5px;
      border-bottom: 1px solid #e5e7eb;
    }
    .action-list, .action-items {
      margin: 8px 0 0 0;
      padding-left: 0;
      list-style: none;
    }
    .action-item {
      background: #fef3c7;
      padding: 8px 12px;
      border-radius: 4px;
      margin-bottom: 5px;
      border-left: 3px solid #f59e0b;
      font-size: 0.9em;
    }
    .action-item .context {
      display: block;
      font-size: 0.9em;
      color: #92400e;
      margin-top: 4px;
    }
    .action-link {
      display: inline-block;
      margin-top: 4px;
      color: #2563eb;
      text-decoration: none;
    }
    .action-steps {
      margin: 6px 0 0 0;
      padding-left: 20px;
      font-size: 0.9em;
      color: #92400e;
    }
    .action-steps li {
      margin-bottom: 3px;
    }
    .kickstarter-actions {
      margin: 8px 0 0 0;
      padding-left: 0;
      list-style: none;
    }
    .kickstarter-actions li {
      padding: 4px 0;
      color: #4b5563;
      font-size: 0.9em;
    }
    .charges {
      margin: 8px 0 0 0;
      padding: 10px;
      list-style: none;
      background: #f9fafb;
      border-radius: 6px;
    }
    .charges li {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      font-size: 0.9em;
      border-bottom: 1px solid #e5e7eb;
    }
    .charges li:last-child { border-bottom: none; }
    .charge-desc { color: #4b5563; }
    .charge-amount { font-weight: 500; color: #059669; }
    .deadlines {
      margin: 8px 0 0 0;
      padding-left: 0;
      list-style: none;
    }
    .deadlines li {
      background: #fef3c7;
      padding: 6px 10px;
      border-radius: 4px;
      margin-bottom: 4px;
      border-left: 3px solid #f59e0b;
      font-size: 0.9em;
      color: #92400e;
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
    .has-action-items {
      border-left: 3px solid #ef4444;
      background: #fef2f2;
    }
    .email-subject {
      font-weight: 600;
      color: #1f2937;
    }
  </style>
</head>
<body>
  <h1>Email Digest</h1>
  <div class="summary-header">
    <strong>${totalEmails} emails</strong> found across ${activeTabs.length} categories${totalActionItems > 0 ? ` with <strong>${totalActionItems} action item${totalActionItems > 1 ? 's' : ''}</strong>` : ''}
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
    <input type="hidden" name="allEmailIds" value='${JSON.stringify(allEmailIds)}'>

    ${counts.isaac > 0 ? `
      <div id="isaac" class="tab-content ${firstActiveTab === 'isaac' ? 'active' : ''}">
        <div class="select-all-container">
          <label>
            <input type="checkbox" class="select-all-tab" data-tab="isaac" checked>
            Select All Isaac
          </label>
        </div>
        ${renderIsaacSection(processed)}
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
        ${renderAmazonSection(processed)}
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
        ${renderReceiptsSection(processed)}
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
        ${renderKickstarterSection(processed)}
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
        ${renderNewslettersSection(processed)}
      </div>
    ` : ''}

    <div class="form-actions">
      <button type="button" class="select-btn" onclick="selectAll()">Select All</button>
      <button type="button" class="select-btn" onclick="selectNone()">Select None</button>
      <button type="submit" class="archive-btn">Archive Selected</button>
    </div>
  </form>

  <script>
    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
      });
    });

    // Select all per tab
    document.querySelectorAll('.select-all-tab').forEach(checkbox => {
      checkbox.addEventListener('change', function() {
        const tabId = this.dataset.tab;
        document.querySelectorAll('#' + tabId + ' input[name="emailIds"]').forEach(cb => {
          cb.checked = this.checked;
        });
      });
    });

    // Update tab select-all when individual checkboxes change
    document.querySelectorAll('input[name="emailIds"]').forEach(cb => {
      cb.addEventListener('change', function() {
        const tabContent = this.closest('.tab-content');
        if (!tabContent) return;
        const all = tabContent.querySelectorAll('input[name="emailIds"]');
        const checked = tabContent.querySelectorAll('input[name="emailIds"]:checked');
        const selectAll = tabContent.querySelector('.select-all-tab');
        if (selectAll) selectAll.checked = all.length === checked.length;
      });
    });

    function selectAll() {
      document.querySelectorAll('input[name="emailIds"]').forEach(cb => cb.checked = true);
      document.querySelectorAll('.select-all-tab').forEach(cb => cb.checked = true);
    }

    function selectNone() {
      document.querySelectorAll('input[name="emailIds"]').forEach(cb => cb.checked = false);
      document.querySelectorAll('.select-all-tab').forEach(cb => cb.checked = false);
    }

    // Handle form submission
    document.querySelector('form').addEventListener('submit', function(e) {
      const checkedIds = Array.from(document.querySelectorAll('input[name="emailIds"]:checked'))
        .map(cb => cb.value);

      document.querySelectorAll('input[name="emailIds"]').forEach(cb => {
        cb.disabled = true;
      });

      const hiddenField = document.createElement('input');
      hiddenField.type = 'hidden';
      hiddenField.name = 'emailIds';
      hiddenField.value = JSON.stringify(checkedIds);
      this.appendChild(hiddenField);
    });
  </script>
</body>
</html>`;
}
