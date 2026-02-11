import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNextSharedRecord,
  isRecordNewer,
  recordTimestamp,
  selectNewestRecord,
} from "../server/utils/sharedBoardsCore.mjs";

test("recordTimestamp handles invalid and valid timestamps", () => {
  assert.equal(recordTimestamp(undefined), 0);
  assert.equal(recordTimestamp("not-a-date"), 0);
  assert.equal(recordTimestamp("2026-02-11T08:00:00.000Z"), 1770796800000);
});

test("isRecordNewer prioritizes higher revision", () => {
  const current = { revision: 3, updatedAt: "2026-02-11T08:00:00.000Z" };
  const next = { revision: 4, updatedAt: "2026-01-01T00:00:00.000Z" };
  assert.equal(isRecordNewer(next, current), true);
});

test("isRecordNewer uses updatedAt when revisions tie", () => {
  const current = { revision: 4, updatedAt: "2026-02-11T08:00:00.000Z" };
  const next = { revision: 4, updatedAt: "2026-02-11T08:10:00.000Z" };
  assert.equal(isRecordNewer(next, current), true);
});

test("selectNewestRecord picks newest by comparator", () => {
  const records = [
    null,
    { id: "a", revision: 1, updatedAt: "2026-02-11T08:00:00.000Z" },
    { id: "b", revision: 2, updatedAt: "2026-02-11T08:01:00.000Z" },
    { id: "c", revision: 2, updatedAt: "2026-02-11T08:02:00.000Z" },
  ];
  const newest = selectNewestRecord(records, isRecordNewer);
  assert.equal(newest?.id, "c");
});

test("buildNextSharedRecord increments revision and updates board and timestamp", () => {
  const base = {
    id: "id-1",
    board: { cards: [] },
    viewToken: "view",
    editToken: "edit",
    createdAt: "2026-02-11T08:00:00.000Z",
    updatedAt: "2026-02-11T08:00:00.000Z",
    revision: 7,
  };
  const board = { cards: [{ id: "1" }] };
  const next = buildNextSharedRecord(base, board, "2026-02-11T08:05:00.000Z");

  assert.equal(next.revision, 8);
  assert.equal(next.updatedAt, "2026-02-11T08:05:00.000Z");
  assert.deepEqual(next.board, board);
});
