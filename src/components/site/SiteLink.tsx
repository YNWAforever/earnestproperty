import { Link, type LinkProps } from "@tanstack/react-router";
import type { AnchorHTMLAttributes, MouseEventHandler, ReactNode } from "react";

import { hrefPathname, isExternalHref, parseListingsSearch } from "@/lib/site-links";

type SharedProps = {
  className?: string;
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  activeProps?: LinkProps["activeProps"];
  activeOptions?: LinkProps["activeOptions"];
  title?: string;
  "aria-label"?: string;
  "aria-current"?: AnchorHTMLAttributes<HTMLAnchorElement>["aria-current"];
  target?: AnchorHTMLAttributes<HTMLAnchorElement>["target"];
  rel?: string;
};

/**
 * Renders an internal href string as the correctly typed TanStack `<Link>`, so
 * content, nav and breadcrumb data can stay as plain strings while every click
 * remains a client-side navigation (a raw `<a href="/listings?deal=sale">`
 * inside the SPA is a full document reload). Anything this doesn't recognise --
 * external URLs, mailto:, tel:, wa.me -- renders as a plain anchor.
 *
 * This generalises the corridor page's old CorridorRelatedLink: one mapper for
 * the whole site instead of a per-page copy that only knew its own routes.
 */
export function SiteLink({ href, children, ...props }: SharedProps & { href: string }) {
  if (isExternalHref(href)) {
    const external = /^https?:/i.test(href) || href.startsWith("//");
    return (
      <a
        href={href}
        className={props.className}
        onClick={props.onClick}
        title={props.title}
        aria-label={props["aria-label"]}
        aria-current={props["aria-current"]}
        target={props.target ?? (external ? "_blank" : undefined)}
        rel={props.rel ?? (external ? "noopener noreferrer" : undefined)}
      >
        {children}
      </a>
    );
  }

  const linkProps = {
    className: props.className,
    onClick: props.onClick,
    activeProps: props.activeProps,
    activeOptions: props.activeOptions,
    title: props.title,
    "aria-label": props["aria-label"],
    "aria-current": props["aria-current"],
    target: props.target,
    rel: props.rel,
  };
  const pathname = hrefPathname(href);
  const hashIndex = href.indexOf("#");
  const hash = hashIndex === -1 ? undefined : href.slice(hashIndex + 1) || undefined;

  if (pathname === "/") {
    return (
      <Link to="/" hash={hash} {...linkProps}>
        {children}
      </Link>
    );
  }
  if (pathname === "/listings") {
    return (
      <Link to="/listings" search={parseListingsSearch(href)} hash={hash} {...linkProps}>
        {children}
      </Link>
    );
  }

  const estateMatch = pathname.match(/^\/estate\/([^/]+)$/);
  if (estateMatch) {
    return (
      <Link to="/estate/$slug" params={{ slug: estateMatch[1] }} hash={hash} {...linkProps}>
        {children}
      </Link>
    );
  }
  if (pathname === "/castle-peak-road") {
    return (
      <Link to="/castle-peak-road" hash={hash} {...linkProps}>
        {children}
      </Link>
    );
  }
  const corridorMatch = pathname.match(/^\/castle-peak-road\/([^/]+)$/);
  if (corridorMatch) {
    return (
      <Link
        to="/castle-peak-road/$segment"
        params={{ segment: corridorMatch[1] }}
        hash={hash}
        {...linkProps}
      >
        {children}
      </Link>
    );
  }
  if (pathname === "/district/sham-tseng") {
    return (
      <Link to="/district/sham-tseng" hash={hash} {...linkProps}>
        {children}
      </Link>
    );
  }
  if (pathname === "/district/ting-kau") {
    // Legacy URL -- resolve straight to the canonical corridor page so content
    // referencing it doesn't send readers through the 301.
    return (
      <Link to="/castle-peak-road/$segment" params={{ segment: "ting-kau" }} {...linkProps}>
        {children}
      </Link>
    );
  }
  if (pathname === "/district/tsuen-wan") {
    return (
      <Link to="/district/tsuen-wan" hash={hash} {...linkProps}>
        {children}
      </Link>
    );
  }
  if (pathname === "/agents") {
    return (
      <Link to="/agents" hash={hash} {...linkProps}>
        {children}
      </Link>
    );
  }
  const agentMatch = pathname.match(/^\/agents\/([^/]+)$/);
  if (agentMatch) {
    return (
      <Link to="/agents/$slug" params={{ slug: agentMatch[1] }} hash={hash} {...linkProps}>
        {children}
      </Link>
    );
  }
  if (pathname === "/blog") {
    return (
      <Link to="/blog" hash={hash} {...linkProps}>
        {children}
      </Link>
    );
  }
  if (pathname === "/blog/editorial-standards") {
    return (
      <Link to="/blog/editorial-standards" hash={hash} {...linkProps}>
        {children}
      </Link>
    );
  }
  const blogMatch = pathname.match(/^\/blog\/([^/]+)$/);
  if (blogMatch) {
    return (
      <Link to="/blog/$slug" params={{ slug: blogMatch[1] }} hash={hash} {...linkProps}>
        {children}
      </Link>
    );
  }
  const propertyMatch = pathname.match(/^\/property\/([^/]+)$/);
  if (propertyMatch) {
    return (
      <Link
        to="/property/$listingNo"
        params={{ listingNo: propertyMatch[1] }}
        hash={hash}
        {...linkProps}
      >
        {children}
      </Link>
    );
  }
  switch (pathname) {
    case "/videos":
      return (
        <Link to="/videos" hash={hash} {...linkProps}>
          {children}
        </Link>
      );
    case "/transactions":
      return (
        <Link to="/transactions" hash={hash} {...linkProps}>
          {children}
        </Link>
      );
    case "/mortgage":
      return (
        <Link to="/mortgage" hash={hash} {...linkProps}>
          {children}
        </Link>
      );
    case "/about":
      return (
        <Link to="/about" hash={hash} {...linkProps}>
          {children}
        </Link>
      );
    case "/contact":
      return (
        <Link to="/contact" hash={hash} {...linkProps}>
          {children}
        </Link>
      );
    case "/estate-reviews":
      return (
        <Link to="/estate-reviews" hash={hash} {...linkProps}>
          {children}
        </Link>
      );
    case "/privacy":
      return (
        <Link to="/privacy" hash={hash} {...linkProps}>
          {children}
        </Link>
      );
    case "/terms":
      return (
        <Link to="/terms" hash={hash} {...linkProps}>
          {children}
        </Link>
      );
    case "/disclaimer":
      return (
        <Link to="/disclaimer" hash={hash} {...linkProps}>
          {children}
        </Link>
      );
    default:
      return (
        <a
          href={href}
          className={props.className}
          onClick={props.onClick}
          title={props.title}
          aria-label={props["aria-label"]}
          aria-current={props["aria-current"]}
          target={props.target}
          rel={props.rel}
        >
          {children}
        </a>
      );
  }
}
