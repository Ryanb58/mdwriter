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
          // Vite's virtual preload helper is shared by every chunk that uses
          // dynamic import. Pin it to the static vendor chunk — colocated
          // into editor-vendor it gives the entry a static dependency on
          // the 5.5 MB chunk.
          if (id.includes("vite/preload-helper")) return "vendor";
          if (!id.includes("node_modules")) return;
          // React is shared by the entry AND the lazy editor chunk. Without
          // an explicit assignment Rollup colocates it into editor-vendor,
          // which would make the entry statically import the 5.7 MB chunk
          // again — putting it right back on the first-paint critical path.
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/scheduler/")
          ) {
            return "react-vendor";
          }
          // Editor + assistant markdown rendering share enough transitive
          // deps (mdast / micromark / unist) that splitting them creates a
          // circular vendor chunk warning. Keep them together — both are
          // needed in the same UI session anyway. The list includes their
          // distinctive transitive deps (tiptap, mantine, shiki's oniguruma
          // engine, hast/vfile plumbing) so the bulk of editor-only code
          // stays out of the startup-critical chunks.
          if (
            id.includes("@blocknote") ||
            id.includes("@codemirror") ||
            id.includes("@lezer") ||
            id.includes("prosemirror") ||
            id.includes("@shikijs") ||
            id.includes("/shiki/") ||
            id.includes("yjs") ||
            id.includes("react-markdown") ||
            id.includes("remark-") ||
            id.includes("rehype-") ||
            id.includes("highlight.js") ||
            id.includes("micromark") ||
            id.includes("mdast-") ||
            id.includes("hast-") ||
            id.includes("unist-") ||
            id.includes("unified") ||
            id.includes("@tiptap") ||
            id.includes("@mantine") ||
            id.includes("@tanstack") ||
            id.includes("react-icons") ||
            id.includes("oniguruma") ||
            id.includes("/regex") ||
            id.includes("lowlight") ||
            id.includes("hastscript") ||
            id.includes("/vfile") ||
            id.includes("parse5") ||
            id.includes("/entities/") ||
            id.includes("orderedmap") ||
            id.includes("rope-sequence") ||
            id.includes("w3c-keyname") ||
            id.includes("/lib0/")
          ) {
            return "editor-vendor";
          }
          // NB: deliberately NOT matched into editor-vendor: @floating-ui,
          // react-remove-scroll, tabbable, use-sidecar etc. — cmdk/radix in
          // the static vendor chunk share them, and a static chunk importing
          // from editor-vendor would force the 5.5 MB chunk onto startup.
          // Everything else (zustand, cmdk, phosphor icons, tauri API,
          // shared micro-utils like clsx / tslib / use-sync-external-store)
          // is explicitly pinned to a static vendor chunk. Leaving them
          // unassigned lets Rollup colocate shared modules into
          // editor-vendor, which would put a static entry → editor-vendor
          // edge right back on the first-paint critical path.
          return "vendor";
        },
      },
    },
    // editor-vendor lands ~5.7 MB raw / ~1.1 MB gzipped (BlockNote +
    // CodeMirror + ProseMirror + Shiki precompiled grammars for ~50
    // languages via @blocknote/code-block). That's the floor — the
    // grammars dominate. Raise the limit so the warning isn't noise.
    chunkSizeWarningLimit: 6000,
  },
}));
