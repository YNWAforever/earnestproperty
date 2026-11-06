import { decodeHTML, decodeHTMLAttribute } from "entities";
import { lexer, walkTokens } from "marked";
import { parseFragment } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import postcss from "postcss";
import valueParser from "postcss-value-parser";

type Source = { value: string; decoded: string };
const requireSyntax = (ok: boolean) => {
  if (!ok) throw new Error("RECOVERY_REFERENCE_SYNTAX");
};
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Decode only for interpretation. The original string is ALWAYS retained in evidence.
 * Multiple encoding layers, percent-encoded delimiters, CSS escapes and controls are
 * unsupported: they cannot be waived through an external-reference exclusion.
 */
export function decodeReferenceValue(value: string, attribute = false) {
  const decode = attribute ? decodeHTMLAttribute : decodeHTML;
  const decoded = decode(value);
  requireSyntax(
    decode(decoded) === decoded &&
      !/[\\%\uFFFD]/.test(decoded) &&
      ![...decoded].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
  );
  return decoded;
}

/** Parse supported syntax; regexes below only detect unsupported leftovers, never
 * decide that a media-bearing construct has zero references. No renderer/network runs.
 */
export function parseMediaSources(value: string, field: string): Source[] {
  const sources: Source[] = [];
  const add = (original: string, decoded: string) => {
    requireSyntax(original.length > 0 && decoded.length > 0);
    // Interpret entities even in scalar JSON fields; never bless an encoded source URL as external.
    sources.push({ value: original, decoded });
  };
  const literal = (original: string, attribute = false) =>
    add(original, decodeReferenceValue(original, attribute));
  const css = (original: string, property?: string) => {
    const decoded = decodeHTMLAttribute(original);
    requireSyntax(
      decodeHTMLAttribute(decoded) === decoded &&
        !decoded.includes("\\") &&
        !decoded.includes("/*"),
    );
    let root;
    try {
      root = postcss.parse(`x{${property ? property + ":" : ""}${decoded}}`);
    } catch {
      throw new Error("RECOVERY_REFERENCE_SYNTAX");
    }
    requireSyntax(
      root.nodes.length === 1 && root.nodes[0].type === "rule" && root.nodes[0].selector === "x",
    );
    const rule = root.nodes[0];
    if (rule.type !== "rule") throw new Error("RECOVERY_REFERENCE_SYNTAX");
    for (const decl of rule.nodes) {
      requireSyntax(decl.type === "decl");
      if (decl.type !== "decl") throw new Error("RECOVERY_REFERENCE_SYNTAX");
      const parsed = valueParser(decl.value);
      parsed.walk((node) => {
        requireSyntax(!("unclosed" in node && node.unclosed));
        if (node.type === "word" || node.type === "string")
          requireSyntax(!/(?:https?:)?\/\/|(?:https?|url)(?:%|\\|&#)/i.test(node.value));
        if (node.type === "function") {
          const name = node.value.toLowerCase();
          requireSyntax(
            [
              "url",
              "rgb",
              "rgba",
              "hsl",
              "hsla",
              "linear-gradient",
              "radial-gradient",
              "calc",
            ].includes(name),
          );
          if (name === "url") {
            const args = node.nodes.filter((n) => n.type !== "space");
            requireSyntax(args.length === 1 && ["word", "string"].includes(args[0].type));
            add(original, decodeReferenceValue(args[0].value));
            return false;
          }
        }
      });
    }
  };
  if (/^(?:style|background_?image|background-image)$/i.test(field)) {
    css(value, field.toLowerCase() === "style" ? undefined : "background-image");
  } else if (
    field.toLowerCase() === "background" &&
    !/^(?:https?:)?\/\//i.test(decodeHTML(value))
  ) {
    css(value, "background");
  } else if (
    /^(?:src|url|href|poster|background|cover_?image|image_?url|thumbnail_?url|avatar_?url)$/i.test(
      field,
    )
  ) {
    literal(value);
  } else {
    requireSyntax(field.toLowerCase() !== "srcset");
    const tokens = lexer(value, { gfm: true });
    const html: string[] = [];
    const definitions = new Set<string>();
    // Marked resolves full/collapsed/shortcut image references. Duplicate definitions
    // are rejected instead of accepting its first-definition-wins recovery behavior.
    for (const match of value.matchAll(/^ {0,3}\[([^\]\n]+)\]:/gm)) {
      const id = match[1].trim().replace(/\s+/g, " ").toLowerCase();
      requireSyntax(!definitions.has(id));
      definitions.add(id);
    }
    for (const link of Object.values(tokens.links)) {
      const original = value.includes(link.href) ? link.href : value;
      add(original, decodeReferenceValue(link.href));
    }
    walkTokens(tokens, (token) => {
      if (token.type === "image" || token.type === "link") {
        const href = String(token.href);
        // Markdown may unescape punctuation. Retain the complete original token if
        // the interpreted destination is not an exact substring of the source.
        add(value.includes(href) ? href : token.raw, decodeReferenceValue(href));
      } else if (token.type === "html") {
        html.push(token.raw);
      } else if (token.type === "text" || token.type === "code" || token.type === "codespan") {
        if ("tokens" in token && token.tokens) return;
        const raw = token.raw;
        requireSyntax(!/!\s*\[|<\/?[a-z][^>]*|\burl\s*\(|\bbackground(?:-image)?\s*:/i.test(raw));
        const decoded = decodeHTML(raw);
        requireSyntax(decodeHTML(decoded) === decoded);
        for (const match of decoded.matchAll(/(?:https?:)?\/\/[^\s"'<>\\)]+/g)) {
          add(raw === decoded ? match[0] : raw, decodeReferenceValue(match[0]));
        }
        // Percent/CSS/JSON escapes cannot make URL-like text silently disappear.
        requireSyntax(!/(?:https?|url)(?:%|\\|&#)|(?:%2f|\\2f)/i.test(decoded));
      }
    });
    if (html.length) {
      const source = html.join("\n");
      const errors: unknown[] = [];
      const fragment = parseFragment(source, {
        sourceCodeLocationInfo: true,
        onParseError: (error) => errors.push(error),
      });
      requireSyntax(errors.length === 0);
      const visit = (node: DefaultTreeAdapterMap["node"]) => {
        if ("tagName" in node) {
          requireSyntax(
            ![
              "script",
              "style",
              "iframe",
              "object",
              "embed",
              "base",
              "link",
              "svg",
              "math",
              "template",
            ].includes(node.tagName),
          );
          for (const attr of node.attrs) {
            const name = attr.name.toLowerCase();
            requireSyntax(!name.startsWith("on") && name !== "srcdoc" && name !== "srcset");
            const location = node.sourceCodeLocation?.attrs?.[name];
            requireSyntax(!!location);
            const raw = source.slice(location!.startOffset, location!.endOffset);
            const assignment = /^[^=\s]+\s*=\s*(?:"([\s\S]*)"|'([\s\S]*)'|([^\s]+))$/.exec(raw);
            if (!assignment) {
              requireSyntax(
                !["src", "href", "style", "background", "background-image", "poster"].includes(
                  name,
                ),
              );
              continue;
            }
            const original = assignment[1] ?? assignment[2] ?? assignment[3];
            requireSyntax(decodeHTMLAttribute(original) === attr.value);
            if (name === "style" || name === "background-image")
              css(original, name === "style" ? undefined : name);
            else if (/^(?:src|href|poster|background|data-src|data-url)$/.test(name))
              literal(original, true);
            else if (/(?:https?:)?\/\//i.test(attr.value)) literal(original, true);
            else requireSyntax(!/url\s*\(|(?:https?|url)(?:%|\\|&#)/i.test(attr.value));
          }
        }
        if ("childNodes" in node) node.childNodes.forEach(visit);
      };
      fragment.childNodes.forEach(visit);
    }
  }
  const unique = new Map(
    sources.map((source) => [JSON.stringify([source.value, source.decoded]), source]),
  );
  return [...unique.values()].sort(
    (a, b) => compare(a.value, b.value) || compare(a.decoded, b.decoded),
  );
}
