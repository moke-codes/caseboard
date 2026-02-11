/**
 * @typedef {{
 *   id: string
 *   board: unknown
 *   viewToken: string
 *   editToken: string
 *   createdAt: string
 *   updatedAt: string
 *   revision: number
 * }} SharedBoardRecordLike
 */

/**
 * @param {string | undefined} value
 * @returns {number}
 */
export function recordTimestamp(value) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * @param {SharedBoardRecordLike} next
 * @param {SharedBoardRecordLike | null} current
 * @returns {boolean}
 */
export function isRecordNewer(next, current) {
  if (!current) return true;
  const nextRevision = Number(next.revision ?? 0);
  const currentRevision = Number(current.revision ?? 0);
  if (nextRevision !== currentRevision) return nextRevision > currentRevision;
  const nextUpdatedAt = recordTimestamp(next.updatedAt);
  const currentUpdatedAt = recordTimestamp(current.updatedAt);
  return nextUpdatedAt > currentUpdatedAt;
}

/**
 * @template T
 * @param {(T | null | undefined)[]} records
 * @param {(next: T, current: T | null) => boolean} isNewer
 * @returns {T | null}
 */
export function selectNewestRecord(records, isNewer) {
  let newest = null;
  for (const record of records) {
    if (!record) continue;
    if (isNewer(record, newest)) newest = record;
  }
  return newest;
}

/**
 * @template TBoard
 * @param {SharedBoardRecordLike} base
 * @param {TBoard} board
 * @param {string} nowIso
 * @returns {SharedBoardRecordLike & { board: TBoard }}
 */
export function buildNextSharedRecord(base, board, nowIso) {
  return {
    ...base,
    board,
    updatedAt: nowIso,
    revision: Math.max(1, Number(base.revision ?? 0)) + 1,
  };
}
