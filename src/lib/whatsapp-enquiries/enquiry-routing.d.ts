export type EnquirySource = "website" | "whatsapp";
export type EnquiryRecipient = {
  key: string;
  kind: "copy" | "manager" | "sales";
  staffId: string | null;
  phone: string;
  displayName?: string;
};
export type EnquiryEstateRoute = {
  scopeKey: string;
  label: string;
  aliases: readonly string[];
  districtScope?: string | null;
  managerKey: string;
  estateId?: string | null;
  version?: number;
};
export type EnquirySalesContact = {
  staffId: string;
  position?: number;
  active: boolean;
  showOnWebsite: boolean;
  phone?: string | null;
  whatsapp?: string | null;
  displayName?: string;
};
export type EnquiryRoutingPlan = {
  routingKind: "property" | "estate" | "general" | "review";
  routingVersion: string;
  recipients: EnquiryRecipient[];
  reason?: string;
  propertyId?: string;
  propertyNo?: string;
  dealType?: "sale" | "rent";
  routeKey?: string;
  routeRevision?: number;
};
export type EnquiryForwardingPlan = EnquiryRoutingPlan & {
  source: EnquirySource;
  subjectId: string;
  createdAt: string;
  customerName: string | null;
  customerPhone: string | null;
  summary: string;
  channelId?: string;
  conversationId?: string;
  sourceMessageId?: string;
};
export const ENQUIRY_ROUTING_VERSION: string;
export const ENQUIRY_ROUTING_APPROVAL: string;
export const ENQUIRY_ROUTING_PHOTO_SHA256: string;
export const ENQUIRY_COPY: Readonly<EnquiryRecipient>;
export const ENQUIRY_MANAGERS: Readonly<Record<string, Readonly<EnquiryRecipient>>>;
export const ENQUIRY_ESTATE_ROUTES: readonly EnquiryEstateRoute[];
export function normalizeEstateLabel(value: unknown): string;
export function notificationPhone(value: unknown): string | null;
export function mentionsSpecificProperty(value: unknown): boolean;
export function matchEnquiryEstate(input?: {
  estateId?: string | null;
  estateLabel?: string | null;
  text?: string;
  routes?: readonly EnquiryEstateRoute[];
}): { kind: "estate" | "general" | "review"; reason?: string; route: EnquiryEstateRoute | null };
export function planEnquiryRouting(input?: {
  specific?: boolean;
  property?: {
    id: string;
    status: string;
    current: boolean;
    publicListingNo: string;
    dealType: "sale" | "rent";
  } | null;
  selectedStaffId?: string | null;
  agents?: EnquirySalesContact[];
  legacyAgent?: EnquirySalesContact | null;
  review?: boolean;
  estateId?: string | null;
  estateLabel?: string | null;
  text?: string;
  routes?: readonly EnquiryEstateRoute[];
}): EnquiryRoutingPlan;
