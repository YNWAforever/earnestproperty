import { createElement } from "react";

export function PropertyMediaContactLayout({ media, mobileContact, details, sidebar }) {
  return createElement(
    "div",
    {
      className: "mt-8 grid gap-8 lg:grid-cols-[2fr_1fr]",
      "data-property-layout": "media-contact",
    },
    createElement(
      "div",
      null,
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
      { "data-slot": "desktop-contact", className: "lg:sticky lg:top-6 lg:h-fit" },
      sidebar,
    ),
  );
}
