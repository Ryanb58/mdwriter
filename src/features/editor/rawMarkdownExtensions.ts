import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete"
import { indentWithTab } from "@codemirror/commands"
import { cssLanguage } from "@codemirror/lang-css"
import { htmlLanguage } from "@codemirror/lang-html"
import { javascriptLanguage, jsxLanguage, tsxLanguage, typescriptLanguage } from "@codemirror/lang-javascript"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { bracketMatching, HighlightStyle, indentUnit, syntaxHighlighting, type Language } from "@codemirror/language"
import { EditorState, type Extension } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"
import { tags } from "@lezer/highlight"

// These grammars are already shipped transitively by lang-markdown. Keep the
// raw editor lightweight rather than loading a second all-language registry.
const fenceLanguages: Record<string, Language> = {
  js: javascriptLanguage,
  javascript: javascriptLanguage,
  mjs: javascriptLanguage,
  cjs: javascriptLanguage,
  jsx: jsxLanguage,
  ts: typescriptLanguage,
  typescript: typescriptLanguage,
  tsx: tsxLanguage,
  css: cssLanguage,
  html: htmlLanguage,
  htm: htmlLanguage,
}

export function rawCodeLanguage(info: string): Language | null {
  const name = info.trim().split(/\s+/, 1)[0].toLowerCase()
  return Object.hasOwn(fenceLanguages, name) ? fenceLanguages[name] : null
}

// Stable classes keep both palettes in App.css and leave editor layout,
// selection, Find highlights and wikilink decorations in charge of themselves.
export const rawMarkdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, class: "cm-syntax-heading" },
  { tag: tags.strong, class: "cm-syntax-strong" },
  { tag: tags.emphasis, class: "cm-syntax-emphasis" },
  { tag: tags.strikethrough, class: "cm-syntax-strikethrough" },
  { tag: [tags.link, tags.url], class: "cm-syntax-link" },
  { tag: tags.monospace, class: "cm-syntax-code" },
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.comment, tags.quote], class: "cm-syntax-muted" },
  { tag: [tags.keyword, tags.tagName, tags.labelName], class: "cm-syntax-keyword" },
  { tag: [tags.string, tags.number, tags.bool, tags.atom, tags.attributeValue], class: "cm-syntax-literal" },
  { tag: [tags.propertyName, tags.attributeName, tags.typeName], class: "cm-syntax-property" },
])

/** Install before the generic keymap so paired Backspace wins over deletion. */
export function rawMarkdownExtensions(): Extension {
  return [
    markdown({ base: markdownLanguage, codeLanguages: rawCodeLanguage }),
    syntaxHighlighting(rawMarkdownHighlightStyle),
    // Four spaces are a Markdown code-block unit and nest both bullet and
    // numbered lists. Indent whole lines, never replace a selected passage or
    // reformat Markdown with a code-language indentation heuristic.
    indentUnit.of("    "),
    EditorState.tabSize.of(4),
    keymap.of([...closeBracketsKeymap, indentWithTab]),
    // Don't pair quotes/apostrophes or backticks in prose. Fenced languages
    // retain their own language-specific bracket configuration.
    markdownLanguage.data.of({ closeBrackets: { brackets: ["(", "[", "{"] } }),
    closeBrackets(),
    bracketMatching(),
    EditorView.contentAttributes.of({
      "aria-label": "Raw Markdown editor",
      "aria-description": "Tab indents; Shift+Tab outdents. Press Escape then Tab to move focus out of the editor.",
    }),
  ]
}
