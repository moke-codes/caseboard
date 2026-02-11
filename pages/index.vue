<script setup lang="ts">
import { useInfiniteScroll, useLocalStorage } from "@vueuse/core";
import type { ComponentPublicInstance } from "vue";
import type { FeedMediaItem, FeedOption, FeedPost, FeedSource } from "~/types/caseboard";
import { useBoardStore } from "~/stores/board";

const boardStore = useBoardStore();
const { session, isRestoringSession, initSession, login, logout: logoutBluesky, getActorFeeds, getFeedPage } =
  useBluesky();

const identifier = ref("");
const appPassword = ref("");
const loginError = ref("");
const isLoggingIn = ref(false);

const showOnboarding = ref(false);
const showClearBoardModal = ref(false);
const onboardingSeen = useLocalStorage<Record<string, boolean>>("caseboard:onboarding", {});

const feedOptions = ref<FeedOption[]>([{ label: "Home Timeline", value: "timeline" }]);
const activeFeed = ref<FeedSource>("timeline");
const feedItems = ref<FeedPost[]>([]);
const feedCursor = ref<string | null>(null);
const feedHasMore = ref(true);
const feedLoading = ref(false);
const feedStatus = ref("Select a feed after login");
const hydratedHandle = ref("");

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
const hlsInstances = new Map<HTMLVideoElement, { destroy: () => void }>();
const boundVideoUrls = new WeakMap<HTMLVideoElement, string>();

const accountLabel = computed(() => {
  if (!session.value) return "";
  return `${session.value.handle} connected`;
});

const renderedThreads = computed(() => {
  const cardWidth = 230;
  const pinCenterY = 10;

  return boardStore.links
    .map((link) => {
      const from = boardStore.cards.find((card) => card.id === link.from);
      const to = boardStore.cards.find((card) => card.id === link.to);
      if (!from || !to) return null;

      return {
        id: link.id,
        color: link.color,
        x1: from.x + cardWidth / 2,
        y1: from.y + pinCenterY,
        x2: to.x + cardWidth / 2,
        y2: to.y + pinCenterY,
      };
    })
    .filter(
      (
        line,
      ): line is { id: string; color: string; x1: number; y1: number; x2: number; y2: number } =>
        line !== null,
    );
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
  showClearBoardModal.value = true;
}

function cancelClearBoard() {
  showClearBoardModal.value = false;
}

function confirmClearBoard() {
  boardStore.clearBoard();
  showClearBoardModal.value = false;
}

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
}

async function loadMorePosts() {
  if (!session.value || feedLoading.value || !feedHasMore.value) return;

  feedLoading.value = true;
  feedStatus.value = "Loading posts...";

  try {
    const page = await getFeedPage(activeFeed.value, feedCursor.value);
    feedItems.value = [...feedItems.value, ...page.posts];
    feedCursor.value = page.cursor;
    feedHasMore.value = Boolean(page.cursor);

    if (!feedItems.value.length) {
      feedStatus.value = "No posts available in this feed.";
    } else if (feedHasMore.value) {
      feedStatus.value = "Scroll for more posts";
    } else {
      feedStatus.value = "End of feed";
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load feed.";
    feedStatus.value = `Could not load feed: ${message}`;
  } finally {
    feedLoading.value = false;
  }
}

async function onFeedChange() {
  resetFeedState();
  await loadMorePosts();
}

async function bootstrapForSession() {
  if (!session.value) return;
  if (hydratedHandle.value === session.value.handle) return;

  boardStore.hydrateForHandle(session.value.handle);
  openOnboardingIfFirstTime();
  await loadFeedOptions();
  activeFeed.value = "timeline";
  resetFeedState();
  await loadMorePosts();
  hydratedHandle.value = session.value.handle;
  await nextTick();
  updateBoardSize();
  initInteract();
}

function onFeedDragStart(post: FeedPost, event: DragEvent) {
  dragPayload.value = post;
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("text/plain", post.uri ?? post.cid ?? Date.now().toString());
}

function onFeedDragEnd() {
  dragPayload.value = null;
}

function onBoardDragOver(event: DragEvent) {
  if (!dragPayload.value || !event.dataTransfer) return;
  event.dataTransfer.dropEffect = "copy";
}

function onBoardDrop(event: DragEvent) {
  if (!dragPayload.value || !boardDropzoneRef.value) return;

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
}

function addPostIt() {
  boardStore.addPostIt();
}

function setLinkMode(enabled: boolean) {
  boardStore.setLinkMode(enabled);
}

function onCardClick(cardId: string) {
  boardStore.selectCardForLink(cardId);
}

function onThreadColorInput(event: Event) {
  const target = event.target as HTMLInputElement;
  boardStore.setLinkColor(target.value);
}

function onPostItInput(noteId: string, event: Event) {
  const target = event.target as HTMLTextAreaElement;
  boardStore.updatePostItText(noteId, target.value);
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
      ".board-card, .postit, .postit-editor, .postit-handle, .polaroid, button, textarea, input, select",
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

  interactApi(".board-card").draggable({
    inertia: true,
    listeners: {
      move(event) {
        const target = event.target as HTMLElement;
        const cardId = target.dataset.cardId;
        if (!cardId) return;
        boardStore.moveCardByDelta(cardId, event.dx / boardCamera.scale, event.dy / boardCamera.scale);
      },
    },
  });

  interactApi(".postit").draggable({
    inertia: true,
    allowFrom: ".postit-handle",
    listeners: {
      move(event) {
        const target = event.target as HTMLElement;
        const noteId = target.dataset.noteId;
        if (!noteId) return;
        boardStore.movePostItByDelta(noteId, event.dx / boardCamera.scale, event.dy / boardCamera.scale);
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
  boardStore.resetSessionState();
  hydratedHandle.value = "";

  identifier.value = "";
  appPassword.value = "";
  loginError.value = "";
  showOnboarding.value = false;
  showClearBoardModal.value = false;

  feedOptions.value = [{ label: "Home Timeline", value: "timeline" }];
  activeFeed.value = "timeline";
  feedItems.value = [];
  feedCursor.value = null;
  feedHasMore.value = true;
  feedLoading.value = false;
  feedStatus.value = "Select a feed after login";

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
    canLoadMore: () => Boolean(session.value) && feedHasMore.value && !feedLoading.value,
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
  () => session.value?.handle ?? "",
  async (handle) => {
    if (!handle) return;
    await bootstrapForSession();
  },
);

onMounted(() => {
  void import("interactjs").then((module) => {
    interactApi = module.default;
    initInteract();
  });
  void initSession().then(async () => {
    await bootstrapForSession();
  });
  updateBoardSize();
  window.addEventListener("resize", updateBoardSize);
});

onUnmounted(() => {
  window.removeEventListener("resize", updateBoardSize);
  interactApi?.(".board-card").unset();
  interactApi?.(".postit").unset();
  hlsInstances.forEach((instance) => instance.destroy());
  hlsInstances.clear();
});
</script>

<template>
  <main>
    <section id="login-view" class="view" :class="{ active: !session && !isRestoringSession }">
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

    <section id="board-view" class="view" :class="{ active: Boolean(session) }">
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
            <button class="tool-btn" @click="addPostIt">Add Post-it</button>
            <button class="tool-btn" @click="openClearBoardModal">Clear Board</button>
            <label>
              Thread color
              <input :value="boardStore.linkColor" type="color" @input="onThreadColorInput" />
            </label>
            <button v-if="!boardStore.linkMode" class="tool-btn" @click="setLinkMode(true)">Link Posts</button>
            <button v-else class="tool-btn" @click="setLinkMode(false)">Cancel Linking</button>
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
                />
              </svg>

              <article
                v-for="card in boardStore.cards"
                :key="card.id"
                class="board-card"
                :class="{
                  selected: boardStore.selectedCardIds.includes(card.id),
                  'media-card': Boolean(card.post.media?.length),
                }"
                :data-card-id="card.id"
                :style="{ left: `${card.x}px`, top: `${card.y}px` }"
                @click="onCardClick(card.id)"
              >
                <div class="pin" aria-hidden="true"></div>
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
                        <img
                          v-else
                          class="post-media"
                          :src="mediaItem.url"
                          :alt="mediaItem.alt || 'Post media'"
                          loading="lazy"
                        />
                      </template>
                    </div>
                    <p class="media-caption">{{ card.post.text }}</p>
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
                        <strong>{{ card.post.authorDisplayName }}</strong>
                      </div>
                      <span class="handle">@{{ card.post.authorHandle }}</span>
                    </header>
                    <p class="post-text">{{ card.post.text }}</p>
                    <time class="date">{{ formatDate(card.post.createdAt) }}</time>
                  </template>
                </div>
              </article>

              <article
                v-for="note in boardStore.postIts"
                :key="note.id"
                class="postit"
                :data-note-id="note.id"
                :style="{ left: `${note.x}px`, top: `${note.y}px` }"
              >
                <div class="pin pin-postit" aria-hidden="true"></div>
                <div class="postit-handle"></div>
                <textarea
                  class="postit-editor"
                  spellcheck="false"
                  placeholder="Type your note..."
                  @input="onPostItInput(note.id, $event)"
                  :value="note.text"
                ></textarea>
              </article>
            </div>
          </div>
        </section>

        <aside id="feed-panel">
          <div class="feed-controls">
            <label for="feed-select">Choose feed</label>
            <select id="feed-select" v-model="activeFeed" @change="onFeedChange">
              <option v-for="feed in feedOptions" :key="feed.value" :value="feed.value">{{ feed.label }}</option>
            </select>
          </div>

          <div id="feed-list" ref="feedListRef">
            <article
              v-for="post in feedItems"
              :key="post.uri || post.cid"
              class="feed-item"
              draggable="true"
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
              <p class="post-text">{{ post.text }}</p>
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
                  <img
                    v-else
                    class="post-media"
                    :src="mediaItem.url"
                    :alt="mediaItem.alt || 'Post media'"
                    loading="lazy"
                  />
                </template>
              </div>
              <time class="date">{{ formatDate(post.createdAt) }}</time>
            </article>
          </div>

          <p id="feed-status" class="muted">{{ feedStatus }}</p>
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
  </main>
</template>
