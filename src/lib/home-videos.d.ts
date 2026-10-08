export type HomeVideo = {
  key: string;
  title: string;
  url: string;
  eyebrow: string;
  /** Set for listing walkthroughs, so the card can deep-link to the property. */
  listingNo: string | null;
};

export type ChannelVideoInput = {
  id: string;
  title?: string | null;
  video_url: string;
};

export function toHomeVideos(
  listingVideos: HomeVideo[],
  cmsVideos: ChannelVideoInput[],
  limit: number,
): HomeVideo[];
