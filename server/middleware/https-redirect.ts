export default defineEventHandler((event) => {
  if (import.meta.dev) return;

  const req = event.node.req;
  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const isSecure = Boolean(req.socket?.encrypted) || proto === "https";

  if (isSecure) return;

  const host = req.headers.host || "localhost";
  const url = req.url || "/";
  return sendRedirect(event, `https://${host}${url}`, 301);
});
