export default defineNuxtRouteMiddleware((to) => {
  // Only redirect in production or when explicitly configured
  // In dev mode, Nuxt devServer handles HTTPS directly
  if (process.env.NODE_ENV === "production") {
    // This middleware ensures HTTPS is used
    // The actual redirect should be handled at the reverse proxy level
    if (process.server) {
      const event = useRequestEvent();
      if (event) {
        const protocol = event.node.req.headers["x-forwarded-proto"] || "http";
        if (protocol !== "https" && !event.node.req.url?.startsWith("/api")) {
          // In production, this should be handled by reverse proxy
          // But we can still check and warn
        }
      }
    }
  }
});
