import type { ReactNode } from "react";

import { toTelHref } from "@/lib/contact-links";

/** A tel:+852 link; a phone that cannot be dialled renders as plain text, not an inert <a>. */
export function PhoneLink({
  phone,
  className,
  children,
}: {
  phone: string;
  className?: string;
  children: ReactNode;
}) {
  const href = toTelHref(phone);
  return href ? (
    <a href={href} className={className}>
      {children}
    </a>
  ) : (
    <span className={className}>{children}</span>
  );
}
