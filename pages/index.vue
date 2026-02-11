<script setup lang="ts">
import { useDebounceFn, useInfiniteScroll, useLocalStorage } from "@vueuse/core";
import type { ComponentPublicInstance } from "vue";
import type { FeedMediaItem, FeedOption, FeedPost, FeedSource } from "~/types/caseboard";
import { useBoardStore } from "~/stores/board";
import { linkifyPostTextWithLinks, postUriToWebUrl } from "~/utils/postFormatting.mjs";

const boardStore = useBoardStore();
const {
  session,
  isRestoringSession,
  initSession,
  login,
  logout: logoutBluesky,
  getActorFeeds,
  getFeedPage,
  getPostReplies,
  searchPosts,
} = useBluesky();

const identifier = ref("");
const appPassword = ref("");
const loginError = ref("");
const isLoggingIn = ref(false);

const showOnboarding = ref(false);
const showClearBoardModal = ref(false);
const showShareModal = ref(false);
const onboardingSeen = useLocalStorage<Record<string, boolean>>("caseboard:onboarding", {});
const route = useRoute();

const feedOptions = ref<FeedOption[]>([{ label: "Home Timeline", value: "timeline" }]);
const activeFeed = ref<FeedSource>("timeline");
const feedItems = ref<FeedPost[]>([]);
const feedCursor = ref<string | null>(null);
const feedHasMore = ref(true);
const feedLoading = ref(false);
const feedStatus = ref("Select a feed after login");
const feedMode = ref<"feed" | "search">("feed");
const searchQuery = ref("");
const hydratedHandle = ref("");
const replyViewStack = ref<{ parent: FeedPost; replies: FeedPost[] }[]>([]);
const shareError = ref("");
const shareLinkView = ref("");
const shareLinkEdit = ref("");
const shareLoading = ref(false);
const shareCopyState = reactive({
  viewCopied: false,
  editCopied: false,
});
const expandedImage = ref<{ url: string; alt: string } | null>(null);
const sharedRole = ref<"view" | "edit" | null>(null);
const sharedContext = ref<{ id: string; token: string } | null>(null);
const sharedRevision = ref(0);
const sharedDirty = ref(false);
const sharedSyncInFlight = ref(false);
const isApplyingRemoteSharedBoard = ref(false);
const hasShareQuery = computed(
  () => typeof route.query.share === "string" && typeof route.query.token === "string",
);

const feedListRef = ref<HTMLElement | null>(null);
const boardDropzoneRef = ref<HTMLElement | null>(null);
const boardSize = reactive({ width: 1200, height: 700 });
const boardWorld = reactive({ width: 3600, height: 2200 });
const boardCamera = reactive({
  x: 24,
  y: 24,
  scale: 1,
  minScale: 0.2,
  maxScale: 2.4,
});
const boardIsPanning = ref(false);
const quickLinkSource = ref<string | null>(null);
const quickLinkHoverTarget = ref<string | null>(null);
const quickLinkPointer = reactive({
  x: 0,
  y: 0,
  inside: false,
});

const activePointers = new Map<number, { x: number; y: number }>();
const panPointerId = ref<number | null>(null);
const lastPanPoint = reactive({ x: 0, y: 0 });
const pinchStart = reactive({
  distance: 0,
  scale: 1,
  cameraX: 0,
  cameraY: 0,
  focalX: 0,
  focalY: 0,
});

const dragPayload = ref<FeedPost | null>(null);
let interactApi: (typeof import("interactjs"))["default"] | null = null;
let hlsModulePromise: Promise<typeof import("hls.js") | null> | null = null;
let sharedSyncRunId = 0;
let sharedUploadInterval: ReturnType<typeof setInterval> | null = null;
let stopBoardSubscription: (() => void) | null = null;
const hlsInstances = new Map<HTMLVideoElement, { destroy: () => void }>();
const boundVideoUrls = new WeakMap<HTMLVideoElement, string>();

type SharedBoardResponse = {
  board: ReturnType<typeof boardStore.exportBoard>;
  role: "view" | "edit";
  updatedAt: string;
  revision?: number;
};

type SharedBoardChangesResponse = {
  changed: boolean;
  role: "view" | "edit";
  board?: ReturnType<typeof boardStore.exportBoard>;
  updatedAt: string;
  revision?: number;
};

const accountLabel = computed(() => {
  if (sharedRole.value) {
    const roleText = sharedRole.value === "edit" ? "Editor" : "Read-only";
    if (session.value) return `${session.value.handle} · Shared (${roleText})`;
    return `Shared Board (${roleText})`;
  }
  if (!session.value) return "";
  return `${session.value.handle} connected`;
});

const boardAccessActive = computed(() => Boolean(session.value) || Boolean(sharedContext.value));
const canEditBoard = computed(() => sharedRole.value !== "view");
const isSearchMode = computed(() => feedMode.value === "search");

const inReplyView = computed(() => replyViewStack.value.length > 0);
const activeReplyParent = computed(() => {
  if (!replyViewStack.value.length) return null;
  return replyViewStack.value[replyViewStack.value.length - 1].parent;
});
const displayedFeedItems = computed(() => {
  if (isSearchMode.value) return feedItems.value;
  if (!replyViewStack.value.length) return feedItems.value;
  return replyViewStack.value[replyViewStack.value.length - 1].replies;
});

const BOARD_CARD_WIDTH = 230;
const BOARD_CARD_PIN_CENTER_Y = 10;
const POSTIT_WIDTH = 180;
const POSTIT_PIN_CENTER_Y = 0;

function resolveBoardTargetPoint(target: string) {
  if (target.startsWith("note:")) {
    const noteId = target.slice(5);
    const note = boardStore.postIts.find((item) => item.id === noteId);
    if (!note) return null;
    return {
      x: note.x + POSTIT_WIDTH / 2,
      y: note.y + POSTIT_PIN_CENTER_Y,
    };
  }

  const cardId = target.startsWith("card:") ? target.slice(5) : target;
  const card = boardStore.cards.find((item) => item.id === cardId);
  if (!card) return null;
  return {
    x: card.x + BOARD_CARD_WIDTH / 2,
    y: card.y + BOARD_CARD_PIN_CENTER_Y,
  };
}

const renderedThreads = computed(() => {
  return boardStore.links
    .map((link) => {
      const from = resolveBoardTargetPoint(link.from);
      const to = resolveBoardTargetPoint(link.to);
      if (!from || !to) return null;

      return {
        id: link.id,
        color: link.color,
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
      };
    })
    .filter(
      (
        line,
      ): line is { id: string; color: string; x1: number; y1: number; x2: number; y2: number } =>
        line !== null,
    );
});

const quickLinkPreview = computed(() => {
  if (!quickLinkSource.value || !quickLinkPointer.inside) return null;
  const from = resolveBoardTargetPoint(quickLinkSource.value);
  if (!from) return null;
  return {
    x1: from.x,
    y1: from.y,
    x2: quickLinkPointer.x,
    y2: quickLinkPointer.y,
    color: boardStore.linkColor,
  };
});

const boardStageStyle = computed(() => ({
  width: `${boardWorld.width}px`,
  height: `${boardWorld.height}px`,
  transform: `translate(${boardCamera.x}px, ${boardCamera.y}px) scale(${boardCamera.scale})`,
}));

function formatDate(value?: string) {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function updateBoardSize() {
  if (!boardDropzoneRef.value) return;
  boardSize.width = boardDropzoneRef.value.clientWidth;
  boardSize.height = boardDropzoneRef.value.clientHeight;
  constrainCameraToBoard();
}

function openOnboardingIfFirstTime() {
  if (!session.value) return;
  const alreadySeen = Boolean(onboardingSeen.value[session.value.handle]);
  showOnboarding.value = !alreadySeen;
}

function dismissOnboarding() {
  if (!session.value) return;
  onboardingSeen.value = {
    ...onboardingSeen.value,
    [session.value.handle]: true,
  };
  showOnboarding.value = false;
}

function openClearBoardModal() {
  if (!canEditBoard.value) return;
  showClearBoardModal.value = true;
}

function cancelClearBoard() {
  showClearBoardModal.value = false;
}

function confirmClearBoard() {
  if (!canEditBoard.value) return;
  boardStore.clearBoard();
  showClearBoardModal.value = false;
}

function openShareModal() {
  shareError.value = "";
  shareLinkView.value = "";
  shareLinkEdit.value = "";
  showShareModal.value = true;
  void generateShareLinks();
}

function closeShareModal() {
  showShareModal.value = false;
}

async function generateShareLinks() {
  shareError.value = "";
  shareLoading.value = true;
  try {
    const response = await $fetch<{ id: string; viewToken: string; editToken: string }>("/api/share/create", {
      method: "POST",
      body: {
        board: boardStore.exportBoard(),
      },
    });
    const origin = import.meta.client ? window.location.origin : "";
    shareLinkView.value = `${origin}/?share=${encodeURIComponent(response.id)}&token=${encodeURIComponent(response.viewToken)}`;
    shareLinkEdit.value = `${origin}/?share=${encodeURIComponent(response.id)}&token=${encodeURIComponent(response.editToken)}`;
    sharedContext.value = { id: response.id, token: response.editToken };
    sharedRole.value = "edit";
    sharedRevision.value = 1;
    sharedDirty.value = false;
    startSharedUploadLoop();
    void pollSharedBoard();
    feedStatus.value = "Sharing enabled for this board";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate share links.";
    shareError.value = message;
  } finally {
    shareLoading.value = false;
  }
}

async function copyShareLink(value: string) {
  if (!import.meta.client || !value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // no-op
  }
}

let shareCopyResetTimer: ReturnType<typeof setTimeout> | null = null;

async function onCopyShareLink(type: "view" | "edit") {
  const value = type === "view" ? shareLinkView.value : shareLinkEdit.value;
  if (!value) return;
  await copyShareLink(value);

  if (type === "view") {
    shareCopyState.viewCopied = true;
  } else {
    shareCopyState.editCopied = true;
  }

  if (shareCopyResetTimer) {
    clearTimeout(shareCopyResetTimer);
  }
  shareCopyResetTimer = setTimeout(() => {
    shareCopyState.viewCopied = false;
    shareCopyState.editCopied = false;
    shareCopyResetTimer = null;
  }, 1800);
}

function stopSharedPolling() {
  sharedSyncRunId += 1;
}

function stopSharedUploadLoop() {
  if (sharedUploadInterval === null) return;
  clearInterval(sharedUploadInterval);
  sharedUploadInterval = null;
}

function startSharedUploadLoop() {
  if (!import.meta.client || !sharedContext.value || sharedRole.value !== "edit") return;
  stopSharedUploadLoop();
  sharedUploadInterval = setInterval(() => {
    if (!sharedDirty.value) return;
    void flushSharedBoardSync();
  }, 1000);
}

async function applySharedBoard(board: ReturnType<typeof boardStore.exportBoard>, revision: number) {
  isApplyingRemoteSharedBoard.value = true;
  boardStore.loadExternalBoard(board);
  sharedRevision.value = revision;
  sharedDirty.value = false;
  await nextTick();
  isApplyingRemoteSharedBoard.value = false;
}

async function flushSharedBoardSync() {
  if (!sharedContext.value || sharedRole.value !== "edit" || isApplyingRemoteSharedBoard.value || !sharedDirty.value) return;
  if (sharedSyncInFlight.value) return;

  sharedSyncInFlight.value = true;
  try {
    while (sharedDirty.value && sharedContext.value && sharedRole.value === "edit" && !isApplyingRemoteSharedBoard.value) {
      sharedDirty.value = false;
      const response = await $fetch<{ ok: boolean; updatedAt: string; revision?: number }>(
        `/api/share/${encodeURIComponent(sharedContext.value.id)}`,
        {
          method: "PUT",
          body: {
            token: sharedContext.value.token,
            board: boardStore.exportBoard(),
          },
        },
      );
      sharedRevision.value = Number(response.revision ?? sharedRevision.value + 1);
    }
  } catch (error) {
    sharedDirty.value = true;
  } finally {
    sharedSyncInFlight.value = false;
  }
}

async function pollSharedBoard() {
  if (!import.meta.client || !sharedContext.value) return;
  stopSharedPolling();
  const thisRunId = sharedSyncRunId;
  const contextAtStart = { ...sharedContext.value };

  while (sharedContext.value && thisRunId === sharedSyncRunId) {
    try {
      const response = await $fetch<SharedBoardChangesResponse>(
        `/api/share/${encodeURIComponent(contextAtStart.id)}/changes`,
        {
          query: {
            token: contextAtStart.token,
            since: sharedRevision.value,
          },
        },
      );

      if (thisRunId !== sharedSyncRunId) return;

      sharedRole.value = response.role;
      if (sharedRole.value === "edit") {
        startSharedUploadLoop();
      } else {
        stopSharedUploadLoop();
      }
      const remoteRevision = Number(response.revision ?? sharedRevision.value);
      if (!response.changed || !response.board || remoteRevision <= sharedRevision.value) {
        continue;
      }

      await applySharedBoard(response.board, remoteRevision);
      feedStatus.value = "Shared board updated";
    } catch (error) {
      if (thisRunId !== sharedSyncRunId) return;
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }
}

async function loadSharedBoardIfPresent() {
  const shareId = typeof route.query.share === "string" ? route.query.share : "";
  const token = typeof route.query.token === "string" ? route.query.token : "";
  if (!shareId || !token) return false;

  shareError.value = "";
  try {
    const response = await $fetch<SharedBoardResponse>(`/api/share/${encodeURIComponent(shareId)}`, { query: { token } });
    sharedContext.value = { id: shareId, token };
    sharedRole.value = response.role;
    if (response.role === "edit") {
      startSharedUploadLoop();
    } else {
      stopSharedUploadLoop();
    }
    showOnboarding.value = false;
    await applySharedBoard(response.board, Number(response.revision ?? 1));
    void pollSharedBoard();
    feedStatus.value = "Shared board loaded";
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load shared board.";
    shareError.value = message;
    stopSharedPolling();
    return false;
  }
}

const syncSharedBoard = useDebounceFn(async () => {
  await flushSharedBoardSync();
}, 250);

async function loadFeedOptions() {
  if (!session.value) return;

  try {
    feedOptions.value = await getActorFeeds(session.value.did);
  } catch {
    feedOptions.value = [{ label: "Home Timeline", value: "timeline" }];
  }
}

function resetFeedState() {
  feedItems.value = [];
  feedCursor.value = null;
  feedHasMore.value = true;
  replyViewStack.value = [];
}

async function loadMorePosts() {
  if (!session.value || feedLoading.value || !feedHasMore.value) return;

  feedLoading.value = true;
  feedStatus.value = isSearchMode.value ? `Searching "${searchQuery.value.trim()}"...` : "Loading posts...";

  try {
    const page = isSearchMode.value
      ? await searchPosts(searchQuery.value, feedCursor.value)
      : await getFeedPage(activeFeed.value, feedCursor.value);
    feedItems.value = [...feedItems.value, ...page.posts];
    feedCursor.value = page.cursor;
    feedHasMore.value = Boolean(page.cursor);

    if (!feedItems.value.length) {
      feedStatus.value = isSearchMode.value ? "No posts found for this search." : "No posts available in this feed.";
    } else if (feedHasMore.value) {
      feedStatus.value = isSearchMode.value ? "Scroll for more search results" : "Scroll for more posts";
    } else {
      feedStatus.value = isSearchMode.value ? "End of search results" : "End of feed";
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load posts.";
    feedStatus.value = isSearchMode.value ? `Could not search posts: ${message}` : `Could not load feed: ${message}`;
  } finally {
    feedLoading.value = false;
  }
}

async function onFeedChange() {
  feedMode.value = "feed";
  searchQuery.value = "";
  resetFeedState();
  await loadMorePosts();
}

function openSearchPanel() {
  if (!session.value) return;
  feedMode.value = "search";
  replyViewStack.value = [];
  resetFeedState();
  feedStatus.value = "Search posts on Bluesky";
}

async function onSearchSubmit() {
  if (!session.value || feedLoading.value) return;
  const query = searchQuery.value.trim();
  if (!query) {
    await backToFeedPanel();
    return;
  }
  feedMode.value = "search";
  resetFeedState();
  await loadMorePosts();
}

async function backToFeedPanel() {
  searchQuery.value = "";
  feedMode.value = "feed";
  resetFeedState();
  await loadMorePosts();
}

async function openReplies(post: FeedPost) {
  if (!post.uri || feedLoading.value) return;

  feedLoading.value = true;
  feedStatus.value = "Loading replies...";
  try {
    const replies = await getPostReplies(post.uri);
    replyViewStack.value.push({ parent: post, replies });
    feedStatus.value = replies.length ? "Replies loaded" : "No replies for this post.";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load replies.";
    feedStatus.value = `Could not load replies: ${message}`;
  } finally {
    feedLoading.value = false;
  }
}

function backReplyLevel() {
  if (!replyViewStack.value.length) return;
  replyViewStack.value.pop();
  if (replyViewStack.value.length) {
    feedStatus.value = "Replies loaded";
  } else if (feedItems.value.length) {
    feedStatus.value = feedHasMore.value ? "Scroll for more posts" : "End of feed";
  } else {
    feedStatus.value = "No posts available in this feed.";
  }
}

async function bootstrapForSession() {
  if (!session.value) return;
  if (hasShareQuery.value) return;
  if (sharedContext.value) return;
  if (hydratedHandle.value === session.value.handle) return;

  boardStore.hydrateForHandle(session.value.handle);
  openOnboardingIfFirstTime();
  await loadFeedOptions();
  activeFeed.value = "timeline";
  feedMode.value = "feed";
  searchQuery.value = "";
  resetFeedState();
  await loadMorePosts();
  hydratedHandle.value = session.value.handle;
  await nextTick();
  updateBoardSize();
  initInteract();
}

function onFeedDragStart(post: FeedPost, event: DragEvent) {
  if (!session.value || !canEditBoard.value) return;
  dragPayload.value = post;
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("text/plain", post.uri ?? post.cid ?? Date.now().toString());
}

function onFeedDragEnd() {
  dragPayload.value = null;
}

function onBoardDragOver(event: DragEvent) {
  if (!canEditBoard.value) return;
  if (!dragPayload.value || !event.dataTransfer) return;
  event.dataTransfer.dropEffect = "copy";
}

function onBoardDrop(event: DragEvent) {
  if (!canEditBoard.value || !dragPayload.value || !boardDropzoneRef.value) return;

  boardStore.beginHistoryBatch();
  try {
    const point = screenToBoardPoint(event.clientX, event.clientY);
    const baseX = Math.max(0, point.x - 100);
    const baseY = Math.max(0, point.y - 50);

    const post = dragPayload.value;
    const media = post.media ?? [];

    if (!media.length) {
      boardStore.addCard(post, baseX, baseY);
      dragPayload.value = null;
      return;
    }

    const textCardId = boardStore.addCard(
      {
        ...post,
        media: [],
      },
      baseX,
      baseY,
    );

    media.forEach((item, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const mediaX = baseX + 280 + col * 245;
      const mediaY = baseY + row * 260;

      const mediaCardId = boardStore.addCard(
        {
          ...post,
          uri: `${post.uri ?? post.cid ?? "post"}#media-${index}`,
          cid: `${post.cid ?? post.uri ?? "post"}-media-${index}`,
          text: item.alt?.trim() || `${item.type.toUpperCase()} attachment`,
          media: [item],
        },
        mediaX,
        mediaY,
      );
      boardStore.addLink(textCardId, mediaCardId);
    });

    dragPayload.value = null;
  } finally {
    boardStore.endHistoryBatch();
  }
}

function addPostIt() {
  if (!canEditBoard.value) return;
  boardStore.addPostIt();
}

function setLinkMode(enabled: boolean) {
  if (!canEditBoard.value) return;
  boardStore.setLinkMode(enabled);
}

function onCardClick(cardId: string) {
  if (quickLinkSource.value) {
    const target = `card:${cardId}`;
    if (target !== quickLinkSource.value) {
      boardStore.addLink(quickLinkSource.value, target);
      quickLinkSource.value = null;
      quickLinkHoverTarget.value = null;
      quickLinkPointer.inside = false;
    }
    return;
  }
  if (!canEditBoard.value) return;
  boardStore.selectTargetForLink(`card:${cardId}`);
}

function onPostItClick(noteId: string) {
  if (quickLinkSource.value) {
    const target = `note:${noteId}`;
    if (target !== quickLinkSource.value) {
      boardStore.addLink(quickLinkSource.value, target);
      quickLinkSource.value = null;
      quickLinkHoverTarget.value = null;
      quickLinkPointer.inside = false;
    }
    return;
  }
  if (!canEditBoard.value) return;
  boardStore.selectTargetForLink(`note:${noteId}`);
}

function beginQuickLink(source: string, event: MouseEvent) {
  if (!canEditBoard.value) return;
  quickLinkSource.value = source;
  quickLinkHoverTarget.value = null;
  if (boardStore.linkMode) {
    boardStore.setLinkMode(false);
  }
  const point = screenToBoardPoint(event.clientX, event.clientY);
  quickLinkPointer.x = point.x;
  quickLinkPointer.y = point.y;
  quickLinkPointer.inside = true;
}

function onBoardTargetHover(target: string | null) {
  if (!quickLinkSource.value || !target || target === quickLinkSource.value) {
    quickLinkHoverTarget.value = null;
    return;
  }
  quickLinkHoverTarget.value = target;
}

function onThreadClick(linkId: string) {
  if (!canEditBoard.value) return;
  boardStore.deleteLink(linkId);
}

function onThreadColorInput(event: Event) {
  if (!canEditBoard.value) return;
  const target = event.target as HTMLInputElement;
  boardStore.setLinkColor(target.value);
}

function onPostItColorInput(event: Event) {
  if (!canEditBoard.value) return;
  const target = event.target as HTMLInputElement;
  boardStore.setPostItColor(target.value);
}

function onUndo() {
  boardStore.undo();
}

function onRedo() {
  boardStore.redo();
}

function onPostItInput(noteId: string, event: Event) {
  if (!canEditBoard.value) return;
  const target = event.target as HTMLTextAreaElement;
  boardStore.updatePostItText(noteId, target.value);
}

function onDeleteCard(cardId: string) {
  if (!canEditBoard.value) return;
  boardStore.deleteCard(cardId);
}

function onDeletePostIt(noteId: string) {
  if (!canEditBoard.value) return;
  boardStore.deletePostIt(noteId);
}

function openImagePreview(media: FeedMediaItem) {
  if (media.type !== "image") return;
  expandedImage.value = {
    url: media.url,
    alt: media.alt || "Expanded media",
  };
}

function closeImagePreview() {
  expandedImage.value = null;
}

function isVideoLikeMedia(media: FeedMediaItem) {
  return media.type === "video" || media.type === "gif";
}

function isHlsPlaylist(url: string) {
  return /\.m3u8($|\?)/i.test(url);
}

function cleanupVideoElement(element: HTMLVideoElement) {
  const existing = hlsInstances.get(element);
  if (existing) {
    existing.destroy();
    hlsInstances.delete(element);
  }
}

async function ensureHlsModule() {
  if (!import.meta.client) return null;
  if (!hlsModulePromise) {
    hlsModulePromise = import("hls.js").catch(() => null);
  }
  return hlsModulePromise;
}

async function attachVideoSource(element: HTMLVideoElement, media: FeedMediaItem) {
  const url = media.url;
  boundVideoUrls.set(element, url);
  cleanupVideoElement(element);

  if (!isHlsPlaylist(url)) {
    element.src = url;
    return;
  }

  if (element.canPlayType("application/vnd.apple.mpegurl")) {
    element.src = url;
    return;
  }

  const hlsModule = await ensureHlsModule();
  if (!hlsModule || boundVideoUrls.get(element) !== url) return;

  const Hls = hlsModule.default;
  if (!Hls.isSupported()) {
    element.src = media.previewUrl ?? "";
    return;
  }

  const hls = new Hls();
  hls.loadSource(url);
  hls.attachMedia(element);
  hlsInstances.set(element, hls);
}

function bindVideoElement(element: Element | ComponentPublicInstance | null, media: FeedMediaItem) {
  if (!(element instanceof HTMLVideoElement)) return;
  const currentUrl = boundVideoUrls.get(element);
  if (currentUrl === media.url) return;
  void attachVideoSource(element, media);
}

function effectiveMinScale() {
  if (!boardSize.width || !boardSize.height) return boardCamera.minScale;
  const minForWidth = boardSize.width / boardWorld.width;
  const minForHeight = boardSize.height / boardWorld.height;
  return Math.max(boardCamera.minScale, minForWidth, minForHeight);
}

function clampScale(scale: number) {
  return Math.min(boardCamera.maxScale, Math.max(effectiveMinScale(), scale));
}

function constrainCameraToBoard() {
  boardCamera.scale = clampScale(boardCamera.scale);
  const scaledWidth = boardWorld.width * boardCamera.scale;
  const scaledHeight = boardWorld.height * boardCamera.scale;

  const minX = Math.min(0, boardSize.width - scaledWidth);
  const minY = Math.min(0, boardSize.height - scaledHeight);
  const maxX = Math.max(0, boardSize.width - scaledWidth);
  const maxY = Math.max(0, boardSize.height - scaledHeight);

  if (scaledWidth <= boardSize.width) {
    boardCamera.x = (boardSize.width - scaledWidth) / 2;
  } else {
    boardCamera.x = Math.min(maxX, Math.max(minX, boardCamera.x));
  }

  if (scaledHeight <= boardSize.height) {
    boardCamera.y = (boardSize.height - scaledHeight) / 2;
  } else {
    boardCamera.y = Math.min(maxY, Math.max(minY, boardCamera.y));
  }
}

function screenToBoardPoint(clientX: number, clientY: number) {
  if (!boardDropzoneRef.value) return { x: 0, y: 0 };
  const rect = boardDropzoneRef.value.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  return {
    x: (localX - boardCamera.x) / boardCamera.scale,
    y: (localY - boardCamera.y) / boardCamera.scale,
  };
}

function zoomAtLocalPoint(focalX: number, focalY: number, scaleDelta: number) {
  const nextScale = clampScale(boardCamera.scale * scaleDelta);
  if (nextScale === boardCamera.scale) return;
  const worldX = (focalX - boardCamera.x) / boardCamera.scale;
  const worldY = (focalY - boardCamera.y) / boardCamera.scale;
  boardCamera.x = focalX - worldX * nextScale;
  boardCamera.y = focalY - worldY * nextScale;
  boardCamera.scale = nextScale;
  constrainCameraToBoard();
}

function shouldStartPan(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return true;
  return !Boolean(
    target.closest(
      ".board-card, .postit, .postit-editor, .postit-handle, .polaroid, .thread-line, .pin-link-btn, button, textarea, input, select",
    ),
  );
}

function onBoardPointerDown(event: PointerEvent) {
  if (!boardDropzoneRef.value) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (!shouldStartPan(event.target)) return;

  boardDropzoneRef.value.setPointerCapture(event.pointerId);
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (activePointers.size === 1) {
    panPointerId.value = event.pointerId;
    boardIsPanning.value = true;
    lastPanPoint.x = event.clientX;
    lastPanPoint.y = event.clientY;
  }

  if (activePointers.size >= 2) {
    const [a, b] = Array.from(activePointers.values());
    pinchStart.distance = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    pinchStart.scale = boardCamera.scale;
    pinchStart.cameraX = boardCamera.x;
    pinchStart.cameraY = boardCamera.y;
    if (boardDropzoneRef.value) {
      const rect = boardDropzoneRef.value.getBoundingClientRect();
      pinchStart.focalX = (a.x + b.x) / 2 - rect.left;
      pinchStart.focalY = (a.y + b.y) / 2 - rect.top;
    }
    boardIsPanning.value = false;
    panPointerId.value = null;
  }
}

function onBoardPointerMove(event: PointerEvent) {
  if (quickLinkSource.value) {
    const point = screenToBoardPoint(event.clientX, event.clientY);
    quickLinkPointer.x = point.x;
    quickLinkPointer.y = point.y;
    quickLinkPointer.inside = true;
  }

  if (!activePointers.has(event.pointerId)) return;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (activePointers.size >= 2) {
    const [a, b] = Array.from(activePointers.values());
    const distance = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nextScale = clampScale(pinchStart.scale * (distance / pinchStart.distance));
    const worldX = (pinchStart.focalX - pinchStart.cameraX) / pinchStart.scale;
    const worldY = (pinchStart.focalY - pinchStart.cameraY) / pinchStart.scale;
    boardCamera.x = pinchStart.focalX - worldX * nextScale;
    boardCamera.y = pinchStart.focalY - worldY * nextScale;
    boardCamera.scale = nextScale;
    constrainCameraToBoard();
    return;
  }

  if (panPointerId.value !== event.pointerId || !boardIsPanning.value) return;
  boardCamera.x += event.clientX - lastPanPoint.x;
  boardCamera.y += event.clientY - lastPanPoint.y;
  constrainCameraToBoard();
  lastPanPoint.x = event.clientX;
  lastPanPoint.y = event.clientY;
}

function onBoardPointerUp(event: PointerEvent) {
  activePointers.delete(event.pointerId);
  if (panPointerId.value === event.pointerId) {
    panPointerId.value = null;
    boardIsPanning.value = false;
  }
  if (activePointers.size === 1) {
    const [pointerId, point] = Array.from(activePointers.entries())[0];
    panPointerId.value = pointerId;
    boardIsPanning.value = true;
    lastPanPoint.x = point.x;
    lastPanPoint.y = point.y;
  }
}

function onBoardPointerLeave() {
  if (!quickLinkSource.value) return;
  quickLinkPointer.inside = false;
  quickLinkHoverTarget.value = null;
}

function onBoardWheel(event: WheelEvent) {
  if (!event.ctrlKey || !boardDropzoneRef.value) return;
  event.preventDefault();
  const rect = boardDropzoneRef.value.getBoundingClientRect();
  const focalX = event.clientX - rect.left;
  const focalY = event.clientY - rect.top;
  const scaleDelta = Math.exp(-event.deltaY * 0.0022);
  zoomAtLocalPoint(focalX, focalY, scaleDelta);
}

function initInteract() {
  if (!interactApi) return;

  interactApi(".board-card").unset();
  interactApi(".postit").unset();
  if (!canEditBoard.value) return;

  interactApi(".board-card").draggable({
    inertia: true,
    listeners: {
      start() {
        boardStore.beginHistoryBatch();
      },
      move(event) {
        const target = event.target as HTMLElement;
        const cardId = target.dataset.cardId;
        if (!cardId) return;
        boardStore.moveCardByDelta(cardId, event.dx / boardCamera.scale, event.dy / boardCamera.scale);
      },
      end() {
        boardStore.endHistoryBatch();
      },
    },
  });

  interactApi(".postit").draggable({
    inertia: true,
    ignoreFrom: ".postit-editor, .postit-actions a, .postit-actions .action-link",
    listeners: {
      start() {
        boardStore.beginHistoryBatch();
      },
      move(event) {
        const target = event.target as HTMLElement;
        const noteId = target.dataset.noteId;
        if (!noteId) return;
        boardStore.movePostItByDelta(noteId, event.dx / boardCamera.scale, event.dy / boardCamera.scale);
      },
      end() {
        boardStore.endHistoryBatch();
      },
    },
  });
}

async function onLoginSubmit() {
  loginError.value = "";

  if (!identifier.value || !appPassword.value) {
    loginError.value = "Please enter both handle and app password.";
    return;
  }

  isLoggingIn.value = true;
  try {
    await login(identifier.value, appPassword.value);
    await bootstrapForSession();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Login failed.";
    loginError.value = message;
  } finally {
    isLoggingIn.value = false;
  }
}

async function onLogout() {
  await logoutBluesky();
  stopSharedPolling();
  stopSharedUploadLoop();
  sharedContext.value = null;
  sharedRole.value = null;
  sharedRevision.value = 0;
  sharedDirty.value = false;
  sharedSyncInFlight.value = false;
  quickLinkSource.value = null;
  quickLinkHoverTarget.value = null;
  quickLinkPointer.inside = false;
  if (!sharedContext.value) {
    boardStore.resetSessionState();
    hydratedHandle.value = "";
  }

  identifier.value = "";
  appPassword.value = "";
  loginError.value = "";
  showOnboarding.value = false;
  showClearBoardModal.value = false;
  showShareModal.value = false;
  shareCopyState.viewCopied = false;
  shareCopyState.editCopied = false;

  feedOptions.value = [{ label: "Home Timeline", value: "timeline" }];
  activeFeed.value = "timeline";
  feedMode.value = "feed";
  searchQuery.value = "";
  feedItems.value = [];
  feedCursor.value = null;
  feedHasMore.value = true;
  feedLoading.value = false;
  feedStatus.value = "Select a feed after login";
  replyViewStack.value = [];

  if (import.meta.client) {
    interactApi?.(".board-card").unset();
    interactApi?.(".postit").unset();
  }
}

useInfiniteScroll(
  feedListRef,
  async () => {
    await loadMorePosts();
  },
  {
    distance: 120,
    canLoadMore: () => Boolean(session.value) && feedHasMore.value && !feedLoading.value && !inReplyView.value,
  },
);

watch(
  () => [boardStore.cards.length, boardStore.postIts.length],
  async () => {
    await nextTick();
    initInteract();
  },
);

watch(
  () => boardStore.changeVersion,
  () => {
    sharedDirty.value = true;
    void syncSharedBoard();
  },
);

watch(
  () => canEditBoard.value,
  async () => {
    await nextTick();
    initInteract();
  },
);

watch(
  () => session.value?.handle ?? "",
  async (handle) => {
    if (!handle) return;
    if (hasShareQuery.value) return;
    await bootstrapForSession();
  },
);

onMounted(() => {
  stopBoardSubscription = boardStore.$subscribe(() => {
    if (isApplyingRemoteSharedBoard.value) return;
    sharedDirty.value = true;
    void syncSharedBoard();
  });

  void import("interactjs").then((module) => {
    interactApi = module.default;
    initInteract();
  });
  void loadSharedBoardIfPresent().then((loadedShared) => {
    void initSession().then(async () => {
      if (!loadedShared) {
        await bootstrapForSession();
      }
    });
  });
  updateBoardSize();
  window.addEventListener("resize", updateBoardSize);
});

onUnmounted(() => {
    stopBoardSubscription?.();
  stopBoardSubscription = null;
  if (shareCopyResetTimer) {
    clearTimeout(shareCopyResetTimer);
    shareCopyResetTimer = null;
  }
  stopSharedPolling();
  stopSharedUploadLoop();
  quickLinkSource.value = null;
  quickLinkHoverTarget.value = null;
  quickLinkPointer.inside = false;
  window.removeEventListener("resize", updateBoardSize);
  interactApi?.(".board-card").unset();
  interactApi?.(".postit").unset();
  hlsInstances.forEach((instance) => instance.destroy());
  hlsInstances.clear();
});
</script>

<template>
  <main>
    <section
      id="login-view"
      class="view"
      :class="{ active: !session && !isRestoringSession && !sharedContext && !hasShareQuery }"
    >
      <div class="login-card">
        <h1>CaseBoard</h1>
        <p>Log in with your Bluesky account and app password.</p>
        <form @submit.prevent="onLoginSubmit">
          <label>
            Bluesky Handle
            <input v-model.trim="identifier" type="text" placeholder="you.bsky.social" required />
          </label>
          <label>
            App Password
            <input
              v-model.trim="appPassword"
              type="password"
              placeholder="xxxx-xxxx-xxxx-xxxx"
              required
            />
          </label>
          <button type="submit" :disabled="isLoggingIn">
            {{ isLoggingIn ? "Connecting..." : "Connect Account" }}
          </button>
        </form>
        <p v-if="loginError" class="error">{{ loginError }}</p>
      </div>
    </section>

    <section id="board-view" class="view" :class="{ active: boardAccessActive }">
      <header class="topbar">
        <div>
          <h2>Investigation Board</h2>
          <p>{{ accountLabel }}</p>
        </div>
        <button class="secondary" @click="onLogout">Log out</button>
      </header>

      <div class="workspace">
        <section id="board-panel">
          <div class="board-toolbar">
            <div class="toolbar-group toolbar-group-left">
              <button class="tool-btn" :disabled="!canEditBoard" @click="addPostIt">Post-it</button>
              <label class="thread-color-control postit-color-control" aria-label="Post-it color">
                <input
                  :value="boardStore.postItColor"
                  :disabled="!canEditBoard"
                  type="color"
                  @input="onPostItColorInput"
                />
              </label>
              <button
                v-if="!boardStore.linkMode"
                class="tool-btn tool-btn-link"
                :disabled="!canEditBoard"
                @click="setLinkMode(true)"
              >
                Link
              </button>
              <button v-else class="tool-btn tool-btn-link-active" :disabled="!canEditBoard" @click="setLinkMode(false)">
                Cancel Linking
              </button>
              <label class="thread-color-control" aria-label="Thread color">
                <input :value="boardStore.linkColor" :disabled="!canEditBoard" type="color" @input="onThreadColorInput" />
              </label>
            </div>
            <div class="toolbar-group toolbar-group-center">
              <button class="tool-btn" :disabled="!canEditBoard || !boardStore.canUndo" @click="onUndo">Undo</button>
              <button class="tool-btn" :disabled="!canEditBoard || !boardStore.canRedo" @click="onRedo">Redo</button>
            </div>
            <div class="toolbar-group toolbar-group-right">
              <button class="tool-btn" @click="openShareModal">Share</button>
              <button class="tool-btn tool-btn-danger" :disabled="!canEditBoard" @click="openClearBoardModal">
                Clear Board
              </button>
            </div>
          </div>

          <div
            id="board-dropzone"
            ref="boardDropzoneRef"
            :class="{ panning: boardIsPanning }"
            @dragover.prevent="onBoardDragOver"
            @drop.prevent="onBoardDrop"
            @pointerdown="onBoardPointerDown"
            @pointermove="onBoardPointerMove"
            @pointerup="onBoardPointerUp"
            @pointercancel="onBoardPointerUp"
            @pointerleave="onBoardPointerLeave"
            @wheel="onBoardWheel"
          >
            <div class="board-stage" :style="boardStageStyle">
              <svg id="thread-layer" :viewBox="`0 0 ${boardWorld.width} ${boardWorld.height}`">
                <line
                  v-for="line in renderedThreads"
                  :key="line.id"
                  class="thread-line"
                  :x1="line.x1"
                  :y1="line.y1"
                  :x2="line.x2"
                  :y2="line.y2"
                  :stroke="line.color"
                  @pointerdown.stop.prevent
                  @click.stop="onThreadClick(line.id)"
                />
                <line
                  v-if="quickLinkPreview"
                  class="thread-line thread-line-preview"
                  :x1="quickLinkPreview.x1"
                  :y1="quickLinkPreview.y1"
                  :x2="quickLinkPreview.x2"
                  :y2="quickLinkPreview.y2"
                  :stroke="quickLinkPreview.color"
                />
              </svg>

              <article
                v-for="card in boardStore.cards"
                :key="card.id"
                class="board-card"
                :class="{
                  selected: boardStore.selectedLinkTargets.includes(`card:${card.id}`),
                  'media-card': Boolean(card.post.media?.length),
                  'link-hover': quickLinkHoverTarget === `card:${card.id}`,
                  'link-source': quickLinkSource === `card:${card.id}`,
                }"
                :data-card-id="card.id"
                :style="{ left: `${card.x}px`, top: `${card.y}px` }"
                @click="onCardClick(card.id)"
                @mouseenter="onBoardTargetHover(`card:${card.id}`)"
                @mouseleave="onBoardTargetHover(null)"
              >
                <div class="pin" aria-hidden="true">
                  <button
                    class="pin-link-btn"
                    type="button"
                    title="Start link"
                    :disabled="!canEditBoard"
                    @click.stop.prevent="beginQuickLink(`card:${card.id}`, $event)"
                  >
                    +
                  </button>
                </div>
                <div class="polaroid">
                  <template v-if="card.post.media?.length">
                    <div class="polaroid-photo">
                      <template v-for="mediaItem in card.post.media" :key="mediaItem.id">
                        <video
                          v-if="isVideoLikeMedia(mediaItem)"
                          class="post-media"
                          :ref="(element) => bindVideoElement(element, mediaItem)"
                          :poster="mediaItem.previewUrl"
                          :controls="mediaItem.type !== 'gif'"
                          :autoplay="mediaItem.type === 'gif'"
                          :loop="mediaItem.type === 'gif'"
                          muted
                          playsinline
                          preload="metadata"
                        ></video>
                        <div v-else-if="mediaItem.type === 'image'" class="media-image-wrap">
                          <img class="post-media" :src="mediaItem.url" :alt="mediaItem.alt || 'Post media'" loading="lazy" />
                          <button
                            class="media-expand-btn"
                            type="button"
                            aria-label="Expand image"
                            @click.stop.prevent="openImagePreview(mediaItem)"
                          >
                            <span class="magnifier-icon" aria-hidden="true"></span>
                          </button>
                        </div>
                        <img v-else class="post-media" :src="mediaItem.url" :alt="mediaItem.alt || 'Post media'" loading="lazy" />
                      </template>
                    </div>
                    <p class="media-caption" v-html="linkifyPostTextWithLinks(card.post.text, card.post.textLinks ?? [])"></p>
                    <div class="post-go-row">
                      <a
                        v-if="postUriToWebUrl(card.post)"
                        :href="postUriToWebUrl(card.post)!"
                        target="_blank"
                        rel="noopener noreferrer"
                        @click.stop
                        >Go</a
                      >
                      <button class="action-link" @click.stop="onDeleteCard(card.id)">Del</button>
                    </div>
                  </template>
                  <template v-else>
                    <header>
                      <div class="author-line">
                        <img
                          v-if="card.post.authorAvatar"
                          class="author-avatar"
                          :src="card.post.authorAvatar"
                          :alt="`${card.post.authorDisplayName} avatar`"
                          loading="lazy"
                          referrerpolicy="no-referrer"
                        />
                        <div v-else class="author-avatar avatar-fallback" aria-hidden="true">
                          {{ card.post.authorDisplayName.slice(0, 1).toUpperCase() }}
                        </div>
                        <div class="author-meta">
                          <strong>{{ card.post.authorDisplayName }}</strong>
                          <span class="handle">@{{ card.post.authorHandle }}</span>
                        </div>
                      </div>
                    </header>
                    <p class="post-text" v-html="linkifyPostTextWithLinks(card.post.text, card.post.textLinks ?? [])"></p>
                    <time class="date">{{ formatDate(card.post.createdAt) }}</time>
                    <div class="post-go-row">
                      <a
                        v-if="postUriToWebUrl(card.post)"
                        :href="postUriToWebUrl(card.post)!"
                        target="_blank"
                        rel="noopener noreferrer"
                        @click.stop
                        >Go</a
                      >
                      <button class="action-link" @click.stop="onDeleteCard(card.id)">Del</button>
                    </div>
                  </template>
                </div>
              </article>

              <article
                v-for="note in boardStore.postIts"
                :key="note.id"
                class="postit"
                :class="{
                  selected: boardStore.selectedLinkTargets.includes(`note:${note.id}`),
                  'link-hover': quickLinkHoverTarget === `note:${note.id}`,
                  'link-source': quickLinkSource === `note:${note.id}`,
                }"
                :data-note-id="note.id"
                :style="{ left: `${note.x}px`, top: `${note.y}px`, '--postit-color': note.color }"
                @click.stop="onPostItClick(note.id)"
                @mouseenter="onBoardTargetHover(`note:${note.id}`)"
                @mouseleave="onBoardTargetHover(null)"
              >
                <div class="pin pin-postit" aria-hidden="true">
                  <button
                    class="pin-link-btn"
                    type="button"
                    title="Start link"
                    :disabled="!canEditBoard"
                    @click.stop.prevent="beginQuickLink(`note:${note.id}`, $event)"
                  >
                    +
                  </button>
                </div>
                <div class="postit-handle"></div>
                <textarea
                  class="postit-editor"
                  spellcheck="false"
                  placeholder="Type your note..."
                  @input="onPostItInput(note.id, $event)"
                  :value="note.text"
                ></textarea>
                <div class="postit-actions">
                  <button class="action-link" @click.stop="onDeletePostIt(note.id)">Del</button>
                </div>
              </article>
            </div>
          </div>
        </section>

        <aside id="feed-panel">
          <template v-if="!isSearchMode">
            <div class="feed-toolbar">
              <div class="feed-toolbar-group">
                <label for="feed-select">Feed</label>
                <select id="feed-select" v-model="activeFeed" :disabled="!session" @change="onFeedChange">
                  <option v-for="feed in feedOptions" :key="feed.value" :value="feed.value">{{ feed.label }}</option>
                </select>
              </div>
              <button class="feed-toolbar-link" :disabled="!session" @click="openSearchPanel">Search</button>
            </div>

            <div v-if="inReplyView" class="reply-nav">
              <button class="secondary" @click="backReplyLevel">&larr; Post</button>
              <p class="muted">
                Replies to {{ activeReplyParent?.authorDisplayName || "post" }}
              </p>
            </div>

            <div id="feed-list" ref="feedListRef">
              <article
                v-for="post in displayedFeedItems"
                :key="post.uri || post.cid"
                class="feed-item"
                :draggable="Boolean(session) && canEditBoard"
                @dragstart="onFeedDragStart(post, $event)"
                @dragend="onFeedDragEnd"
              >
                <header>
                  <div class="author-line">
                    <img
                      v-if="post.authorAvatar"
                      class="author-avatar"
                      :src="post.authorAvatar"
                      :alt="`${post.authorDisplayName} avatar`"
                      loading="lazy"
                      referrerpolicy="no-referrer"
                    />
                    <div v-else class="author-avatar avatar-fallback" aria-hidden="true">
                      {{ post.authorDisplayName.slice(0, 1).toUpperCase() }}
                    </div>
                    <strong>{{ post.authorDisplayName }}</strong>
                  </div>
                  <span class="handle">@{{ post.authorHandle }}</span>
                </header>
                <p class="post-text" v-html="linkifyPostTextWithLinks(post.text, post.textLinks ?? [])"></p>
                <div v-if="post.media?.length" class="post-media-list">
                  <template v-for="mediaItem in post.media" :key="mediaItem.id">
                    <video
                      v-if="isVideoLikeMedia(mediaItem)"
                      class="post-media"
                      :ref="(element) => bindVideoElement(element, mediaItem)"
                      :poster="mediaItem.previewUrl"
                      :controls="mediaItem.type !== 'gif'"
                      :autoplay="mediaItem.type === 'gif'"
                      :loop="mediaItem.type === 'gif'"
                      muted
                      playsinline
                      preload="metadata"
                    ></video>
                    <div v-else-if="mediaItem.type === 'image'" class="media-image-wrap">
                      <img class="post-media" :src="mediaItem.url" :alt="mediaItem.alt || 'Post media'" loading="lazy" />
                      <button
                        class="media-expand-btn"
                        type="button"
                        aria-label="Expand image"
                        @click.stop.prevent="openImagePreview(mediaItem)"
                      >
                        <span class="magnifier-icon" aria-hidden="true"></span>
                      </button>
                    </div>
                    <img v-else class="post-media" :src="mediaItem.url" :alt="mediaItem.alt || 'Post media'" loading="lazy" />
                  </template>
                </div>
                <div class="feed-item-meta">
                  <time class="date">{{ formatDate(post.createdAt) }}</time>
                  <button
                    v-if="post.uri && (post.replyCount ?? 0) > 0"
                    class="reply-link"
                    @click.stop="openReplies(post)"
                  >
                    View replies ({{ post.replyCount }})
                  </button>
                </div>
              </article>
            </div>

            <p id="feed-status" class="muted">{{ feedStatus }}</p>
          </template>

          <template v-else>
            <div class="search-panel-head">
              <button class="reply-link back-link" :disabled="feedLoading" @click="backToFeedPanel">&larr; Back</button>
              <form class="feed-search" @submit.prevent="onSearchSubmit">
                <input
                  v-model.trim="searchQuery"
                  type="text"
                  :disabled="!session"
                  placeholder="Search Bluesky posts..."
                  aria-label="Search Bluesky posts"
                />
                <button class="tool-btn" type="submit" :disabled="!session || feedLoading || !searchQuery">Search</button>
              </form>
            </div>

            <div id="feed-list" ref="feedListRef">
              <article
                v-for="post in feedItems"
                :key="post.uri || post.cid"
                class="feed-item"
                :draggable="Boolean(session) && canEditBoard"
                @dragstart="onFeedDragStart(post, $event)"
                @dragend="onFeedDragEnd"
              >
                <header>
                  <div class="author-line">
                    <img
                      v-if="post.authorAvatar"
                      class="author-avatar"
                      :src="post.authorAvatar"
                      :alt="`${post.authorDisplayName} avatar`"
                      loading="lazy"
                      referrerpolicy="no-referrer"
                    />
                    <div v-else class="author-avatar avatar-fallback" aria-hidden="true">
                      {{ post.authorDisplayName.slice(0, 1).toUpperCase() }}
                    </div>
                    <strong>{{ post.authorDisplayName }}</strong>
                  </div>
                  <span class="handle">@{{ post.authorHandle }}</span>
                </header>
                <p class="post-text" v-html="linkifyPostTextWithLinks(post.text, post.textLinks ?? [])"></p>
                <div v-if="post.media?.length" class="post-media-list">
                  <template v-for="mediaItem in post.media" :key="mediaItem.id">
                    <video
                      v-if="isVideoLikeMedia(mediaItem)"
                      class="post-media"
                      :ref="(element) => bindVideoElement(element, mediaItem)"
                      :poster="mediaItem.previewUrl"
                      :controls="mediaItem.type !== 'gif'"
                      :autoplay="mediaItem.type === 'gif'"
                      :loop="mediaItem.type === 'gif'"
                      muted
                      playsinline
                      preload="metadata"
                    ></video>
                    <div v-else-if="mediaItem.type === 'image'" class="media-image-wrap">
                      <img class="post-media" :src="mediaItem.url" :alt="mediaItem.alt || 'Post media'" loading="lazy" />
                      <button
                        class="media-expand-btn"
                        type="button"
                        aria-label="Expand image"
                        @click.stop.prevent="openImagePreview(mediaItem)"
                      >
                        <span class="magnifier-icon" aria-hidden="true"></span>
                      </button>
                    </div>
                    <img v-else class="post-media" :src="mediaItem.url" :alt="mediaItem.alt || 'Post media'" loading="lazy" />
                  </template>
                </div>
                <div class="feed-item-meta">
                  <time class="date">{{ formatDate(post.createdAt) }}</time>
                </div>
              </article>
            </div>

            <p id="feed-status" class="muted">{{ feedStatus }}</p>
          </template>
        </aside>
      </div>
    </section>

    <div
      v-if="showOnboarding"
      id="onboarding-modal"
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div class="modal-content">
        <h3 id="onboarding-title">How CaseBoard Works</h3>
        <ol>
          <li>Pick one of your feeds in the right panel.</li>
          <li>Drag posts from the feed and drop them onto the board.</li>
          <li>Move polaroid cards around and connect them with colored threads.</li>
          <li>Add post-its and write notes while you investigate.</li>
        </ol>
        <button @click="dismissOnboarding">Start Investigating</button>
      </div>
    </div>

    <div
      v-if="showClearBoardModal"
      id="clear-board-modal"
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clear-board-title"
    >
      <div class="modal-content">
        <h3 id="clear-board-title">Clear Board?</h3>
        <p>This will remove all posts, post-its, and thread links from this board.</p>
        <div class="modal-actions">
          <button class="secondary" @click="cancelClearBoard">Cancel</button>
          <button @click="confirmClearBoard">Clear Board</button>
        </div>
      </div>
    </div>

    <div v-if="showShareModal" id="share-modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
      <div class="modal-content">
        <h3 id="share-title">Share Caseboard</h3>
        <p>Create links for read-only access or editor access.</p>
        <div class="modal-actions">
          <button class="secondary" :disabled="shareLoading" @click="closeShareModal">Close</button>
        </div>
        <p v-if="shareLoading" class="muted">Generating links...</p>
        <p v-if="shareError" class="error">{{ shareError }}</p>
        <div v-if="shareLinkView" class="share-links">
          <label>
            Read-only
            <input :value="shareLinkView" type="text" readonly />
          </label>
          <button class="secondary share-copy-btn" :class="{ copied: shareCopyState.viewCopied }" @click="onCopyShareLink('view')">
            {{ shareCopyState.viewCopied ? "Copy Read-only - Copied" : "Copy Read-only" }}
          </button>
          <label>
            Editor
            <input :value="shareLinkEdit" type="text" readonly />
          </label>
          <button class="secondary share-copy-btn" :class="{ copied: shareCopyState.editCopied }" @click="onCopyShareLink('edit')">
            {{ shareCopyState.editCopied ? "Copy Editor - Copied" : "Copy Editor" }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="expandedImage"
      id="media-preview-modal"
      class="modal media-preview-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Expanded image preview"
      @click.self="closeImagePreview"
    >
      <div class="modal-content media-preview-content">
        <button class="secondary media-preview-close" type="button" @click="closeImagePreview">Close</button>
        <img :src="expandedImage.url" :alt="expandedImage.alt" />
      </div>
    </div>
  </main>
</template>
