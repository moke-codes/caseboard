import { useLocalStorage } from "@vueuse/core";
import { defineStore } from "pinia";
import { ref, watch } from "vue";
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

export const useBoardStore = defineStore("board", () => {
  const storage = useLocalStorage<Record<string, PersistedBoard>>("caseboard:boards", {});
  const activeHandle = ref("");

  const cards = ref<BoardCard[]>([]);
  const postIts = ref<PostIt[]>([]);
  const links = ref<ThreadLink[]>([]);

  const linkMode = ref(false);
  const linkColor = ref("#cc1f36");
  const selectedCardIds = ref<string[]>([]);

  const cardSeed = ref(1);
  const postItSeed = ref(1);
  const linkSeed = ref(1);

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
      return;
    }

    cards.value = saved.cards ?? [];
    postIts.value = saved.postIts ?? [];
    links.value = saved.links ?? [];
    cardSeed.value = saved.cardSeed ?? 1;
    postItSeed.value = saved.postItSeed ?? 1;
    linkSeed.value = saved.linkSeed ?? 1;
  }

  function resetSessionState() {
    activeHandle.value = "";
    cards.value = [];
    postIts.value = [];
    links.value = [];
    selectedCardIds.value = [];
    linkMode.value = false;
    cardSeed.value = 1;
    postItSeed.value = 1;
    linkSeed.value = 1;
  }

  function addCard(post: FeedPost, x: number, y: number) {
    cards.value.push({
      id: String(cardSeed.value++),
      post,
      x,
      y,
    });
  }

  function moveCardByDelta(id: string, dx: number, dy: number) {
    const card = cards.value.find((item) => item.id === id);
    if (!card) return;
    card.x = Math.max(0, card.x + dx);
    card.y = Math.max(0, card.y + dy);
  }

  function addPostIt() {
    const offset = postIts.value.length;
    postIts.value.push({
      id: String(postItSeed.value++),
      x: 30 + offset * 14,
      y: 26 + offset * 12,
      text: "",
    });
  }

  function updatePostItText(id: string, text: string) {
    const note = postIts.value.find((item) => item.id === id);
    if (!note) return;
    note.text = text;
  }

  function movePostItByDelta(id: string, dx: number, dy: number) {
    const note = postIts.value.find((item) => item.id === id);
    if (!note) return;
    note.x = Math.max(0, note.x + dx);
    note.y = Math.max(0, note.y + dy);
  }

  function setLinkMode(enabled: boolean) {
    linkMode.value = enabled;
    selectedCardIds.value = [];
  }

  function setLinkColor(color: string) {
    linkColor.value = color;
  }

  function selectCardForLink(cardId: string) {
    if (!linkMode.value) return;
    if (selectedCardIds.value.includes(cardId)) return;

    selectedCardIds.value.push(cardId);

    if (selectedCardIds.value.length === 2) {
      const [from, to] = selectedCardIds.value;
      links.value.push({
        id: String(linkSeed.value++),
        from,
        to,
        color: linkColor.value,
      });
      selectedCardIds.value = [];
    }
  }

  watch([cards, postIts, links], persist, { deep: true });

  return {
    cards,
    postIts,
    links,
    linkMode,
    linkColor,
    selectedCardIds,
    addCard,
    moveCardByDelta,
    addPostIt,
    updatePostItText,
    movePostItByDelta,
    setLinkMode,
    setLinkColor,
    selectCardForLink,
    hydrateForHandle,
    resetSessionState,
  };
});
