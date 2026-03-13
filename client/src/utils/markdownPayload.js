import TurndownService from "turndown";
import { marked } from "marked";

const turndown = new TurndownService({ headingStyle: "atx" });

// TipTap wraps list item content in <p> tags: <li><p>text</p></li>
// By default Turndown treats <p> as block, creating empty bullets with text below.
// This rule makes <li> handle its content inline so bullets render correctly.
turndown.addRule("listItemParagraph", {
  filter: (node) => node.nodeName === "LI",
  replacement: (content, node) => {
    // Remove leading/trailing newlines that come from nested <p> tags
    let text = content.replace(/^\n+/, "").replace(/\n+$/, "");
    // Collapse multiple newlines into one (for multi-paragraph items)
    text = text.replace(/\n{2,}/g, "\n");
    const parent = node.parentNode;
    const prefix = parent && parent.nodeName === "OL" ? "1. " : "* ";
    return prefix + text + "\n";
  },
});

/**
 * Converts HTML to Markdown. Used when sending item description to Payload so
 * the proposal view renders formatted content instead of raw HTML.
 */
export function htmlToMarkdown(html) {
  if (html == null || String(html).trim() === "") return "";
  try {
    return turndown.turndown(String(html)).trim();
  } catch {
    return String(html).trim();
  }
}

/**
 * Converts Markdown to HTML for the rich text editor (TipTap expects HTML).
 */
export function markdownToHtml(md) {
  if (md == null || String(md).trim() === "") return "";
  try {
    return marked.parse(String(md).trim(), { async: false });
  } catch {
    return String(md).trim();
  }
}

/**
 * Heuristic: treat content as HTML when it looks like tags (e.g. from legacy or
 * from Payload storing HTML). Otherwise treat as Markdown.
 */
export function looksLikeHtml(str) {
  if (str == null || typeof str !== "string") return false;
  const t = str.trim();
  if (t === "") return false;
  return t.startsWith("<") && (t.includes("</") || t.includes("/>") || />/.test(t));
}
