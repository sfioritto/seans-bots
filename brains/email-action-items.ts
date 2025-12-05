import { brain } from '../brain.js';
import { z } from 'zod';

const notificationSchema = z.object({
  notifications: z.array(
    z.object({
      emailSubject: z.string().describe('The subject of the email'),
      message: z
        .string()
        .describe('Concise one-sentence notification from parent perspective'),
    })
  ),
});

const actionItemSchema = z.object({
  actionItems: z.array(
    z.object({
      email: z.string().describe('The subject of the email'),
      items: z.array(
        z.object({
          description: z.string().describe('The action item description'),
          exactQuote: z.string().describe('The EXACT text from the email that explicitly requests this action'),
          context: z.string().describe('Additional context from the email that is relevant to this action item, or empty string if none'),
          link: z.string().describe('URL to complete the action if available in the email, or empty string if none'),
          steps: z.array(z.string()).describe('Step-by-step directions if no link is available, or empty array if not needed'),
        })
      ).describe('List of action items from this email'),
    })
  ),
});

const emailActionItemsBrain = brain('email-action-items')
  .step('Fetch emails from all accounts', async ({ state, gmail }) => {
    // Calculate date for one week ago
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const dateStr = oneWeekAgo.toISOString().split('T')[0].replace(/-/g, '/');

    // Search for emails in primary inbox from the last week
    const query = `after:${dateStr} is:unread category:personal`;

    const accounts = gmail.getAccounts();

    // Fetch messages from each account
    const allMessages = [];

    for (const account of accounts) {
      const messages = await gmail.searchMessages(account.refreshToken, query, 50);

      for (const message of messages) {
        allMessages.push({
          account: account.name,
          ...message,
        });
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return {
      ...state,
      allMessages,
      totalMessages: allMessages.length,
    };
  })
  .step('Fetch message details', async ({ state, gmail }) => {
    if (state.allMessages.length === 0) {
      return {
        ...state,
        messageDetails: [],
      };
    }

    const accounts = gmail.getAccounts();
    const accountTokenMap = new Map(accounts.map((a) => [a.name, a.refreshToken]));

    const messageDetails: { account: string; id: string; subject: string; from: string; date: string; body: string }[] = [];

    console.log('\n=== EMAILS FOUND ===\n');
    console.log(`Found ${state.allMessages.length} emails matching search criteria:\n`);

    for (const message of state.allMessages) {
      const refreshToken = accountTokenMap.get(message.account);
      if (!refreshToken) continue;

      const details = await gmail.getMessageDetails(refreshToken, message.id);

      // Print each email subject as we fetch it
      console.log(`📧 ${details.subject}`);

      messageDetails.push({
        ...details,
        account: message.account,
      });

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    console.log('\n===================\n');

    return {
      ...state,
      messageDetails,
    };
  })
  .prompt('Extract action items', {
    template: ({ messageDetails }) => {
      const emailSummaries = messageDetails
        .map(
          (email: any, index: number) => `
Email ${index + 1}:
Subject: ${email.subject}
From: ${email.from}
Date: ${email.date}

Body:
${email.body.substring(0, 1500)}
---
`
        )
        .join('\n');

      return `You are an AI assistant helping to identify action items from emails for a parent whose child (Isaac) attends Gwendolyn Brooks Middle School.

CRITICAL DEFINITION - WHAT IS AN ACTION ITEM:
An action item is something where if I DON'T do it:
1. Isaac will MISS AN OPPORTUNITY (can't attend a field trip, miss a registration deadline, etc.)
2. Someone is WAITING for my response (teacher needs payment, permission slip, RSVP, etc.)
3. Isaac will face a NEGATIVE CONSEQUENCE (late fee, can't participate, etc.)

REAL-WORLD EXAMPLES OF ACTION ITEMS:
✅ "Pay for field trip by [date]" - Isaac misses the trip if I don't pay
✅ "Return permission slip" - Teacher is waiting, Isaac can't participate
✅ "Bring lunch on [date]" - Isaac will be hungry if I don't prepare it
✅ "Register by [deadline]" - Isaac misses out on the opportunity
✅ "RSVP by [date]" - Someone is waiting for my response

NOT ACTION ITEMS:
❌ Board meeting highlights - purely informational
❌ "Students are forming a club" - announcement, not a request
❌ Newsletter updates - no action required
❌ Celebration announcements - just sharing news

FILTERING:
- Focus on emails about Isaac, Brooks Middle School, and rock climbing
- Ignore Whittier Elementary (he no longer attends)
- Ignore activities Isaac isn't in (cross country, robotics, Fledglings, etc.)
- Isaac IS in choir, so include choir-related emails

INSTRUCTIONS:
For each email, ask yourself: "Is there something I need to DO here, or will something bad happen / someone is waiting / Isaac misses out?"

If YES, extract:
1. Description: What specific action do I need to take?
2. Exact quote: The text from the email that indicates this action is needed (can be a sentence or phrase)
3. Context: Why is this needed? What's the deadline? What happens if I don't do it?
4. Link: Any URL to complete the action (or empty string)
5. Steps: How to do it if no link (or empty array)

Here are ${messageDetails.length} emails to analyze:

${emailSummaries}

Return ONLY emails with real action items where I need to DO something with consequences if I don't.`;
    },
    outputSchema: {
      schema: actionItemSchema,
      name: 'actionItems' as const,
    },
  })
  .step('Format final output', ({ state }) => {
    // Filter out emails with no action items
    const emailsWithActionItems = state.actionItems.actionItems.filter(
      (email: any) => email.items.length > 0
    );

    const totalActionItems = emailsWithActionItems.reduce(
      (sum: number, email: any) => sum + email.items.length,
      0
    );

    // Print action items to console/logs
    console.log('\n=== EMAIL ACTION ITEMS ===\n');
    console.log(`Found ${emailsWithActionItems.length} emails with ${totalActionItems} total action items\n`);

    emailsWithActionItems.forEach((emailGroup: any, index: number) => {
      console.log(`\n📧 ${index + 1}. ${emailGroup.email}`);

      // Find the matching email details
      const emailDetails = state.messageDetails.find(
        (detail: any) => detail.subject === emailGroup.email
      );

      emailGroup.items.forEach((item: any, itemIndex: number) => {
        console.log(`   ${itemIndex + 1}. ${item.description}`);
        if (item.exactQuote && item.exactQuote.trim()) {
          console.log(`      📋 Quote: "${item.exactQuote}"`);
        }
        if (item.context && item.context.trim()) {
          console.log(`      ℹ️  ${item.context}`);
        }
        if (item.link && item.link.trim()) {
          console.log(`      🔗 ${item.link}`);
        }
        if (item.steps && item.steps.length > 0) {
          console.log(`      📝 Steps:`);
          item.steps.forEach((step: string, stepIndex: number) => {
            console.log(`         ${stepIndex + 1}. ${step}`);
          });
        }
      });

      // Print email body
      if (emailDetails) {
        console.log(`\n   📄 Email Body:`);
        console.log(`   ${'-'.repeat(80)}`);
        console.log(`   ${emailDetails.body.substring(0, 2000).split('\n').join('\n   ')}`);
        if (emailDetails.body.length > 2000) {
          console.log(`   ... (truncated)`);
        }
        console.log(`   ${'-'.repeat(80)}`);
      }
    });

    console.log('\n=========================\n');

    return {
      ...state,
      emailsWithActionItems,
      summary: {
        totalEmails: emailsWithActionItems.length,
        totalActionItems,
      },
    };
  })
  .prompt('Generate notification messages', {
    template: ({ emailsWithActionItems }) => {
      if (emailsWithActionItems.length === 0) {
        return 'No emails with action items. Return empty notifications array.';
      }

      const emailSummaries = emailsWithActionItems
        .map(
          (email: any) => `
Email Subject: ${email.email}
Action Items:
${email.items.map((item: any) => `- ${item.description}`).join('\n')}
`
        )
        .join('\n---\n');

      return `Generate concise push notification messages for each email with action items.

INSTRUCTIONS:
- Write ONE sentence per email summarizing what action is needed
- Write from the parent's perspective (e.g., "Isaac's nurse needs..." not "You need to...")
- Be concise - these are phone notifications
- Include deadlines/dates if relevant
- Focus on the consequence if action isn't taken

EXAMPLES:
- "Isaac's nurse needs inhaler paperwork filled out"
- "Sign permission slip for Isaac's field trip by Friday"
- "Pack lunch for Isaac's 8/13 field trip"

EMAILS TO PROCESS:
${emailSummaries}

Return a notification message for each email.`;
    },
    outputSchema: {
      schema: notificationSchema,
      name: 'notificationData' as const,
    },
  })
  .step('Upload emails to paste.rs', async ({ state }) => {
    if (state.emailsWithActionItems.length === 0) {
      return { ...state, emailPasteUrls: {} };
    }

    console.log('\n=== UPLOADING EMAILS TO PASTE.RS ===\n');

    const emailPasteUrls: Record<string, string> = {};

    for (const emailGroup of state.emailsWithActionItems) {
      // Find the full email details
      const emailDetails = state.messageDetails.find(
        (detail: any) => detail.subject === emailGroup.email
      );

      if (!emailDetails) continue;

      // Format email content for paste
      const emailContent = `Subject: ${emailDetails.subject}
From: ${emailDetails.from}
Date: ${emailDetails.date}

${emailDetails.body}`;

      // Upload to paste.rs
      const response = await fetch('https://paste.rs', {
        method: 'POST',
        body: emailContent,
      });

      if (response.ok) {
        const pasteUrl = await response.text();
        emailPasteUrls[emailDetails.subject] = pasteUrl.trim();
        console.log(`📋 ${emailDetails.subject}`);
        console.log(`   🔗 ${pasteUrl.trim()}`);
      }

      // Small delay between uploads
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    console.log('\n===================================\n');

    return { ...state, emailPasteUrls };
  })
  .step('Send NTFY notifications', async ({ state, ntfy }) => {
    if (state.emailsWithActionItems.length === 0) {
      console.log('No action items to notify about');
      return state;
    }

    console.log('\n=== SENDING NOTIFICATIONS ===\n');

    for (const notification of state.notificationData.notifications) {
      // Find the matching email to get the body for paste.rs
      const emailDetails = state.messageDetails.find(
        (detail: any) => detail.subject === notification.emailSubject
      );

      // Get paste.rs link from the earlier step
      const pasteUrl = emailDetails
        ? state.emailPasteUrls[emailDetails.subject]
        : undefined;

      console.log(`📱 ${notification.message}`);
      if (pasteUrl) {
        console.log(`   🔗 ${pasteUrl}`);
      }

      await ntfy.send(notification.message, pasteUrl);

      // Small delay between notifications
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    console.log('\n=============================\n');

    return {
      ...state,
      notificationsSent: state.notificationData.notifications.length,
    };
  });

export default emailActionItemsBrain;
