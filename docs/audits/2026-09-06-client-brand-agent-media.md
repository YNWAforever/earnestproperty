# Client-supplied company and agent media

Scope: supplied company logo, new Lido shopfront photo, existing agents' namecards and WhatsApp QR codes.

- Full 1200×400 company logo displayed without cropping in header, footer and home about preview; structured-data logo points to the same original file. Retain the existing small square browser icon.
- Original 1100×848 Lido storefront photo replaces the contact/about branch image. Publish the file before updating the matching database branch photo reference.
- 23 existing public profiles receive a full namecard and matching QR image, original-image preview/download and a same-device WhatsApp link. Existing analytics callback is reused.
- All 24 numbered card QR payloads were decoded locally and matched the respective standalone QR image. The 23 existing profile pairs are included; file hashes guard the original bytes. Three extra named JPGs omit a decodable QR and duplicate numbered-card identities, so use complete numbered cards.
- Kenneth Chang maps to existing public slug `kenneth`; Andy Hah maps to `andy-hah` despite existing profile spelling Andy Han. This change does not rewrite staff identity/contact fields.
- Michael Wong has a card and QR but no current public profile. Kelvin Wu has a QR only and no current public profile. Their materials remain in the supplied folder pending profile information; no new staff accounts are created.

Verification: 23 asset pairs/hash checks, 143 property-experience Node tests, 94 control-plane checks, 16 homepage checks, contact/SEO regressions, TypeScript and targeted lint. Browser checks cover Andy Hah/Kenneth/Vincy Lam, image loading/download targets, Lido photo on about/contact, and 320/390/1024/1440px layout. Independent review corrected CTA analytics wiring. No WhatsApp messages sent.
