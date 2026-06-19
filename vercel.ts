import { matchers, routes, type VercelConfig } from "@vercel/config/v1";
import importedRedirects from "./src/generated/old-site-redirects.json" with { type: "json" };

const detailRedirects = importedRedirects.map((redirect) =>
  routes.redirect(redirect.source, redirect.destination, {
    permanent: redirect.permanent,
  }),
);

export const config: VercelConfig = {
  buildCommand: "npm run build",
  redirects: [
    ...detailRedirects,
    routes.redirect("/", "/", {
      permanent: true,
      has: [matchers.query("ln", { inc: ["sc", "tc"] })],
    }),
    routes.redirect("/property-detail/:oldId.html", "/listings", { permanent: true }),
    routes.redirect("/eng/property-detail/:oldId.html", "/property-detail/:oldId.html", {
      permanent: true,
    }),
    routes.redirect("/eng", "/", { permanent: true }),
    routes.redirect("/eng/", "/", { permanent: true }),
    routes.redirect("/profile.php", "/about", { permanent: true }),
    routes.redirect("/contactus.php", "/contact", { permanent: true }),
    routes.redirect("/property", "/listings?deal=all&page=1", { permanent: true }),
    routes.redirect("/property/", "/listings?deal=all&page=1", { permanent: true }),
    routes.redirect("/property/c1", "/listings?deal=all&page=1", { permanent: true }),
    routes.redirect("/property/c1/", "/listings?deal=all&page=1", { permanent: true }),
    routes.redirect("/property/c2", "/listings?deal=all&page=1", { permanent: true }),
    routes.redirect("/property/c2/", "/listings?deal=all&page=1", { permanent: true }),
    routes.redirect("/property/c5", "/listings?deal=rent&page=1", { permanent: true }),
    routes.redirect("/property/c5/", "/listings?deal=rent&page=1", { permanent: true }),
    routes.redirect("/listprop.php", "/contact", { permanent: true }),
    routes.redirect("/companynews.php", "/blog", { permanent: true }),
    routes.redirect("/news_content.php", "/blog", { permanent: true }),
    routes.redirect("/mortgage.php", "/contact", { permanent: true }),
    routes.redirect("/mortgage_rate.php", "/contact", { permanent: true }),
    routes.redirect("/school.php", "/blog", { permanent: true }),
    routes.redirect("/bankval.php", "/contact", { permanent: true }),
    routes.redirect("/unlucky.php", "/blog", { permanent: true }),
    routes.redirect("/tran_trends.php", "/blog", { permanent: true }),
  ],
};
