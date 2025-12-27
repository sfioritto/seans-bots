import { z } from 'zod';

export const aiRelatedPostsPrompt = {
  template: ({ recentStories }: { recentStories: { id: string, title: string }[] }) => {
    return `
    Analyze these Hacker News articles and identify which ones are related to AI for developers.

    Articles:
    ${recentStories.map((story) => `ID: ${story.id} | ${story.title}`).join('\n')}

    Return ONLY the article IDs of AI-related articles. Be selective.
    `;
  },
  outputSchema: {
    schema: z.object({
      ids: z.array(z.string()).describe('Array of article IDs that are AI-related'),
    }),
    name: 'aiRelatedStoryIds' as const,
  },
}