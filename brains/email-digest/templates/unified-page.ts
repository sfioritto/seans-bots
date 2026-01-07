import type { ProcessedEmails, RawEmail } from '../types.js';

interface CategoryConfig {
  id: string;
  label: string;
  color: string;
  borderColor: string;
}

const categories: CategoryConfig[] = [
  { id: 'isaac', label: 'Isaac', color: '#ef4444', borderColor: '#dc2626' },
  { id: 'amazon', label: 'Amazon', color: '#ff9900', borderColor: '#e88b00' },
  { id: 'billing', label: 'Billing', color: '#059669', borderColor: '#047857' },
  { id: 'investments', label: 'Investments', color: '#0891b2', borderColor: '#0e7490' },
  { id: 'kickstarter', label: 'Kickstarter', color: '#05ce78', borderColor: '#04b569' },
  { id: 'newsletters', label: 'Newsletters', color: '#6366f1', borderColor: '#4f46e5' },
  { id: 'marketing', label: 'Marketing', color: '#ec4899', borderColor: '#db2777' },
  { id: 'notifications', label: 'Notifications', color: '#8b5cf6', borderColor: '#7c3aed' },
];

function renderEmailList(emailIds: string[], emailsById: Record<string, RawEmail>): string {
  return emailIds.map(emailId => {
    const email = emailsById[emailId];
    if (!email) return '';

    return `
      <div class="email-item">
        <label class="checkbox-label">
          <input type="checkbox" name="emailIds" value="${emailId}" checked>
          <div class="email-content">
            <span class="email-subject">${escapeHtml(email.subject)}</span>
            <span class="email-from">${escapeHtml(email.from)}</span>
            <span class="email-snippet">${escapeHtml(email.snippet)}</span>
          </div>
        </label>
      </div>
    `;
  }).join('');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function generateUnifiedPage(
  processed: ProcessedEmails,
  sessionId: string,
  webhookUrl: string
): string {
  const counts = {
    isaac: processed.isaac.length,
    amazon: processed.amazon.length,
    billing: processed.billing.length,
    investments: processed.investments.length,
    kickstarter: processed.kickstarter.length,
    newsletters: processed.newsletters.length,
    marketing: processed.marketing.length,
    notifications: processed.notifications.length,
  };

  const totalEmails = Object.values(counts).reduce((a, b) => a + b, 0);

  // Collect all email IDs
  const allEmailIds = [
    ...processed.isaac,
    ...processed.amazon,
    ...processed.billing,
    ...processed.investments,
    ...processed.kickstarter,
    ...processed.newsletters,
    ...processed.marketing,
    ...processed.notifications,
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
    <strong>${totalEmails} emails</strong> found across ${activeTabs.length} categories
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
        ${renderEmailList(processed.isaac, processed.emailsById)}
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
        ${renderEmailList(processed.amazon, processed.emailsById)}
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
        ${renderEmailList(processed.billing, processed.emailsById)}
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
        ${renderEmailList(processed.investments, processed.emailsById)}
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
        ${renderEmailList(processed.kickstarter, processed.emailsById)}
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
        ${renderEmailList(processed.newsletters, processed.emailsById)}
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
        ${renderEmailList(processed.marketing, processed.emailsById)}
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
        ${renderEmailList(processed.notifications, processed.emailsById)}
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
