export type EstateTag = {
  tag: string;
  district: string | null;
};

export function deriveEstateTag(title: string | null | undefined): EstateTag | null;
