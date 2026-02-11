export default defineEventHandler(() => {
  return {
    status: "ok",
    service: "caseboard",
    timestamp: new Date().toISOString(),
  };
});
