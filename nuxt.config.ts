export default defineNuxtConfig({
  modules: ["@pinia/nuxt"],
  css: ["~/assets/css/main.css"],
  devtools: { enabled: true },
  typescript: {
    strict: true,
    typeCheck: false,
  },
});
