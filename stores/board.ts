import { useLocalStorage } from "@vueuse/core";
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import type { BoardCard, FeedPost, PersistedBoard, PostIt, ThreadLink } from "~/types/caseboard";

function emptyBoard(): PersistedBoard {
  return {
    cards: [],
    postIts: [],
    links: [],
    cardSeed: 1,
    postItSeed: 1,
    linkSeed: 1,
  };
}

interface BoardHistorySnapshot {
  cards: BoardCard[];
  postIts: PostIt[];
  links: ThreadLink[];
  cardSeed: number;
  postItSeed: number;
  linkSeed: number;
  linkMode: boolean;
  selectedLinkTargets: string[];
  linkColor: string;
}

function cloneState<T>(state: T): T {
  return JSON.parse(JSON.stringify(state)) as T;
}

export const useBoardStore = defineStore("board", () => {
  const storage = useLocalStorage<Record<string, PersistedBoard>>("caseboard:boards", {});
  const activeHandle = ref("");

  const cards = ref<BoardCard[]>([]);
  const postIts = ref<PostIt[]>([]);
  const links = ref<ThreadLink[]>([]);

  const linkMode = ref(false);
  const linkColor = ref("#cc1f36");
  const selectedLinkTargets = ref<string[]>([]);

  const cardSeed = ref(1);
  const postItSeed = ref(1);
  const linkSeed = ref(1);
  const changeVersion = ref(0);

  const undoStack = ref<BoardHistorySnapshot[]>([]);
  const redoStack = ref<BoardHistorySnapshot[]>([]);
  const historyBatchDepth = ref(0);
  const batchedBeforeSnapshot = ref<BoardHistorySnapshot | null>(null);
  const isApplyingHistory = ref(false);
  const HISTORY_LIMIT = 200;

  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);

  function snapshotCurrentState(): BoardHistorySnapshot {
    return {
      cards: cloneState(cards.value),
      postIts: cloneState(postIts.value),
      links: cloneState(links.value),
      cardSeed: cardSeed.value,
      postItSeed: postItSeed.value,
      linkSeed: linkSeed.value,
      linkMode: linkMode.value,
      selectedLinkTargets: [...selectedLinkTargets.value],
      linkColor: linkColor.value,
    };
  }

  function resetHistoryState() {
    undoStack.value = [];
    redoStack.value = [];
    historyBatchDepth.value = 0;
    batchedBeforeSnapshot.value = null;
  }

  function sameSnapshot(a: BoardHistorySnapshot, b: BoardHistorySnapshot) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function pushUndoSnapshot(snapshot: BoardHistorySnapshot) {
    const last = undoStack.value[undoStack.value.length - 1];
    if (last && sameSnapshot(last, snapshot)) return;
    undoStack.value.push(snapshot);
    if (undoStack.value.length > HISTORY_LIMIT) {
      undoStack.value.shift();
    }
  }

  function applySnapshot(snapshot: BoardHistorySnapshot) {
    isApplyingHistory.value = true;
    cards.value = cloneState(snapshot.cards);
    postIts.value = cloneState(snapshot.postIts);
    links.value = cloneState(snapshot.links);
    cardSeed.value = snapshot.cardSeed;
    postItSeed.value = snapshot.postItSeed;
    linkSeed.value = snapshot.linkSeed;
    linkMode.value = snapshot.linkMode;
    selectedLinkTargets.value = [...snapshot.selectedLinkTargets];
    linkColor.value = snapshot.linkColor;
    isApplyingHistory.value = false;
  }

  function markChanged() {
    changeVersion.value += 1;
  }

  function recordBeforeMutation() {
    if (isApplyingHistory.value) return;

    if (historyBatchDepth.value > 0) {
      if (!batchedBeforeSnapshot.value) {
        batchedBeforeSnapshot.value = snapshotCurrentState();
      }
      return;
    }

    pushUndoSnapshot(snapshotCurrentState());
    redoStack.value = [];
  }

  function beginHistoryBatch() {
    historyBatchDepth.value += 1;
  }

  function endHistoryBatch() {
    if (historyBatchDepth.value === 0) return;
    historyBatchDepth.value -= 1;
    if (historyBatchDepth.value > 0) return;

    const before = batchedBeforeSnapshot.value;
    batchedBeforeSnapshot.value = null;
    if (!before) return;

    const after = snapshotCurrentState();
    if (sameSnapshot(before, after)) return;
    pushUndoSnapshot(before);
    redoStack.value = [];
  }

  function undo() {
    if (!undoStack.value.length) return;
    const previous = undoStack.value.pop();
    if (!previous) return;
    redoStack.value.push(snapshotCurrentState());
    applySnapshot(previous);
    markChanged();
  }

  function redo() {
    if (!redoStack.value.length) return;
    const next = redoStack.value.pop();
    if (!next) return;
    pushUndoSnapshot(snapshotCurrentState());
    applySnapshot(next);
    markChanged();
  }

  function persist() {
    if (!activeHandle.value) return;
    storage.value = {
      ...storage.value,
      [activeHandle.value]: {
        cards: cards.value,
        postIts: postIts.value,
        links: links.value,
        cardSeed: cardSeed.value,
        postItSeed: postItSeed.value,
        linkSeed: linkSeed.value,
      },
    };
  }

  function hydrateForHandle(handle: string) {
    activeHandle.value = handle;
    const saved = storage.value[handle];

    if (!saved) {
      const fresh = emptyBoard();
      cards.value = fresh.cards;
      postIts.value = fresh.postIts;
      links.value = fresh.links;
      cardSeed.value = fresh.cardSeed;
      postItSeed.value = fresh.postItSeed;
      linkSeed.value = fresh.linkSeed;
      linkMode.value = false;
      selectedLinkTargets.value = [];
      resetHistoryState();
      return;
    }

    cards.value = saved.cards ?? [];
    postIts.value = saved.postIts ?? [];
    links.value = saved.links ?? [];
    cardSeed.value = saved.cardSeed ?? 1;
    postItSeed.value = saved.postItSeed ?? 1;
    linkSeed.value = saved.linkSeed ?? 1;
    linkMode.value = false;
    selectedLinkTargets.value = [];
    resetHistoryState();
  }

  function exportBoard(): PersistedBoard {
    return {
      cards: cloneState(cards.value),
      postIts: cloneState(postIts.value),
      links: cloneState(links.value),
      cardSeed: cardSeed.value,
      postItSeed: postItSeed.value,
      linkSeed: linkSeed.value,
    };
  }

  function loadExternalBoard(board: PersistedBoard) {
    activeHandle.value = "";
    cards.value = cloneState(board.cards ?? []);
    postIts.value = cloneState(board.postIts ?? []);
    links.value = cloneState(board.links ?? []);
    cardSeed.value = board.cardSeed ?? 1;
    postItSeed.value = board.postItSeed ?? 1;
    linkSeed.value = board.linkSeed ?? 1;
    linkMode.value = false;
    selectedLinkTargets.value = [];
    resetHistoryState();
  }

  function resetSessionState() {
    activeHandle.value = "";
    cards.value = [];
    postIts.value = [];
    links.value = [];
    selectedLinkTargets.value = [];
    linkMode.value = false;
    cardSeed.value = 1;
    postItSeed.value = 1;
    linkSeed.value = 1;
    resetHistoryState();
  }

  function addCard(post: FeedPost, x: number, y: number) {
    recordBeforeMutation();
    const id = String(cardSeed.value++);
    cards.value.push({
      id,
      post,
      x,
      y,
    });
    markChanged();
    return id;
  }

  function moveCardByDelta(id: string, dx: number, dy: number) {
    recordBeforeMutation();
    const card = cards.value.find((item) => item.id === id);
    if (!card) return;
    card.x = Math.max(0, card.x + dx);
    card.y = Math.max(0, card.y + dy);
    markChanged();
  }

  function deleteCard(id: string) {
    recordBeforeMutation();
    const targetIds = new Set([id, `card:${id}`]);
    cards.value = cards.value.filter((item) => item.id !== id);
    links.value = links.value.filter((link) => !targetIds.has(link.from) && !targetIds.has(link.to));
    selectedLinkTargets.value = selectedLinkTargets.value.filter((target) => !targetIds.has(target));
    markChanged();
  }

  function addPostIt() {
    recordBeforeMutation();
    const offset = postIts.value.length;
    postIts.value.push({
      id: String(postItSeed.value++),
      x: 30 + offset * 14,
      y: 26 + offset * 12,
      text: "",
    });
    markChanged();
  }

  function updatePostItText(id: string, text: string) {
    const note = postIts.value.find((item) => item.id === id);
    if (!note) return;
    note.text = text;
    markChanged();
  }

  function movePostItByDelta(id: string, dx: number, dy: number) {
    recordBeforeMutation();
    const note = postIts.value.find((item) => item.id === id);
    if (!note) return;
    note.x = Math.max(0, note.x + dx);
    note.y = Math.max(0, note.y + dy);
    markChanged();
  }

  function deletePostIt(id: string) {
    recordBeforeMutation();
    const targetId = `note:${id}`;
    postIts.value = postIts.value.filter((item) => item.id !== id);
    links.value = links.value.filter((link) => link.from !== targetId && link.to !== targetId);
    selectedLinkTargets.value = selectedLinkTargets.value.filter((target) => target !== targetId);
    markChanged();
  }

  function clearBoard() {
    recordBeforeMutation();
    cards.value = [];
    postIts.value = [];
    links.value = [];
    selectedLinkTargets.value = [];
    linkMode.value = false;
    cardSeed.value = 1;
    postItSeed.value = 1;
    linkSeed.value = 1;
    markChanged();
  }

  function setLinkMode(enabled: boolean) {
    linkMode.value = enabled;
    selectedLinkTargets.value = [];
  }

  function setLinkColor(color: string) {
    linkColor.value = color;
  }

  function addLink(from: string, to: string, color = linkColor.value) {
    recordBeforeMutation();
    links.value.push({
      id: String(linkSeed.value++),
      from,
      to,
      color,
    });
    markChanged();
  }

  function selectTargetForLink(targetId: string) {
    if (!linkMode.value) return;
    if (selectedLinkTargets.value.includes(targetId)) return;

    selectedLinkTargets.value.push(targetId);

    if (selectedLinkTargets.value.length === 2) {
      const [from, to] = selectedLinkTargets.value;
      addLink(from, to, linkColor.value);
      selectedLinkTargets.value = [];
    }
  }

  watch([cards, postIts, links], persist, { deep: true });

  return {
    cards,
    postIts,
    links,
    changeVersion,
    linkMode,
    linkColor,
    selectedLinkTargets,
    addCard,
    moveCardByDelta,
    deleteCard,
    addPostIt,
    updatePostItText,
    movePostItByDelta,
    deletePostIt,
    clearBoard,
    canUndo,
    canRedo,
    beginHistoryBatch,
    endHistoryBatch,
    undo,
    redo,
    setLinkMode,
    setLinkColor,
    addLink,
    selectTargetForLink,
    hydrateForHandle,
    exportBoard,
    loadExternalBoard,
    resetSessionState,
  };
});
