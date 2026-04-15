import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 3000,
    // Exclude the mermaid chunk from <link rel="modulepreload"> injection.
    // Mermaid is loaded lazily (dynamic import) only when a page contains
    // mermaid code blocks — preloading it on every page load would negate
    // the lazy-loading benefit and add 715 KB (gzip) to the critical path.
    modulePreload: {
      resolveDependencies(_filename, deps, _context) {
        return deps.filter((dep) => !dep.includes('mermaid'));
      },
    },
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/mermaid/') || id.includes('node_modules/@mermaid-js/')) {
            return 'mermaid';
          }
          if (id.includes('node_modules/highlight.js/')) {
            return 'hljs';
          }
          if (id.includes('node_modules/katex/')) {
            return 'katex';
          }
        },
      },
    },
  },
});
