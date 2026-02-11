export type FeedSource = "timeline" | string;

export interface FeedOption {
  label: string;
  value: FeedSource;
}

export interface FeedPost {
  uri?: string;
  cid?: string;
  text: string;
  createdAt?: string;
  authorDisplayName: string;
  authorHandle: string;
  authorAvatar?: string;
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
}

export interface SessionIdentity {
  handle: string;
  did: string;
}
