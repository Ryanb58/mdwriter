import { describe, expect, it } from "vitest"
import { detectMarkdownRisks, type MarkdownRiskCode } from "../markdownRisks"

function codes(markdown: string): MarkdownRiskCode[] {
  return detectMarkdownRisks(markdown).map((risk) => risk.code)
}

describe("detectMarkdownRisks", () => {
  const positiveCases: Array<{
    name: string
    markdown: string
    expected: MarkdownRiskCode[]
  }> = [
    {
      name: "HTML comments",
      markdown: "Visible <!-- preserve this --> text",
      expected: ["html-comment"],
    },
    {
      name: "footnote references and definitions",
      markdown: "A claim[^source].\n\n[^source]: Supporting text.",
      expected: ["footnote"],
    },
    {
      name: "reference definitions",
      markdown: "[guide]: https://example.com/docs\n\nRead [the guide][guide].",
      expected: ["reference-definition"],
    },
    {
      name: "link titles",
      markdown: "[Docs](https://example.com \"Reference\")",
      expected: ["link-title"],
    },
    {
      name: "image titles",
      markdown: "![Diagram](diagram.png 'Architecture')",
      expected: ["link-title"],
    },
    {
      name: "JSX and MDX expressions",
      markdown: "<Callout kind={variant}>{message}</Callout>",
      expected: ["mdx"],
    },
    {
      name: "raw HTML blocks",
      markdown: "<div>\n  <p>Preserve this block</p>\n</div>",
      expected: ["raw-html"],
    },
    {
      name: "inline HTML",
      markdown: "Press <kbd>Enter</kbd> to continue.",
      expected: ["inline-html"],
    },
    {
      name: "display math",
      markdown: "$$\nx^2 + y^2 = z^2\n$$",
      expected: ["math"],
    },
    {
      name: "math fences",
      markdown: "```math\nx^2\n```",
      expected: ["math"],
    },
    {
      name: "directives",
      markdown: ":::warning\nPreserve this container.\n:::",
      expected: ["directive"],
    },
    {
      name: "table alignment markers",
      markdown: "| Left | Right |\n| :--- | ---: |\n| A | B |",
      expected: ["table-alignment"],
    },
    {
      name: "code-fence metadata",
      markdown: "```ts {1,3} title=\"example.ts\"\nconst value = 1\n```",
      expected: ["code-fence-metadata"],
    },
    {
      name: "multi-paragraph blockquotes",
      markdown: "> First paragraph.\n>\n> Second paragraph.",
      expected: ["multi-paragraph-quote"],
    },
    {
      name: "an unmatched leading frontmatter fence",
      markdown: "---\ntitle: Never closed\n\nDocument text",
      expected: ["ambiguous-frontmatter"],
    },
  ]

  for (const { name, markdown, expected } of positiveCases) {
    it(`detects ${name}`, () => {
      expect(codes(markdown)).toEqual(expected)
    })
  }

  it("deduplicates risks and returns them in declaration order", () => {
    const markdown = [
      "| A | B |",
      "| :--- | ---: |",
      "",
      "Second comment: <!-- two -->",
      "First comment: <!-- one -->",
      "",
      "[^a]: first footnote",
      "[^b]: second footnote",
      "",
      ":::note",
      "content",
      ":::",
    ].join("\n")

    expect(codes(markdown)).toEqual([
      "html-comment",
      "footnote",
      "directive",
      "table-alignment",
    ])
    expect(detectMarkdownRisks(markdown).every((risk) => risk.label.length > 0)).toBe(true)
  })

  it("ignores risky-looking syntax inside fenced code", () => {
    const markdown = [
      "````markdown",
      "<!-- comment -->",
      "[^note]: footnote",
      "[ref]: https://example.com",
      "[link](url \"title\")",
      "<Widget>{value}</Widget>",
      "<div>raw</div>",
      "text <em>inline</em>",
      "$$",
      ":::note",
      "| :--- | ---: |",
      "```js {1}",
      "> first",
      ">",
      "> second",
      "````",
    ].join("\n")

    expect(codes(markdown)).toEqual([])
  })

  it("ignores risky-looking syntax inside tilde-fenced and indented code", () => {
    const markdown = [
      "~~~text",
      "<!-- fenced -->",
      "~~~",
      "",
      "    <!-- indented -->",
      "    [^note]: footnote",
      "    <div>raw</div>",
      "    :::note",
      "    | :--- |",
      "    > first",
      "    >",
      "    > second",
    ].join("\n")

    expect(codes(markdown)).toEqual([])
  })

  it("ignores risky-looking syntax inside variable-length inline code spans", () => {
    const markdown = [
      "`<!-- comment -->`",
      "``code with ` and [^note] and <span>HTML</span>``",
      "```[link](url \"title\") and {mdx} and $$```",
    ].join("\n")

    expect(codes(markdown)).toEqual([])
  })

  it("ignores escaped syntax", () => {
    const markdown = [
      "\\<!-- comment -->",
      "\\[^note]: footnote",
      "\\[ref]: https://example.com",
      "\\[link](url \"title\")",
      "\\<Widget /> and \\{expression}",
      "\\<div>raw</div>",
      "\\$\\$",
      "\\:::note",
      "| \\:--- | --- |",
      "\\```js {1}",
      "\\> first",
      "\\>",
      "\\> second",
    ].join("\n")

    expect(codes(markdown)).toEqual([])
  })

  it("keeps conservative ordinary Markdown safe", () => {
    const markdown = [
      "That costs $5, or $10 for two.",
      "Use a < b and 3 > 2 in prose.",
      "<https://example.com/path?q=1>",
      "<person@example.com>",
      "",
      "> One paragraph",
      "> continued on the next quoted line.",
      "",
      "```typescript",
      "const answer = 42",
      "```",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| A | B |",
      "",
      "---",
      "title: Closed frontmatter",
      "---",
      "Body",
    ].join("\n")

    expect(codes(markdown)).toEqual([])
  })

  it("normalizes CRLF and CR line endings for scanning", () => {
    expect(codes("> first\r\n>\r\n> second")).toEqual(["multi-paragraph-quote"])
    expect(codes(":::note\rcontent\r:::")).toEqual(["directive"])
  })

  it("keeps scanning after a void raw HTML block", () => {
    expect(codes("<hr>\n\nA claim[^source].")).toEqual(["footnote", "raw-html"])
  })

  it("ends an unclosed raw HTML block at the next blank line", () => {
    expect(codes("<div>\nraw HTML\n\nA claim[^source].")).toEqual([
      "footnote",
      "raw-html",
    ])
  })

  it("detects directive fences longer than three colons", () => {
    expect(codes("::::tabs\ncontent\n::::")).toEqual(["directive"])
  })

  it("continues detecting named syntax inside raw HTML blocks", () => {
    expect(
      codes("<div>\n<!-- preserve -->\nA claim[^source].\n</div>"),
    ).toEqual(["html-comment", "footnote", "raw-html"])
  })

  it.each([
    "<script>const value = 1</script>",
    "<style>.note { color: red }</style>",
    "<pre>literal</pre>",
    "<textarea>literal</textarea>",
    "<!DOCTYPE html>",
    "<?xml version=\"1.0\"?>",
    "<![CDATA[literal]]>",
    "</div>",
  ])("recognizes canonical raw HTML block form %#", (markdown) => {
    expect(codes(markdown)).toEqual(["raw-html"])
  })

  it.each([
    "{2 + 2}",
    "{/* preserve this expression comment */}",
    "{condition ? { nested: true } : fallback}",
    "{\n  value + 1\n}",
    'import Widget from "./Widget.js"',
    "export const answer = 42",
  ])("detects MDX expression or ESM form %#", (markdown) => {
    expect(codes(markdown)).toEqual(["mdx"])
  })

  it("ignores risky-looking syntax inside a blockquoted code fence", () => {
    expect(codes(["> ```html", "> <em>not HTML here</em>", "> ```"].join("\n"))).toEqual(
      [],
    )
  })

  it("requires a column-zero frontmatter opener", () => {
    expect(codes("    ---\n    title: indented code")).toEqual([])
  })

  it("does not accept a protected code fence line as a frontmatter closer", () => {
    expect(
      codes(["---", "title: Still open", "```yaml", "---", "```", "Body"].join("\n")),
    ).toEqual(["ambiguous-frontmatter"])
  })

  it("detects compact display math", () => {
    expect(codes("The result is $$x^2$$.")).toEqual(["math"])
  })

  it("detects backslash-delimited display math", () => {
    expect(codes("\\[\nx^2 + y^2\n\\]")).toEqual(["math"])
  })

  it("does not mistake escaped or ordinary bracket text for display math", () => {
    expect(codes("\\\\[\nx^2 + y^2\n\\\\]")).toEqual([])
    expect(codes("\\[ordinary bracket text]")).toEqual([])
  })

  it("detects a link title after a balanced-parenthesis destination", () => {
    expect(codes('[Docs](https://example.test/a_(b) "Reference")')).toEqual([
      "link-title",
    ])
  })

  it.each([
    "before <div>after</div>",
    "before <table><tr><td>after</td></tr></table>",
  ])("treats block-tag HTML in the middle of prose as inline HTML: %#", (markdown) => {
    expect(codes(markdown)).toEqual(["inline-html"])
  })

  it("detects a link title separated from its destination by a line ending", () => {
    expect(codes('[Docs](https://example.test/docs\n  "Reference")')).toEqual([
      "link-title",
    ])
  })

  it("detects a link title after a nested-bracket label", () => {
    expect(codes('[outer [inner]](/docs "Title")')).toEqual(["link-title"])
  })
})
