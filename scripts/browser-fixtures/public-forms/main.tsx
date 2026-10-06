// Owned browser fixture: the four actual public enquiry form components, wired to synthetic
// server functions (synthetic-api.ts) and no-op analytics (synthetic-analytics.ts).
import { createRoot } from "react-dom/client";
import "./synthetic-api";
import { ContactInquiryForm } from "@/components/site/ContactInquiryForm";
import { PropertyInquiryForm } from "@/components/property/PropertyInquiryForm";
import { ValuationLeadForm } from "@/components/site/OwnerValuationPanel";
import { ListingAlertForm } from "@/components/site/ListingAlertForm";
import "@/styles.css";

createRoot(document.getElementById("root")!).render(
  <main className="mx-auto max-w-3xl space-y-10 px-4 py-8">
    <section data-form="contact">
      <h2 className="text-lg font-semibold">Contact form</h2>
      <ContactInquiryForm />
    </section>
    <section data-form="property">
      <h2 className="text-lg font-semibold">Property enquiry form</h2>
      <PropertyInquiryForm propertyId="00000000-0000-4000-8000-000000000001" />
    </section>
    <section data-form="valuation">
      <h2 className="text-lg font-semibold">Valuation form</h2>
      <ValuationLeadForm />
    </section>
    <section data-form="alert">
      <h2 className="text-lg font-semibold">Listing alert form</h2>
      <ListingAlertForm search={{ deal: "sale" }} />
    </section>
  </main>,
);
