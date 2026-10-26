import { Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { estatePath } from "@/lib/estate-links";
import { showListingFeatureChips } from "@/lib/public-listing-body.js";

export type PropertyDetailEstate = {
  name_zh: string;
  slug: string;
  developer?: string | null;
  year_completed?: number | string | null;
  total_units?: number | string | null;
};

function Spec({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value ?? "—"}</p>
    </div>
  );
}

/**
 * Unit description, then the linked estate card. Feature chips render only
 * when there is no estate row — they are not a substitute for 屋苑資料.
 */
export function PropertyDetailCopy({
  description,
  offeringDescription,
  offeringTitle,
  features,
  estate,
}: {
  description: string | null;
  offeringDescription?: string | null;
  offeringTitle?: string | null;
  features?: readonly string[] | null;
  estate: PropertyDetailEstate | null;
}) {
  const estateHref = estate ? estatePath(estate.slug) : null;
  return (
    <>
      <section className="mt-6">
        <h2 className="text-xl font-semibold">物業描述</h2>
        <p className="mt-3 whitespace-pre-line text-muted-foreground">
          {description ?? "暫無詳細描述"}
        </p>
      </section>

      {offeringDescription ? (
        <section className="mt-6">
          <h2 className="text-xl font-semibold">{offeringTitle}</h2>
          <p className="mt-3 whitespace-pre-line text-muted-foreground">{offeringDescription}</p>
        </section>
      ) : null}

      {/* Feature chips are not an estate record. A linked estate uses the
          屋苑資料 card below; chips stay only when there is no estate row,
          so they cannot stand in for 屋苑資料. */}
      {showListingFeatureChips(estate) && (features?.length ?? 0) > 0 ? (
        <section className="mt-6">
          <h2 className="text-xl font-semibold">物業特點</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {(features ?? []).map((feature) => (
              <Badge key={feature} variant="secondary">
                {feature}
              </Badge>
            ))}
          </div>
        </section>
      ) : null}

      {estate ? (
        <Card className="mt-6" data-property-estate-card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              屋苑資料
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Spec label="屋苑" value={estate.name_zh} />
              <Spec label="發展商" value={estate.developer ?? "—"} />
              <Spec label="入伙年份" value={estate.year_completed ?? "—"} />
              <Spec label="總單位" value={estate.total_units ?? "—"} />
            </div>
            {estateHref ? (
              <div className="mt-4">
                <Link
                  to="/estate/$slug"
                  params={{ slug: estate.slug }}
                  className="text-sm text-primary underline"
                >
                  查看屋苑詳情 →
                </Link>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
