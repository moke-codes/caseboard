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
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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
    media: extractMediaFromEmbed(post.embed),
  };
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
    isRestoringSession,
    initSession,
    login,
    logout,
    getActorFeeds,
    getFeedPage,
  };
}
