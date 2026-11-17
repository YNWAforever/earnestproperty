export type PlatformSubscribeChannelState = {
  observed: boolean;
  etagPresent: boolean;
  connected: boolean | null;
  archived: boolean | null;
  cloudEnvironmentCount: number;
  subscribed: boolean | null;
  enabled: boolean | null;
  installed: boolean | null;
};
export type PlatformSubscribeOutcome = {
  responded: boolean;
  accepted: boolean;
  hasErrors: boolean;
  errorCodes: string[];
  channelState: PlatformSubscribeChannelState;
};
export declare const PLATFORM_SUBSCRIBE_JOB_TYPE: "woztell.enquiry.platform.subscribe";
export declare function platformSubscribeEnabled(env?: NodeJS.ProcessEnv): boolean;
export declare function platformSubscribePayload(input: unknown): Record<string, never>;
export declare function channelState(body: unknown): PlatformSubscribeChannelState;
export declare function channelEtag(body: unknown): string | null;
export declare function subscribeOutcome(body: unknown): PlatformSubscribeOutcome;
