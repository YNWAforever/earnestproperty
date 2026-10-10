export type VariantSet = {
  assetId?: string;
  sourceHash: string;
  sourceUrl?: string;
  status: "ready" | "unavailable" | "failed";
  variants: Array<{ width: number; url: string; bytes: number; format: "webp" }>;
  /** Log-safe cause, set only when status is "failed". */
  reason?: string;
};
export declare function failureReason(error: unknown): string;
export declare const REMOTE_VARIANT_WIDTHS: readonly number[];
export declare function ensureMediaVariants(
  input: { assetId: string; sourceHash: string; sourceUrl: string },
  ports: {
    allowedHosts: string[];
    find(assetId: string, sourceHash: string): Promise<VariantSet | null>;
    readSource(input: {
      assetId: string;
      sourceHash: string;
      sourceUrl: string;
    }): Promise<Uint8Array | ArrayBuffer>;
    put(input: {
      pathname: string;
      body: Uint8Array;
      contentType: "image/webp";
      allowOverwrite: true;
    }): Promise<{ url: string; pathname: string; contentType: string; size: number }>;
    save(set: VariantSet): Promise<VariantSet>;
  },
): Promise<VariantSet>;
