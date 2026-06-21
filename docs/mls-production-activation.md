# MLS Production Activation

This project has the public MLS crawler, normalizer, importer, protected cron route, and Vercel cron configuration in code. The production site can deploy safely before the final database activation because public listing queries tolerate the current pre-MLS Supabase schema.

## Current State

- Vercel project: `ynwaforevers-projects/earnestproperty`
- Public site: `https://earnestproperty.vercel.app`
- Cron route: `/api/mls-sync`
- Cron schedule: `0 20 * * *`
- `CRON_SECRET` is set in Vercel for Production, Preview, and Development.
- Neon database env exists, but the local checked database currently has no app tables.
- Public listing data is still read from Supabase.
- Production Supabase is missing the MLS columns from the committed migrations.
- `SUPABASE_SERVICE_ROLE_KEY` is not set in Vercel, so cron-triggered writes are intentionally disabled.

## Required Supabase Activation

Apply the committed migrations to the Supabase project used by:

- `SUPABASE_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PROJECT_ID`

The MLS fields are in:

- `supabase/migrations/20260619085130_add_property_legacy_fields.sql`
- `supabase/migrations/20260622020000_seo_content_and_estate_corrections.sql`

The app expects these `properties` columns for live MLS rows:

- `legacy_detail_id`
- `legacy_property_no`
- `legacy_url`
- `legacy_source_indexes`
- `last_scraped_at`
- `source_site`
- `source_url`
- `last_seen_at`
- `source_updated_at`

## Vercel Secret

Add the Supabase service-role key from the same Supabase project settings:

```bash
vercel env add SUPABASE_SERVICE_ROLE_KEY production --scope ynwaforevers-projects
vercel env add SUPABASE_SERVICE_ROLE_KEY preview --scope ynwaforevers-projects
```

Then redeploy production so the function sees the new secret:

```bash
vercel deploy --prod --yes --scope ynwaforevers-projects
```

## First Live Import

After the migrations and service-role key are available locally or through `vercel env pull`, run:

```bash
npm run mls:dry-run
npm run mls:sync
```

Expected dry run: JSON with discovered old-site URLs, parsed rows, and `errors: []`.

Expected live sync: JSON with `upserted` greater than `0` on the first import.

## Cron Verification

Once the service-role key is deployed, the daily Vercel Cron call should authenticate with `CRON_SECRET` and execute `/api/mls-sync`.

If the route is hit before the service-role key exists, it returns a controlled `503` payload naming `SUPABASE_SERVICE_ROLE_KEY` instead of an opaque server failure.
