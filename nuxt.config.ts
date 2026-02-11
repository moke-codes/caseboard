export default defineNuxtConfig({
  modules: ["@pinia/nuxt"],
  css: ["~/assets/css/main.css"],
  devtools: { enabled: true },
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
