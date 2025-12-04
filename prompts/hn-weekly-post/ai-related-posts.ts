import { z } from 'zod';

export const aiRelatedPostsPrompt = {
  template: ({ recentStories }: { recentStories: { id: number, title: string }[] }) => {
    return `
    Analyze these Hacker News articles and identify which ones are related to AI for developers.

    Articles:
    ${recentStories.map((story: any) => `ID: ${story.id} | ${story.title}`).join('\n')}

    Return ONLY the article IDs (just the numbers) of AI-related articles. Be selective.
    `;
  },
  outputSchema: {
    schema: z.object({
      ids: z.array(z.number()).describe('Array of article IDs that are AI-related'),
    }),
    name: 'aiRelatedStoryIds' as const,
  },
}