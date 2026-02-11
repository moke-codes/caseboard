export default defineEventHandler((event) => {
  // Force HTTPS - redirect HTTP to HTTPS
  const isSecure = event.node.req.socket?.encrypted || 
                   event.node.req.headers["x-forwarded-proto"] === "https";
  
  if (!isSecure) {
    const host = event.node.req.headers.host || "localhost";
    const url = event.node.req.url || "/";
    return sendRedirect(event, `https://${host}${url}`, 301);
  }
});
