import { brain } from '../brain.js';
import { z } from 'zod';

const hnTopStoriesBrain = brain({
  title: 'hn-top-stories',
  description: 'Fetches top HN stories from today, shows them in a UI, and lets you save your favorites',
})
  .step('Fetch top stories from today', async ({ state, hn }) => {
    const stories = await hn.getStories({
      daysBack: 1,
      minPoints: 10,
      frontPageOnly: true,
      limit: 5,
    });

    return {
      ...state,
      stories,
    };
  })
  .step('Fetch article content', async ({ state, hn }) => {
    const storiesWithContent = await hn.fetchStoriesContent(state.stories);

    return {
      ...state,
      stories: storiesWithContent,
    };
  })
  .prompt('Summarize stories', {
    template: ({ stories }) => `
Summarize each of these Hacker News stories in 1-2 sentences. Focus on what makes each story interesting or notable.

Stories:
${stories.map((s: any, i: number) => `
${i + 1}. "${s.title}" (${s.score} points)
URL: ${s.url}
Content preview: ${s.content?.slice(0, 500) || 'No content available'}
`).join('\n')}

Return a summary for each story.
`,
    outputSchema: {
      schema: z.object({
        summaries: z.array(z.object({
          storyIndex: z.number().describe('0-based index of the story'),
          summary: z.string().describe('1-2 sentence summary'),
        })),
      }),
      name: 'storySummaries' as const,
    },
  })
  .step('Combine stories with summaries', ({ state }) => {
    const storiesWithSummaries = state.stories.map((story: any, index: number) => {
      const summaryObj = state.storySummaries.summaries.find(
        (s: any) => s.storyIndex === index
      );
      return {
        ...story,
        summary: summaryObj?.summary || 'No summary available',
      };
    });

    return {
      ...state,
      stories: storiesWithSummaries,
    };
  })
  .ui('Select stories to save', {
    template: (state) => `
Create a page showing Hacker News top stories from today that the user can select to save.

Display each story as a card with:
- A checkbox to select it for saving (use the story ID as the checkbox value)
- The story title as a clickable link
- The score (points)
- The summary

Stories to display:
${state.stories.map((s: any) => `
- ID: ${s.id}
- Title: ${s.title}
- URL: ${s.url}
- Score: ${s.score} points
- Summary: ${s.summary}
`).join('\n')}

Include a "Save Selected" submit button at the bottom.
Make it look clean and modern with good spacing.
`,
    responseSchema: z.object({
      selectedStories: z.array(z.string()).describe('Array of story IDs that were selected'),
    }),
  })
  .step('Notify and wait for selection', ({ state, page }) => {
    console.log(`\n📋 Select your favorite stories: ${page.url}\n`);

    return {
      state,
      waitFor: [page.webhook],
    };
  })
  .step('Save selected stories', ({ state, response }) => {
    const selectedIds = response.selectedStories;
    const selectedStories = state.stories.filter((s: any) =>
      selectedIds.includes(s.id)
    );

    console.log('\n=== SAVED STORIES ===');
    selectedStories.forEach((story: any) => {
      console.log(`\n📰 ${story.title}`);
      console.log(`   🔗 ${story.url}`);
      console.log(`   ⭐ ${story.score} points`);
      console.log(`   📝 ${story.summary}`);
    });
    console.log('\n====================\n');

    return {
      ...state,
      savedStories: selectedStories,
    };
  });

export default hnTopStoriesBrain;
