import type { PersistedBoard } from "~/types/caseboard";
import { getShareRecord, resolveRole, updateSharedBoard } from "~/server/utils/sharedBoards";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  const body = await readBody<{ token?: string; board?: PersistedBoard }>(event);

  if (!id || !body?.token || !body.board) {
    throw createError({ statusCode: 400, statusMessage: "Missing share id, token, or board payload." });
  }

  const record = await getShareRecord(id);
  if (!record) {
    throw createError({ statusCode: 404, statusMessage: "Shared board not found." });
  }

  const role = resolveRole(record, body.token);
  if (role !== "edit") {
    throw createError({ statusCode: 403, statusMessage: "Editor access required." });
  }

  const updated = await updateSharedBoard(record, body.board);

  return {
    ok: true,
    updatedAt: updated.updatedAt,
    revision: Number(updated.revision ?? 1),
  };
});
