import { z } from 'zod';
import type { CategorizedEmail } from '../types.js';

export const summarizeNpmPrompt = {
  template: (state: { emails: CategorizedEmail[] }) => {
    const threads = state.emails.filter((e) => e.category === 'npm').map((e) => e.thread);
    if (threads.length === 0) {
      return 'No NPM package notifications. Return an empty string for summary.';
    }
    const threadBodies = threads.map(t => `Subject: ${t.subject}\nBody: ${t.body}`).join('\n\n---\n\n');
    return `Here are NPM package publish notifications. Summarize which packages were published and what versions.

Group by package name. If the same package has multiple versions published, list all versions together.
Format: "@scope/package: v1.0.0, v1.0.1; @scope/other: v2.0.0"

Keep it concise - just package names and versions, nothing else.

${threadBodies}`;
  },
  outputSchema: {
    schema: z.object({
      summary: z.string().describe('Concise summary of packages published with their versions, e.g. "@positronic/shell: v0.0.50, v0.0.51; @positronic/core: v1.2.3". Empty string if no emails.'),
    }),
    name: 'npmSummary' as const,
  },
};
