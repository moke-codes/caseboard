type EnvMap = Record<string, string | undefined>;

const env = ((globalThis as { process?: { env?: EnvMap } }).process?.env ?? {}) as EnvMap;
const isProduction = env.NODE_ENV === "production";
const isTypecheckRun =
  env.npm_lifecycle_event === "typecheck" ||
  (Array.isArray((globalThis as { process?: { argv?: unknown[] } }).process?.argv) &&
    ((globalThis as { process?: { argv?: unknown[] } }).process?.argv as unknown[]).some(
      (arg) => typeof arg === "string" && arg.includes("typecheck"),
    ));

const httpsKey = env.NUXT_HTTPS_KEY;
const httpsCert = env.NUXT_HTTPS_CERT;
const hasHttpsCerts = Boolean(httpsKey && httpsCert);

if (isProduction && !isTypecheckRun && !hasHttpsCerts) {
  throw new Error(
    "Production requires TLS certs via NUXT_HTTPS_KEY and NUXT_HTTPS_CERT environment variables.",
  );
}

const httpsConfig = hasHttpsCerts
  ? {
      key: httpsKey as string,
      cert: httpsCert as string,
    }
  : undefined;

export default defineNuxtConfig({
  modules: ["@pinia/nuxt"],
  css: ["~/assets/css/main.css"],
  devtools: { enabled: true },
  devServer: httpsConfig
    ? {
        https: httpsConfig,
      }
    : undefined,
  vite: {
    server: httpsConfig
      ? {
          https: httpsConfig,
        }
      : undefined,
  },
  nitro: {
    storage: {
      data: {
        driver: "fs",
        base: "./.data/storage",
      },
    },
  },
  typescript: {
    strict: true,
    typeCheck: false,
  },
});
