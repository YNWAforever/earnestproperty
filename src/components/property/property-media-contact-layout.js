import { createElement } from "react";

export function PropertyMediaContactLayout({ media, mobileContact, details, sidebar }) {
  return createElement(
    "div",
    {
      className: "mt-8 grid gap-8 lg:grid-cols-[2fr_1fr]",
      "data-property-layout": "media-contact",
    },
    // min-w-0 on both grid items: a grid track's automatic minimum is the
    // item's min-content width, so the gallery image (natural width ~870px)
    // widened the whole column past a 375px viewport and clipped the mobile
    // contact card, description and similar-listing cards at the right edge.
    createElement(
      "div",
      { className: "min-w-0" },
      createElement("div", { "data-slot": "media" }, media),
      createElement(
        "div",
        { "data-slot": "mobile-contact", className: "mt-4 lg:hidden" },
        mobileContact,
      ),
      createElement("div", { "data-slot": "details" }, details),
    ),
    createElement(
      "aside",
      { "data-slot": "desktop-contact", className: "min-w-0 lg:sticky lg:top-6 lg:h-fit" },
      sidebar,
    ),
  );
}
