import DOMPurify from "dompurify";
import { marked } from "marked";

// Links in the preview open in a new tab, so that a click does not leave the board (and unsaved text).
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.hasAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

/** Markdown to safe HTML: marked, then DOMPurify (plan step 11). */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false, gfm: true });
  return DOMPurify.sanitize(html);
}
