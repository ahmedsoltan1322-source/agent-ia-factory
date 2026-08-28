import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const isGitHubPages = mode === 'pages'
  const basePath = isGitHubPages ? '/agent-ia-factory/' : '/'

  return {
    base: basePath,
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'Agent IA Factory',
          short_name: 'Agent Factory',
          description: 'مصنع وكلاء الذكاء الاصطناعي — Mobile-First وZero-Cost-First',
          lang: 'ar',
          dir: 'rtl',
          display: 'standalone',
          start_url: basePath,
          scope: basePath,
          background_color: '#0b1020',
          theme_color: '#0b1020',
          icons: [
            {
              src: `${basePath}icon.svg`,
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any maskable'
            }
          ]
        },
        workbox: {
          // Keep heavyweight AI/runtime WASM outside the install-time PWA
          // precache. Local AI downloads must remain explicit and user-driven.
          globIgnores: ['**/*.wasm'],
        }
      })
    ],
    build: {
      target: 'es2022'
    }
  }
})
