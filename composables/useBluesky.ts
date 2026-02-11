import { BskyAgent } from "@atproto/api";
import type { AtpSessionData } from "@atproto/api";
import type { FeedMediaItem, FeedOption, FeedPost, FeedSource, SessionIdentity } from "~/types/caseboard";

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
    embed?: unknown;
    replyCount?: number;
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function buildByteToCodeUnitMap(text: string) {
  const encoder = new TextEncoder();
  const map: number[] = [0];
  let byteOffset = 0;
  let codeUnitOffset = 0;

  for (const char of text) {
    const bytes = encoder.encode(char);
    byteOffset += bytes.length;
    codeUnitOffset += char.length;
    map[byteOffset] = codeUnitOffset;
  }

  return map;
}

function byteOffsetToCodeUnitIndex(map: number[], byteOffset: number) {
  if (byteOffset <= 0) return 0;
  if (byteOffset >= map.length) return map[map.length - 1] ?? 0;

  for (let index = byteOffset; index >= 0; index -= 1) {
    const mapped = map[index];
    if (typeof mapped === "number") return mapped;
  }
  return 0;
}

function extractTextLinks(record: Record<string, unknown>, text: string) {
  const facets = Array.isArray(record.facets) ? record.facets : [];
  if (!facets.length) return [] as { start: number; end: number; url: string }[];

  const byteMap = buildByteToCodeUnitMap(text);
  const links: { start: number; end: number; url: string }[] = [];

  for (const facetItem of facets) {
    const facet = asRecord(facetItem);
    if (!facet) continue;
    const index = asRecord(facet.index);
    const features = Array.isArray(facet.features) ? facet.features : [];
    if (!index || !features.length) continue;

    const byteStart = asNumber(index.byteStart);
    const byteEnd = asNumber(index.byteEnd);
    if (byteStart === undefined || byteEnd === undefined || byteEnd <= byteStart) continue;

    for (const featureItem of features) {
      const feature = asRecord(featureItem);
      if (!feature) continue;
      const type = asString(feature.$type) ?? "";
      if (!type.includes("#link")) continue;
      const uri = asString(feature.uri);
      if (!uri) continue;

      const start = byteOffsetToCodeUnitIndex(byteMap, byteStart);
      const end = byteOffsetToCodeUnitIndex(byteMap, byteEnd);
      if (end <= start) continue;
      links.push({ start, end, url: uri });
    }
  }

  links.sort((a, b) => a.start - b.start || a.end - b.end);
  return links;
}

function extractMediaFromEmbed(embed: unknown): FeedMediaItem[] {
  const root = asRecord(embed);
  if (!root) return [];

  const type = asString(root.$type) ?? "";

  if (type.includes("recordWithMedia")) {
    return extractMediaFromEmbed(root.media);
  }

  if (type.includes("images")) {
    const images = Array.isArray(root.images) ? root.images : [];
    const parsed: FeedMediaItem[] = [];
    images.forEach((image, index) => {
      const item = asRecord(image);
      if (!item) return;
      const fullsize = asString(item.fullsize);
      const thumb = asString(item.thumb);
      const url = fullsize ?? thumb;
      if (!url) return;
      parsed.push({
        id: `img-${index}-${url}`,
        type: "image",
        url,
        previewUrl: thumb ?? fullsize,
        alt: asString(item.alt),
      });
    });
    return parsed;
  }

  if (type.includes("video")) {
    const playlist = asString(root.playlist);
    const cid = asString(root.cid);
    const uri = asString(root.uri);
    const url = playlist ?? uri ?? cid;
    if (!url) return [];
    const mimeType = asString(root.mimeType);
    const mediaType = mimeType?.includes("gif") ? "gif" : "video";
    return [
      {
        id: `video-${url}`,
        type: mediaType,
        url,
        previewUrl: asString(root.thumbnail),
        alt: asString(root.alt),
      },
    ];
  }

  if (type.includes("external")) {
    const external = asRecord(root.external);
    if (!external) return [];
    const thumb = asString(external.thumb);
    if (!thumb) return [];
    return [
      {
        id: `ext-${thumb}`,
        type: "image",
        url: thumb,
        previewUrl: thumb,
        alt: asString(external.title),
      },
    ];
  }

  if (root.media) {
    return extractMediaFromEmbed(root.media);
  }

  return [];
}

function normalizePostFromRecord(rawPost: Record<string, unknown>): FeedPost | null {
  const record = asRecord(rawPost.record) ?? {};
  const author = asRecord(rawPost.author) ?? {};

  const uri = asString(rawPost.uri);
  const cid = asString(rawPost.cid);
  const text = asString(record.text) ?? "(No text content)";
  const createdAt = asString(record.createdAt) ?? asString(rawPost.indexedAt);
  const replyCount = typeof rawPost.replyCount === "number" ? rawPost.replyCount : undefined;

  return {
    uri,
    cid,
    text,
    textLinks: extractTextLinks(record, text),
    createdAt,
    replyCount,
    authorDisplayName: asString(author.displayName) ?? "Unknown",
    authorHandle: asString(author.handle) ?? "unknown",
    authorAvatar: asString(author.avatar),
    media: extractMediaFromEmbed(rawPost.embed),
  };
}

function getThreadNodePost(node: unknown): Record<string, unknown> | null {
  const item = asRecord(node);
  if (!item) return null;
  if (item.post) return asRecord(item.post);
  if (item.uri && item.author) return item;
  return null;
}

function getThreadReplies(node: unknown): unknown[] {
  const item = asRecord(node);
  if (!item || !Array.isArray(item.replies)) return [];
  return item.replies;
}

function findThreadNodeByUri(node: unknown, uri: string): unknown | null {
  const post = getThreadNodePost(node);
  if (post && asString(post.uri) === uri) return node;
  const replies = getThreadReplies(node);
  for (const reply of replies) {
    const found = findThreadNodeByUri(reply, uri);
    if (found) return found;
  }
  return null;
}

const ENCRYPTED_SESSION_KEY = "caseboard:auth:session";
const KEY_DB_NAME = "caseboard:crypto";
const KEY_STORE_NAME = "keys";
const KEY_ID = "auth-session-key";

interface EncryptedPayload {
  iv: string;
  data: string;
}

function isClient() {
  return import.meta.client && typeof window !== "undefined";
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function openKeyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(KEY_STORE_NAME)) {
        database.createObjectStore(KEY_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open key database."));
  });
}

function readStoredKey(database: IDBDatabase): Promise<CryptoKey | null> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(KEY_STORE_NAME, "readonly");
    const store = transaction.objectStore(KEY_STORE_NAME);
    const request = store.get(KEY_ID);

    request.onsuccess = () => resolve((request.result as CryptoKey | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Could not read encryption key."));
  });
}

function saveKey(database: IDBDatabase, key: CryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(KEY_STORE_NAME, "readwrite");
    const store = transaction.objectStore(KEY_STORE_NAME);
    const request = store.put(key, KEY_ID);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Could not save encryption key."));
  });
}

async function getOrCreateCryptoKey() {
  const database = await openKeyDatabase();
  try {
    const existing = await readStoredKey(database);
    if (existing) return existing;
    const generated = (await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    )) as CryptoKey;
    await saveKey(database, generated);
    return generated;
  } finally {
    database.close();
  }
}

async function encryptSession(sessionData: AtpSessionData) {
  const key = await getOrCreateCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(sessionData));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  const payload: EncryptedPayload = {
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(ciphertext)),
  };
  return JSON.stringify(payload);
}

async function decryptSession(encryptedPayload: string): Promise<AtpSessionData | null> {
  const key = await getOrCreateCryptoKey();
  const parsed = JSON.parse(encryptedPayload) as EncryptedPayload;
  if (!parsed?.iv || !parsed?.data) return null;
  const iv = base64ToBytes(parsed.iv);
  const data = base64ToBytes(parsed.data);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  const json = new TextDecoder().decode(new Uint8Array(decrypted));
  return JSON.parse(json) as AtpSessionData;
}

async function persistEncryptedSession(sessionData: AtpSessionData | undefined) {
  if (!isClient()) return;
  if (!sessionData) {
    localStorage.removeItem(ENCRYPTED_SESSION_KEY);
    return;
  }
  const encrypted = await encryptSession(sessionData);
  localStorage.setItem(ENCRYPTED_SESSION_KEY, encrypted);
}

async function loadPersistedSession() {
  if (!isClient()) return null;
  const encrypted = localStorage.getItem(ENCRYPTED_SESSION_KEY);
  if (!encrypted) return null;
  try {
    return await decryptSession(encrypted);
  } catch {
    localStorage.removeItem(ENCRYPTED_SESSION_KEY);
    return null;
  }
}

function createAgent() {
  return new BskyAgent({
    service: "https://bsky.social",
    persistSession: async (_event, nextSession) => {
      await persistEncryptedSession(nextSession);
    },
  });
}

function normalizePost(entry: RawFeedEntry): FeedPost {
  const post = entry.post ?? {};
  return (
    normalizePostFromRecord(post as unknown as Record<string, unknown>) ?? {
      uri: post.uri,
      cid: post.cid,
      text: "(No text content)",
      createdAt: post.indexedAt,
      authorDisplayName: "Unknown",
      authorHandle: "unknown",
      authorAvatar: undefined,
      replyCount: typeof post.replyCount === "number" ? post.replyCount : undefined,
      media: [],
    }
  );
}

function normalizeSearchPost(entry: unknown): FeedPost | null {
  const candidate = asRecord(entry);
  if (!candidate) return null;
  const rawPost = candidate.post ? asRecord(candidate.post) : candidate;
  if (!rawPost) return null;
  return normalizePostFromRecord(rawPost);
}

export function useBluesky() {
  const agent = useState<BskyAgent | null>("bsky:agent", () => null);
  const session = useState<SessionIdentity | null>("bsky:session", () => null);
  const initStarted = useState("bsky:init-started", () => false);
  const isRestoringSession = useState("bsky:is-restoring", () => false);

  async function initSession(): Promise<SessionIdentity | null> {
    if (!isClient()) return null;
    if (session.value) return session.value;
    if (initStarted.value) return session.value;

    initStarted.value = true;
    isRestoringSession.value = true;
    try {
      const persistedSession = await loadPersistedSession();
      if (!persistedSession) return null;

      const restoredAgent = createAgent();
      const resumed = await restoredAgent.resumeSession(persistedSession);
      const identity = {
        handle: resumed.data.handle,
        did: resumed.data.did,
      };
      agent.value = restoredAgent;
      session.value = identity;
      return identity;
    } catch {
      await persistEncryptedSession(undefined);
      agent.value = null;
      session.value = null;
      return null;
    } finally {
      isRestoringSession.value = false;
    }
  }

  async function login(identifier: string, password: string): Promise<SessionIdentity> {
    const newAgent = createAgent();
    const response = await newAgent.login({ identifier, password });

    const identity = {
      handle: response.data.handle,
      did: response.data.did,
    };

    agent.value = newAgent;
    session.value = identity;
    await persistEncryptedSession({
      accessJwt: response.data.accessJwt,
      refreshJwt: response.data.refreshJwt,
      handle: response.data.handle,
      did: response.data.did,
      active: response.data.active ?? true,
      status: response.data.status,
      email: response.data.email,
      emailConfirmed: response.data.emailConfirmed,
      emailAuthFactor: response.data.emailAuthFactor,
    });
    return identity;
  }

  async function logout() {
    try {
      await agent.value?.logout();
    } catch {
      // Ignore network errors on logout; local cleanup still happens.
    }
    agent.value = null;
    session.value = null;
    await persistEncryptedSession(undefined);
  }

  async function getActorFeeds(did: string): Promise<FeedOption[]> {
    if (!agent.value) {
      throw new Error("Not authenticated");
    }

    const orderedFeeds: FeedSource[] = ["timeline"];
    const labelByFeed = new Map<FeedSource, string>([["timeline", "Home Timeline"]]);

    const ownFeedsResponse = await agent.value.app.bsky.feed.getActorFeeds({
      actor: did,
      limit: 100,
    });

    for (const feed of ownFeedsResponse.data.feeds ?? []) {
      const uri = feed.uri;
      orderedFeeds.push(uri);
      labelByFeed.set(uri, feed.displayName ?? feed.uri);
    }

    try {
      const prefs = await agent.value.getPreferences();
      const savedFeedUris = (prefs.savedFeeds ?? [])
        .filter((item) => item.type === "feed")
        .map((item) => item.value)
        .filter((value): value is string => typeof value === "string" && value.length > 0);

      const unresolved = savedFeedUris.filter((uri) => !labelByFeed.has(uri));
      const resolvableSavedUris = new Set<string>();

      if (unresolved.length) {
        const chunkSize = 25;
        for (let index = 0; index < unresolved.length; index += chunkSize) {
          const chunk = unresolved.slice(index, index + chunkSize);
          const details = await agent.value.app.bsky.feed.getFeedGenerators({ feeds: chunk });
          for (const feed of details.data.feeds ?? []) {
            labelByFeed.set(feed.uri, feed.displayName ?? feed.uri);
            resolvableSavedUris.add(feed.uri);
          }
        }
      }

      for (const uri of savedFeedUris) {
        if (unresolved.includes(uri) && !resolvableSavedUris.has(uri)) continue;
        orderedFeeds.push(uri);
      }
    } catch {
      // Keep own feeds even if saved/pinned feeds cannot be loaded.
    }

    const deduped: FeedOption[] = [];
    const seen = new Set<FeedSource>();
    for (const feed of orderedFeeds) {
      if (seen.has(feed)) continue;
      seen.add(feed);
      deduped.push({
        value: feed,
        label: labelByFeed.get(feed) ?? String(feed),
      });
    }

    return deduped;
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

  async function getPostReplies(uri: string): Promise<FeedPost[]> {
    if (!agent.value) {
      throw new Error("Not authenticated");
    }

    const response = await agent.value.app.bsky.feed.getPostThread({
      uri,
      depth: 8,
    });

    const thread = response.data.thread;
    const focusNode = findThreadNodeByUri(thread, uri) ?? thread;
    const replies = getThreadReplies(focusNode);

    const parsed: FeedPost[] = [];
    const seen = new Set<string>();

    for (const replyNode of replies) {
      const post = getThreadNodePost(replyNode);
      if (!post) continue;
      const normalized = normalizePostFromRecord(post);
      if (!normalized) continue;
      const key = normalized.uri ?? normalized.cid ?? `${normalized.authorHandle}:${normalized.createdAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parsed.push(normalized);
    }

    return parsed;
  }

  async function searchPosts(query: string, cursor: string | null): Promise<FeedPage> {
    if (!agent.value) {
      throw new Error("Not authenticated");
    }

    const trimmed = query.trim();
    if (!trimmed) {
      return { posts: [], cursor: null };
    }

    const response = await agent.value.app.bsky.feed.searchPosts({
      q: trimmed,
      limit: 20,
      cursor: cursor ?? undefined,
    });

    const posts = (response.data.posts ?? [])
      .map((entry) => normalizeSearchPost(entry))
      .filter((post): post is FeedPost => post !== null);

    return {
      posts,
      cursor: response.data.cursor ?? null,
    };
  }

  return {
    session,
    isRestoringSession,
    initSession,
    login,
    logout,
    getActorFeeds,
    getFeedPage,
    getPostReplies,
    searchPosts,
  };
}
