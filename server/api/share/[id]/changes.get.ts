import { getShareRecord, resolveRole, waitForShareRevision } from "~/server/utils/sharedBoards";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  const query = getQuery(event);
  const token = query.token;
  const since = Number(query.since ?? 0);

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

  const currentRevision = Number(record.revision ?? 1);
  if (currentRevision > since) {
    return {
      changed: true,
      role,
      board: record.board,
      updatedAt: record.updatedAt,
      revision: currentRevision,
    };
  }

  await waitForShareRevision(id, since, 20000);
  const refreshed = await getShareRecord(id);
  if (!refreshed) {
    throw createError({ statusCode: 404, statusMessage: "Shared board not found." });
  }

  const nextRole = resolveRole(refreshed, token);
  if (!nextRole) {
    throw createError({ statusCode: 403, statusMessage: "Invalid share token." });
  }

  const nextRevision = Number(refreshed.revision ?? 1);
  if (nextRevision <= since) {
    return {
      changed: false,
      role: nextRole,
      revision: nextRevision,
      updatedAt: refreshed.updatedAt,
    };
  }

  return {
    changed: true,
    role: nextRole,
    board: refreshed.board,
    updatedAt: refreshed.updatedAt,
    revision: nextRevision,
  };
});
