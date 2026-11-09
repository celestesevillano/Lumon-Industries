import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// SHA de 7 chars del commit desplegado. En Vercel viene en VERCEL_GIT_COMMIT_SHA;
// en Netlify COMMIT_REF; en Cloudflare Pages CF_PAGES_COMMIT_SHA. En local = "dev".
const sha =
  process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.COMMIT_REF ?? process.env.CF_PAGES_COMMIT_SHA
const build = sha ? sha.slice(0, 7) : 'dev'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __LUMON_BUILD__: JSON.stringify(build) },
})
