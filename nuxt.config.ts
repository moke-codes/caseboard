import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const keyPath = resolve(__dirname, "certs/key.pem");
const certPath = resolve(__dirname, "certs/cert.pem");

export default defineNuxtConfig({
  modules: ["@pinia/nuxt"],
  css: ["~/assets/css/main.css"],
  devtools: { enabled: true },
  devServer: {
    https: {
      key: readFileSync(keyPath, "utf8"),
      cert: readFileSync(certPath, "utf8"),
    },
  },
  vite: {
    server: {
      https: {
        key: readFileSync(keyPath, "utf8"),
        cert: readFileSync(certPath, "utf8"),
      },
    },
  },
  nitro: {
    devServer: {
      https: {
        key: readFileSync(keyPath, "utf8"),
        cert: readFileSync(certPath, "utf8"),
      },
    },
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
