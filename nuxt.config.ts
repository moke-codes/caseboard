type EnvMap = Record<string, string | undefined>;

const env = ((globalThis as { process?: { env?: EnvMap } }).process?.env ?? {}) as EnvMap;
const httpsKey = env.NUXT_HTTPS_KEY;
const httpsCert = env.NUXT_HTTPS_CERT;
const hasHttpsCerts = Boolean(httpsKey && httpsCert);

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
