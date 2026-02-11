import { getShareRecord, resolveRole } from "~/server/utils/sharedBoards";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  const token = getQuery(event).token;

  if (!id || typeof token !== "string" || !token) {
    throw createError({ statusCode: 400, statusMessage: "Missing share identifier or token." });
  }

  const record = await getShareRecord(id);
  if (!record) {
    throw createError({ statusCode: 404, statusMessage: "Shared board not found." });
  }

  const role = resolveRole(record, token);
  if (!role) {
    throw createError({ statusCode: 403, statusMessage: "Invalid share token." });
  }

  return {
    board: record.board,
    role,
    updatedAt: record.updatedAt,
    revision: Number(record.revision ?? 1),
  };
});
