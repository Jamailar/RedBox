import { defineConfig } from 'vite'
import path from 'node:path'
import fs from 'node:fs'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

// Custom plugin to copy prompt library files
function copyPromptLibrary() {
  return {
    name: 'copy-prompt-library',
    closeBundle: () => {
      const srcDir = path.resolve(__dirname, 'electron/prompts/library')
      const destDir = path.resolve(__dirname, 'dist-electron/library')

      if (fs.existsSync(srcDir)) {
        fs.cpSync(srcDir, destDir, { recursive: true })
        console.log(`[copy-prompt-library] Copied prompts from ${srcDir} to ${destDir}`)
      } else {
        console.warn(`[copy-prompt-library] Source directory not found: ${srcDir}`)
      }
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    copyPromptLibrary(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              // Keep native module external; bundle JS AI SDKs to avoid runtime missing deps in app.asar.
              external: ['better-sqlite3'],
            },
          },
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        input: 'electron/preload.ts',
      },
      // Ployfill the Electron and Node.js built-in modules for Renderer process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: {},
    }),
  ],
})
