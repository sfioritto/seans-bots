import { z } from 'zod';

interface Article {
  id: string;
  title: string;
  url: string;
  score: number;
  content?: string;
}

interface FeedbackMessage {
  text: string;
  ts: string;
}

export const generateWeeklyPostPrompt = {
  template: ({
    filteredArticles,
    previousDraft,
    feedbackMessages
  }: {
    filteredArticles: Article[],
    previousDraft?: string,
    feedbackMessages?: FeedbackMessage[]
  }) => {
    const isRegeneration = previousDraft && feedbackMessages && feedbackMessages.length > 0;

    const articlesText = filteredArticles.map((article, idx) =>
      `[${idx + 1}] ID: ${article.id}
Title: ${article.title}
URL: ${article.url}
HN Score: ${article.score} points
HN Comments: https://news.ycombinator.com/item?id=${article.id}
${article.content ? `Content Summary: ${article.content.slice(0, 1000)}...` : '(content not available)'}`
    ).join('\n\n');

    if (isRegeneration) {
      const feedbackText = feedbackMessages!.map(msg => `- ${msg.text}`).join('\n');

      return `You are regenerating a weekly AI news post based on user feedback.

PREVIOUS DRAFT:
${previousDraft}

USER FEEDBACK:
${feedbackText}

ORIGINAL ARTICLES DATA:
${articlesText}

Your task: Carefully read the feedback and regenerate the post incorporating the requested changes. Maintain the same structure (trends paragraph + article summaries) unless the feedback specifically requests otherwise.

Generate an improved post that addresses all feedback while keeping it sharp, focused, and developer-oriented.`;
    }

    return `You are creating a weekly post about AI-related articles from Hacker News for a developer audience.

ARTICLES FROM THIS WEEK:
${articlesText}

Your task is to create a compelling weekly post with two parts:

1. **Opening Trends Paragraph**: Write ONE tight, focused paragraph (3-5 sentences max) that:
   - Identifies meaningful trends across the articles (if any clear patterns emerge)
   - Highlights the most important/impactful developments
   - Is written for busy developers who want signal, not noise
   - Avoids generic fluff - be specific and insightful
   - If no clear trends, focus on the most significant individual stories

2. **Article Summaries**: For EACH article, create:
   - One sharp, to-the-point sentence (15-25 words) that captures what developers actually care about
   - Focus on the "why this matters" not just "what it is"
   - Include: article title as markdown link, your summary, HN score, and HN comments link
   - Format: **[Article Title](article-url)** - Your one-sentence summary. _([score] points | [HN comments](hn-comments-url))_

TONE & STYLE:
- Professional but conversational
- Cut the hype - developers can smell BS
- Prioritize clarity and usefulness over cleverness
- No superlatives unless truly warranted
- Focus on practical implications

Generate the complete formatted post as markdown, ready to publish.`;
  },
  outputSchema: {
    schema: z.object({
      post: z.string().describe('The complete formatted weekly post as markdown, including trends paragraph and all article summaries'),
    }),
    name: 'weeklyPost' as const,
  },
};
