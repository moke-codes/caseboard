export type FeedSource = "timeline" | string;

export interface FeedOption {
  label: string;
  value: FeedSource;
}

export type FeedMediaType = "image" | "video" | "gif";

export interface FeedMediaItem {
  id: string;
  type: FeedMediaType;
  url: string;
  previewUrl?: string;
  alt?: string;
}

export interface FeedPost {
  uri?: string;
  cid?: string;
  text: string;
  textLinks?: {
    start: number;
    end: number;
    url: string;
  }[];
  createdAt?: string;
  replyCount?: number;
  authorDisplayName: string;
  authorHandle: string;
  authorAvatar?: string;
  media: FeedMediaItem[];
}

export interface BoardCard {
  id: string;
  post: FeedPost;
  x: number;
  y: number;
}

export interface PostIt {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
}

export interface ThreadLink {
  id: string;
  from: string;
  to: string;
  color: string;
}

export interface PersistedBoard {
  cards: BoardCard[];
  postIts: PostIt[];
  links: ThreadLink[];
  cardSeed: number;
  postItSeed: number;
  linkSeed: number;
  postItColor?: string;
}

export interface SessionIdentity {
  handle: string;
  did: string;
}
