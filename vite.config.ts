import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  build: {
    // Split heavy editor vendors into their own chunk so app code can be cached
    // independently across updates. BlockNote pulls in CodeMirror for fenced
    // code blocks, so they live in the same chunk to avoid circular deps.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (
            id.includes("@blocknote") ||
            id.includes("@codemirror") ||
            id.includes("@lezer") ||
            id.includes("prosemirror") ||
            id.includes("yjs")
          ) {
            return "editor-vendor";
          }
          if (
            id.includes("react-markdown") ||
            id.includes("remark-") ||
            id.includes("rehype-") ||
            id.includes("highlight.js") ||
            id.includes("micromark") ||
            id.includes("mdast-") ||
            id.includes("hast-")
          ) {
            return "markdown-vendor";
          }
        },
      },
    },
    // editor-vendor lands ~2 MB (BlockNote + CodeMirror + ProseMirror); that's
    // the floor for a block + raw markdown editor. Raise the limit so the
    // warning isn't noise on every build.
    chunkSizeWarningLimit: 2500,
  },
}));
