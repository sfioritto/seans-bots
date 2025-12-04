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
    filteredStories,
    previousDraft,
    feedbackMessages
  }: {
    filteredStories: Article[],
    previousDraft?: string,
    feedbackMessages?: FeedbackMessage[]
  }) => {
    const isRegeneration = previousDraft && feedbackMessages && feedbackMessages.length > 0;

    const articlesText = filteredStories.map((article, idx) =>
      `[${idx + 1}] ID: ${article.id}
Title: ${article.title}
URL: ${article.url}
HN Score: ${article.score} points
HN Comments: https://news.ycombinator.com/item?id=${article.id}
${article.content ? `Content Summary: ${article.content.slice(0, 1000)}...` : '(content not available)'}`
    ).join('\n\n');

    if (isRegeneration) {
      const feedbackText = feedbackMessages!.map(msg => `- ${msg.text}`).join('\n');

      return `You are regenerating article summaries for a weekly AI news post based on user feedback.

PREVIOUS DRAFT:
${previousDraft}

USER FEEDBACK:
${feedbackText}

ORIGINAL ARTICLES DATA:
${articlesText}

Your task: Carefully read the feedback and regenerate the article summaries incorporating the requested changes.

FOR EACH ARTICLE:
- Write ONE sharp, to-the-point sentence (15-25 words) that captures what developers actually care about
- Focus on the "why this matters" not just "what it is"
- Include: article title as Slack link, your summary, HN score, and HN comments link
- Format: *<article-url|Article Title>* - Your one-sentence summary. _(<score> points | <hn-comments-url|HN comments>)_

FORMATTING REQUIREMENTS (Slack mrkdwn syntax):
- Links: <url|link text> (NOT [text](url))
- Bold: *text* (single asterisks)
- Italic: _text_ (underscores)

Output ONLY the article summaries, one per line. Do NOT include any introductory paragraph or trends summary.`;
    }

    return `You are creating article summaries for a weekly AI news post on Slack for a developer audience.

ARTICLES FROM THIS WEEK:
${articlesText}

Your task: Create a one-sentence summary for EACH article. These will be posted as individual thread replies.

FOR EACH ARTICLE:
- Write ONE sharp, to-the-point sentence (15-25 words) that captures what developers actually care about
- Focus on the "why this matters" not just "what it is"
- Include: article title as Slack link, your summary, HN score, and HN comments link
- Format: *<article-url|Article Title>* - Your one-sentence summary. _(<score> points | <hn-comments-url|HN comments>)_

TONE & STYLE:
- Professional but conversational
- Cut the hype - developers can smell BS
- Prioritize clarity and usefulness over cleverness
- No superlatives unless truly warranted
- Focus on practical implications

CRITICAL FORMATTING REQUIREMENTS - YOU MUST FOLLOW THESE EXACTLY:
This post will be sent directly to Slack. You MUST use Slack's mrkdwn syntax, NOT standard markdown.

LINKS - SLACK FORMAT ONLY:
- WRONG: [link text](url)
- CORRECT: <url|link text>
- Example: <https://example.com|Click here>

EMPHASIS:
- Bold: *text* (single asterisks, NOT double)
- Italic: _text_ (underscores)

REQUIRED FORMAT FOR EACH ARTICLE:
*<article-url|Article Title>* - Your one-sentence summary. _(score points | <hn-comments-url|HN comments>)_

EXAMPLE OF CORRECT FORMATTING:
*<https://example.com/article|Building Better AI Agents>* - Shows how to implement constraint systems for production agents. _(1013 points | <https://news.ycombinator.com/item?id=12345|HN comments>)_

DO NOT use standard markdown syntax like [text](url) or **bold** - these will NOT work in Slack.

IMPORTANT: Output ONLY the article summaries, one per line. Do NOT include any introductory paragraph or trends summary. Each line should be one complete article entry in the format shown above.`;
  },
  outputSchema: {
    schema: z.object({
      post: z.string().describe('The article summaries using Slack mrkdwn syntax (NOT standard markdown), one per line with <url|text> format links. NO intro paragraph.'),
    }),
    name: 'weeklyPost' as const,
  },
};
