import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  // Relative, so the built site works from any path it's served under.
  base: './',
  plugins: [svelte()],
  build: {
    rolldownOptions: {
      output: {
        // three.js core in its own chunk, so its hash (and browser cache)
        // only changes when the dependency does, not with every app release.
        codeSplitting: {
          groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]build[\\/]/ }],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
})
