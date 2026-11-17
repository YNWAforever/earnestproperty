export type ChannelArchiveProof = {
  readonly mode: "live_delivery";
  readonly reference: string;
};
export declare const CHANNEL_ARCHIVE_PROOF_LIVE_DELIVERY: "live_delivery";
export declare function channelArchiveProof(env?: NodeJS.ProcessEnv): ChannelArchiveProof | null;
export declare function channelArchiveVerified(channel?: {
  archived?: boolean | null;
  archiveProof?: ChannelArchiveProof | null;
}): boolean;
