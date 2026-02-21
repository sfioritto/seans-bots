import { z } from 'zod';

const ALGOLIA_HN_API = 'http://hn.algolia.com/api/v1';

export interface HNStory {
  id: string;
  title: string;
  url: string;
  score: number;
  time: number;
  author?: string;
  numComments?: number;
  [key: string]: string | number | null | undefined; // JSON-compatible index signature
}

interface GetStoriesOptions {
  /** Number of days to look back (default: 7) */
  daysBack?: number;
  /** Minimum points threshold (default: 50) */
  minPoints?: number;
  /** Only front page stories (default: true) */
  frontPageOnly?: boolean;
  /** Maximum stories to return (default: all) */
  limit?: number;
}

/**
 * Fetch recent HN stories from Algolia API
 */
async function getStories(options: GetStoriesOptions = {}): Promise<HNStory[]> {
  const {
    daysBack = 7,
    minPoints = 50,
    frontPageOnly = true,
    limit,
  } = options;

  const sinceTimestamp = Math.floor(Date.now() / 1000) - daysBack * 24 * 60 * 60;
  const tags = frontPageOnly ? '(story,front_page)' : 'story';

  let allStories: any[] = [];
  let page = 0;
  let nbPages = 1;

  while (page < nbPages) {
    const url = `${ALGOLIA_HN_API}/search_by_date?tags=${tags}&numericFilters=created_at_i>${sinceTimestamp},points>${minPoints}&hitsPerPage=1000&page=${page}`;
    const response = await fetch(url);
    const data = await response.json();

    nbPages = data.nbPages;
    allStories = allStories.concat(data.hits);
    page++;
  }

  // Filter to stories with URLs and transform
  const stories: HNStory[] = allStories
    .filter((story: any) => story.url)
    .sort((a: any, b: any) => b.points - a.points)
    .map((story: any) => ({
      id: story.objectID,
      title: story.title,
      url: story.url,
      score: story.points,
      time: story.created_at_i,
      author: story.author,
      numComments: story.num_comments,
    }));

  return limit ? stories.slice(0, limit) : stories;
}

/**
 * Fetch and extract text content from a URL
 */
async function fetchArticleContent(
  url: string,
  maxLength: number = 1500
): Promise<string | null> {
  try {
    const response = await fetch(url);
    const html = await response.text();

    // Basic content extraction - remove scripts, styles, and HTML tags
    const text = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return text.slice(0, maxLength);
  } catch (error) {
    console.error(`Failed to fetch content from ${url}:`, error);
    return null;
  }
}

export interface HNStoryWithContent extends HNStory {
  content: string | null;
}

/**
 * Fetch content for multiple stories in parallel
 */
async function fetchStoriesContent(
  stories: HNStory[],
  maxLength: number = 1500
): Promise<HNStoryWithContent[]> {
  return Promise.all(
    stories.map(async (story) => ({
      ...story,
      content: await fetchArticleContent(story.url, maxLength),
    }))
  );
}

export default {
  getStories,
  fetchArticleContent,
  fetchStoriesContent,
};

// =============================================================================
// AI-callable tools
// =============================================================================

export const hnGetStories = {
  description: 'Fetch recent Hacker News stories from the Algolia API',
  inputSchema: z.object({
    daysBack: z.number().optional().describe('Number of days to look back. Defaults to 7'),
    minPoints: z.number().optional().describe('Minimum points threshold. Defaults to 50'),
    frontPageOnly: z.boolean().optional().describe('Only include front page stories. Defaults to true'),
    limit: z.number().optional().describe('Maximum number of stories to return. Defaults to all'),
  }),
  execute: async (input: {
    daysBack?: number;
    minPoints?: number;
    frontPageOnly?: boolean;
    limit?: number;
  }) => {
    return getStories(input);
  },
};

export const hnFetchArticleContent = {
  description: 'Fetch and extract text content from a URL (basic HTML to text conversion)',
  inputSchema: z.object({
    url: z.string().describe('The URL to fetch content from'),
    maxLength: z.number().optional().describe('Maximum characters to return. Defaults to 1500'),
  }),
  execute: async (input: { url: string; maxLength?: number }) => {
    return fetchArticleContent(input.url, input.maxLength);
  },
};

export const hnFetchStoriesContent = {
  description: 'Fetch content for multiple HN stories in parallel',
  inputSchema: z.object({
    stories: z.array(z.object({
      id: z.string(),
      title: z.string(),
      url: z.string(),
      score: z.number(),
      time: z.number(),
      author: z.string().optional(),
      numComments: z.number().optional(),
    })).describe('Array of HN stories to fetch content for'),
    maxLength: z.number().optional().describe('Maximum characters per article. Defaults to 1500'),
  }),
  execute: async (input: {
    stories: Array<{
      id: string;
      title: string;
      url: string;
      score: number;
      time: number;
      author?: string;
      numComments?: number;
    }>;
    maxLength?: number;
  }) => {
    return fetchStoriesContent(input.stories, input.maxLength);
  },
};

export const hnTools = {
  hnGetStories,
  hnFetchArticleContent,
  hnFetchStoriesContent,
};
