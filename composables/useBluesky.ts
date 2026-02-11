import { BskyAgent } from "@atproto/api";
import type { FeedOption, FeedPost, FeedSource, SessionIdentity } from "~/types/caseboard";

interface FeedPage {
  posts: FeedPost[];
  cursor: string | null;
}

interface RawFeedEntry {
  post?: {
    uri?: string;
    cid?: string;
    indexedAt?: string;
    record?: {
      text?: string;
      createdAt?: string;
    };
    author?: {
      displayName?: string;
      handle?: string;
      avatar?: string;
    };
  };
}

function normalizePost(entry: RawFeedEntry): FeedPost {
  const post = entry.post ?? {};
  const record = post.record ?? {};
  const author = post.author ?? {};

  return {
    uri: post.uri,
    cid: post.cid,
    text: record.text ?? "(No text content)",
    createdAt: record.createdAt ?? post.indexedAt,
    authorDisplayName: author.displayName ?? "Unknown",
    authorHandle: author.handle ?? "unknown",
    authorAvatar: author.avatar,
  };
}

export function useBluesky() {
  const agent = useState<BskyAgent | null>("bsky:agent", () => null);
  const session = useState<SessionIdentity | null>("bsky:session", () => null);

  async function login(identifier: string, password: string): Promise<SessionIdentity> {
    const newAgent = new BskyAgent({ service: "https://bsky.social" });
    const response = await newAgent.login({ identifier, password });

    const identity = {
      handle: response.data.handle,
      did: response.data.did,
    };

    agent.value = newAgent;
    session.value = identity;
    return identity;
  }

  function logout() {
    agent.value = null;
    session.value = null;
  }

  async function getActorFeeds(did: string): Promise<FeedOption[]> {
    if (!agent.value) {
      throw new Error("Not authenticated");
    }

    const response = await agent.value.app.bsky.feed.getActorFeeds({
      actor: did,
      limit: 100,
    });

    const options: FeedOption[] = [{ label: "Home Timeline", value: "timeline" }];

    for (const feed of response.data.feeds ?? []) {
      options.push({
        label: feed.displayName ?? feed.uri,
        value: feed.uri,
      });
    }

    return options;
  }

  async function getFeedPage(feed: FeedSource, cursor: string | null): Promise<FeedPage> {
    if (!agent.value) {
      throw new Error("Not authenticated");
    }

    if (feed === "timeline") {
      const response = await agent.value.getTimeline({ limit: 20, cursor: cursor ?? undefined });
      const posts = (response.data.feed ?? []).map((entry) => normalizePost(entry as RawFeedEntry));
      return {
        posts,
        cursor: response.data.cursor ?? null,
      };
    }

    const response = await agent.value.app.bsky.feed.getFeed({
      feed,
      limit: 20,
      cursor: cursor ?? undefined,
    });

    const posts = (response.data.feed ?? []).map((entry) => normalizePost(entry as RawFeedEntry));
    return {
      posts,
      cursor: response.data.cursor ?? null,
    };
  }

  return {
    session,
    login,
    logout,
    getActorFeeds,
    getFeedPage,
  };
}
