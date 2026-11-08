import { articleHeadingEntries } from "../../lib/blog/headings";
import { resolveImageSource } from "../../lib/media/isolated-images";
import { createElement, type ReactNode } from "react";
import { validateArticleBody, validateSupplementalLinks } from "../../lib/blog/content";
import type {
  ArticleBody as ArticleBodyInput,
  EditorMark,
  EditorNode,
  SupplementalLink,
} from "../../lib/blog/types";

function renderMarks(content: ReactNode, marks: EditorMark[] = []): ReactNode {
  return marks.reduce<ReactNode>((child, mark) => {
    if (mark.type === "link")
      return (
        <a
          href={mark.attrs.href}
          target={mark.attrs.target ?? undefined}
          title={mark.attrs.title ?? undefined}
          rel="noopener noreferrer"
        >
          {child}
        </a>
      );
    const tags = {
      bold: "strong",
      italic: "em",
      strike: "s",
      underline: "u",
      code: "code",
    } as const;
    return createElement(tags[mark.type], null, child);
  }, content);
}

function renderNode(node: EditorNode, key: string, headingIds: Map<EditorNode, string>): ReactNode {
  if (node.type === "text") return <span key={key}>{renderMarks(node.text, node.marks)}</span>;
  if (node.type === "hardBreak") return <span key={key}>{renderMarks(<br />, node.marks)}</span>;
  if (node.type === "image")
    return (
      <img
        key={key}
        src={resolveImageSource(node.attrs.src)}
        alt={node.attrs.alt ?? ""}
        title={node.attrs.title ?? undefined}
        width={node.attrs.width ?? undefined}
        height={node.attrs.height ?? undefined}
        loading="lazy"
      />
    );
  if (node.type === "horizontalRule") return <hr key={key} />;
  const children = node.content?.map((child, index) =>
    renderNode(child, `${key}-${index}`, headingIds),
  );
  if (node.type === "heading")
    return createElement(`h${node.attrs.level}`, { key, id: headingIds.get(node) }, children);
  if (node.type === "orderedList")
    return (
      <ol key={key} start={node.attrs?.start ?? 1}>
        {children}
      </ol>
    );
  const tags = {
    doc: "div",
    paragraph: "p",
    blockquote: "blockquote",
    bulletList: "ul",
    listItem: "li",
  } as const;
  return createElement(tags[node.type], { key }, children);
}

/** Both server and client rendering fail closed; no raw HTML or stored attribute spreading. */
export function ArticleBody({
  body,
  links,
}: {
  body: ArticleBodyInput;
  links: SupplementalLink[];
}) {
  const validated = validateArticleBody(body);
  const safeLinks = validateSupplementalLinks(links);
  const headingIds = new Map(articleHeadingEntries(validated).map((h) => [h.node, h.id]));
  return (
    <>
      <div data-article-body style={{ whiteSpace: "pre-wrap" }}>
        {validated.format === "legacy-text"
          ? validated.text
          : validated.document.content.map((node, index) =>
              renderNode(node, String(index), headingIds),
            )}
      </div>
      {safeLinks.length > 0 && (
        <ul aria-label="延伸閱讀">
          {safeLinks.map((link, index) => (
            <li key={index}>
              <a href={link.href} rel="noopener noreferrer">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
