export interface FeedArticle {
  id: string;
  title: string;
  url: string;
  summary: string;
  pubDate: string;
  content?: string; // Cache full article text
  imageUrl?: string; // Cache main image of the article
  aiSummary?: string; // Cache AI-extracted refined Chinese summary
}

export interface RSSFeed {
  id: string;
  url: string;
  title: string;
  description: string;
  created_at: string;
  last_updated_at: string;
  articles: FeedArticle[];
  isNativeRss?: boolean;
}

export interface RSSBundle {
  id: string;
  name: string;
  description: string;
  feedIds: string[];
  created_at: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  created_at: string;
}
