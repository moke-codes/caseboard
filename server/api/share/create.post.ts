import type { PersistedBoard } from "~/types/caseboard";
import { createShareRecord, saveShareRecord } from "~/server/utils/sharedBoards";

export default defineEventHandler(async (event) => {
  const body = await readBody<{ board?: PersistedBoard }>(event);
  if (!body?.board) {
    throw createError({ statusCode: 400, statusMessage: "Missing board payload." });
  }

  const created = createShareRecord(body.board);
  await saveShareRecord(created.record);

  return {
    id: created.id,
    viewToken: created.viewToken,
    editToken: created.editToken,
  };
});
