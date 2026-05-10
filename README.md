# mdwriter

A fast, lightweight desktop markdown editor. Block editor with a Properties pane for YAML frontmatter, a left file tree with create/rename/delete, fuzzy file palette (Cmd+P), raw markdown toggle (Cmd+E), and external file watching.

Built with Tauri 2, React, TypeScript, BlockNote, and CodeMirror.

## Develop

    pnpm install
    pnpm tauri dev

## Test

    pnpm test          # frontend unit
    cargo test --manifest-path src-tauri/Cargo.toml --lib
    pnpm test:e2e      # smoke

## Build

    pnpm tauri build

See `docs/superpowers/specs/2026-05-09-mdwriter-design.md` for the design and `docs/superpowers/plans/2026-05-09-mdwriter.md` for the implementation plan.
