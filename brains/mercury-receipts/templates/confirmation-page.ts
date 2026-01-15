import type { MercuryRequestWithMatches } from '../types.js';

export function generateMercuryReceiptsPage(
  requestsWithMatches: MercuryRequestWithMatches[],
  sessionId: string,
  webhookUrl: string
): string {
  const totalRequests = requestsWithMatches.length;
  const withMatches = requestsWithMatches.filter(r => r.matches.length > 0).length;
  const noMatches = totalRequests - withMatches;

  // Collect all Mercury thread IDs for archiving
  const allMercuryThreadIds = requestsWithMatches.map(r => r.request.threadId);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mercury Receipts</title>
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
    .request-card {
      background: white;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    .request-header {
      background: #6366f1;
      color: white;
      padding: 15px;
    }
    .request-header h3 {
      margin: 0;
      font-size: 1.1em;
    }
    .request-details {
      display: flex;
      gap: 20px;
      margin-top: 8px;
      font-size: 0.9em;
      opacity: 0.9;
    }
    .matches-container {
      padding: 15px;
    }
    .match-option {
      display: block;
      padding: 12px;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      margin-bottom: 10px;
      cursor: pointer;
      transition: border-color 0.2s;
    }
    .match-option:hover {
      border-color: #6366f1;
    }
    .match-option.selected {
      border-color: #6366f1;
      background: #eef2ff;
    }
    .match-option input[type="radio"] {
      margin-right: 10px;
      vertical-align: top;
      margin-top: 4px;
    }
    .match-info {
      display: inline-block;
      vertical-align: top;
      width: calc(100% - 30px);
    }
    .match-merchant {
      font-weight: 600;
      color: #1f2937;
    }
    .match-details {
      font-size: 0.9em;
      color: #6b7280;
      margin-top: 4px;
    }
    .confidence-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.8em;
      margin-left: 10px;
    }
    .confidence-high { background: #d1fae5; color: #065f46; }
    .confidence-medium { background: #fef3c7; color: #92400e; }
    .confidence-low { background: #fee2e2; color: #991b1b; }
    .skip-option {
      color: #6b7280;
      font-style: italic;
    }
    .no-matches {
      color: #dc2626;
      padding: 10px;
      background: #fef2f2;
      border-radius: 6px;
    }
    .submit-section {
      margin-top: 30px;
      padding: 20px;
      background: white;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .submit-btn {
      background: #6366f1;
      color: white;
      border: none;
      padding: 15px 30px;
      font-size: 1.1em;
      border-radius: 8px;
      cursor: pointer;
      font-weight: bold;
      width: 100%;
    }
    .submit-btn:hover { background: #4f46e5; }
    .match-reason {
      font-size: 0.85em;
      color: #4b5563;
      margin-top: 6px;
      font-style: italic;
    }
    .match-subject {
      font-size: 0.85em;
      color: #374151;
      margin-top: 4px;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <h1>Mercury Receipt Requests</h1>
  <div class="summary-header">
    <strong>${totalRequests} request${totalRequests !== 1 ? 's' : ''}</strong> -
    ${withMatches} with matches${noMatches > 0 ? `, ${noMatches} need manual handling` : ''}
  </div>

  <form id="receipts-form" action="${webhookUrl}" method="POST">
    <input type="hidden" name="sessionId" value="${sessionId}">
    <input type="hidden" name="mercuryThreadIds" value='${JSON.stringify(allMercuryThreadIds)}'>

    ${requestsWithMatches.map((item, index) => `
      <div class="request-card">
        <div class="request-header">
          <h3>${escapeHtml(item.request.merchant)} - ${escapeHtml(item.request.amount)}</h3>
          <div class="request-details">
            <span>Requested: ${escapeHtml(item.request.requestDate)}</span>
          </div>
        </div>
        <div class="matches-container">
          ${item.matches.length > 0 ? item.matches.map((match, mi) => {
            const confidenceClass = match.confidence >= 0.8 ? 'high' :
                                   match.confidence >= 0.5 ? 'medium' : 'low';
            return `
              <label class="match-option ${mi === 0 ? 'selected' : ''}">
                <input type="radio"
                       name="selection_${index}"
                       value="${match.threadId}"
                       data-request-id="${item.request.threadId}"
                       ${mi === 0 ? 'checked' : ''}>
                <span class="match-info">
                  <span class="match-merchant">${escapeHtml(match.merchant)}</span>
                  <span class="confidence-badge confidence-${confidenceClass}">
                    ${Math.round(match.confidence * 100)}% match
                  </span>
                  <div class="match-details">
                    ${escapeHtml(match.amount)} - ${escapeHtml(match.receiptDate)}
                  </div>
                  <div class="match-subject">${escapeHtml(match.rawThread.subject)}</div>
                  <div class="match-reason">${escapeHtml(match.matchReason)}</div>
                </span>
              </label>
            `;
          }).join('') : ''}

          <label class="match-option skip-option ${item.matches.length === 0 ? 'selected' : ''}">
            <input type="radio"
                   name="selection_${index}"
                   value=""
                   data-request-id="${item.request.threadId}"
                   ${item.matches.length === 0 ? 'checked' : ''}>
            <span class="match-info">
              ${item.matches.length === 0
                ? '<span class="no-matches">No matching receipts found - skip this request</span>'
                : "Skip - I'll handle this manually"}
            </span>
          </label>
        </div>
      </div>
    `).join('')}

    <div class="submit-section">
      <button type="submit" class="submit-btn">
        Forward Selected Receipts to Mercury
      </button>
    </div>
  </form>

  <script>
    // Visual selection feedback
    document.querySelectorAll('.match-option').forEach(option => {
      option.addEventListener('click', function() {
        const container = this.closest('.matches-container');
        container.querySelectorAll('.match-option').forEach(o => o.classList.remove('selected'));
        this.classList.add('selected');
      });
    });

    // Form submission
    document.getElementById('receipts-form').addEventListener('submit', function(e) {
      const selections = [];

      document.querySelectorAll('.request-card').forEach((card, index) => {
        const selected = card.querySelector('input[type="radio"]:checked');
        if (selected) {
          selections.push({
            mercuryRequestId: selected.dataset.requestId,
            selectedReceiptId: selected.value || null
          });
        }
      });

      // Add selections as hidden field
      const hiddenField = document.createElement('input');
      hiddenField.type = 'hidden';
      hiddenField.name = 'selections';
      hiddenField.value = JSON.stringify(selections);
      this.appendChild(hiddenField);
    });
  </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
