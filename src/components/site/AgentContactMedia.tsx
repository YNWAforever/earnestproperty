import { AppImage } from "@/components/media/AppImage";
import { Button } from "@/components/ui/button";
import contactMedia from "@/content/agent-contact-media.json";

type ContactMedia = (typeof contactMedia)[keyof typeof contactMedia];
export function AgentContactMedia({
  slug,
  onWhatsAppClick,
}: {
  slug: string | null | undefined;
  onWhatsAppClick?: () => void;
}) {
  const media =
    slug && Object.hasOwn(contactMedia, slug)
      ? (contactMedia as Record<string, ContactMedia>)[slug]
      : null;
  if (!media) return null;
  return (
    <section
      id="contact-card"
      aria-labelledby="contact-card-title"
      className="scroll-mt-24 border-b py-8"
    >
      <h2 id="contact-card-title" className="text-2xl font-semibold">
        代理名片與 WhatsApp
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        查看完整名片，或掃描 QR Code 聯絡代理。同一部手機可直接開啟 WhatsApp。
      </p>
      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 rounded-xl border bg-white p-3 sm:p-5">
          <a
            href={media.card}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`放大查看 ${media.name} 名片`}
          >
            <AppImage
              src={media.card}
              alt={`${media.name} 的晉誠地產名片`}
              width={media.width}
              height={media.height}
              className="h-auto w-full object-contain"
              sizes="(min-width: 1024px) 700px, 100vw"
            />
          </a>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <a href={media.card} target="_blank" rel="noopener noreferrer">
                放大名片
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={media.card} download={`${slug}-namecard.jpg`}>
                儲存名片
              </a>
            </Button>
          </div>
        </div>
        <div className="flex flex-col items-center rounded-xl border bg-card p-5 text-center">
          <AppImage
            src={media.qr}
            alt={`${media.name} 的 WhatsApp QR Code`}
            width={300}
            height={300}
            className="h-[200px] w-[200px] bg-white object-contain"
          />
          <p className="mt-3 text-sm font-medium">掃描聯絡 {media.name}</p>
          <Button asChild className="mt-4 w-full">
            <a
              href={media.whatsappUrl}
              onClick={onWhatsAppClick}
              target="_blank"
              rel="noopener noreferrer"
            >
              開啟 WhatsApp
            </a>
          </Button>
          <a
            className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4"
            href={media.qr}
            download={`${slug}-whatsapp-qr.png`}
          >
            儲存 QR Code
          </a>
        </div>
      </div>
    </section>
  );
}
