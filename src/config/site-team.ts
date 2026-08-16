/**
 * Seed input for scripts/neon/seed-staff.mjs.
 *
 * These 23 entries were reconciled against the client's roster in PR #30
 * (CHANGELOG PHASE 4): the job titles and branches below are client-supplied and
 * confirmed, and Michael Wong was removed to reach 23. They were seeded into
 * Neon `staff_users` by commit c5ff3bb and Neon is now the source of truth --
 * /agents and the homepage read the database directly and never consult this file.
 *
 * Still outstanding, tracked in TODO-ASSETS.md: Traditional Chinese names, direct
 * phone and WhatsApp numbers, and individual EAA licence numbers. Supply them via
 * the optional contacts JSON that seed-staff.mjs accepts, not by editing here --
 * the seed is additive and will not overwrite a value an admin has since entered.
 */

export type TeamSeedMember = {
  slug: string;
  nameEn: string;
  nameZh: string | null;
  jobTitle: string | null;
  branch: string | null;
  phone: string | null;
  whatsapp: string | null;
  licenceNo: string | null;
  photo: string;
};

const RAW_TEAM: TeamSeedMember[] = [
  {
    slug: "kenneth",
    nameEn: "Kenneth Chang",
    nameZh: null, // TODO: confirm Traditional Chinese name + surname (filename has first name only)
    jobTitle: "董事",
    branch: null,
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/kenneth.jpg",
  },
  {
    slug: "tommy-yiu",
    nameEn: "Tommy Yiu",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: "高級營業經理",
    branch: "青山公路豪景分行",
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/tommy-yiu.jpg",
  },
  {
    slug: "terence-tang",
    nameEn: "Terence Tang",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: "高級營業經理",
    branch: "麗都分行",
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/terence-tang.jpg",
  },
  {
    slug: "sam-lee",
    nameEn: "Sam Lee",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: "高級營業經理",
    branch: "海韻分行",
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/sam-lee.jpg",
  },
  {
    slug: "king-lau",
    nameEn: "King Lau",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: "高級客戶經理",
    branch: "青山公路豪景分行",
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/king-lau.jpg",
  },
  {
    slug: "ruby-lee",
    nameEn: "Ruby Lee",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: "高級客戶經理",
    branch: "麗都分行",
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/ruby-lee.jpg",
  },
  {
    slug: "mike-cheung",
    nameEn: "Mike Cheung",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: "高級客戶經理",
    branch: "海韻分行",
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/mike-cheung.jpg",
  },
  {
    slug: "joe-yuen",
    nameEn: "Joe Yuen",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: "高級客戶經理",
    branch: "青山公路豪景分行",
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/joe-yuen.jpg",
  },
  {
    slug: "mun-chu",
    nameEn: "Mun Chu",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: "高級客戶經理",
    branch: "麗都分行",
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/mun-chu.jpg",
  },
  {
    slug: "george-chau",
    nameEn: "George Chau",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: "高級客戶經理",
    branch: "海韻分行",
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/george-chau.jpg",
  },
  {
    slug: "mon-lau",
    nameEn: "Mon Lau",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: "高級客戶經理",
    branch: "青山公路豪景分行",
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/mon-lau.jpg",
  },
  {
    slug: "wendy-lu",
    nameEn: "Wendy Lu",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: "高級客戶經理",
    branch: "麗都分行",
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/wendy-lu.jpg",
  },
  {
    slug: "vincy-lam",
    nameEn: "Vincy Lam",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: "高級客戶經理",
    branch: "海韻分行",
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/vincy-lam.jpg",
  },
  {
    slug: "kelvin-lee",
    nameEn: "Kelvin Lee",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: "高級客戶經理",
    branch: "青山公路豪景分行",
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/kelvin-lee.jpg",
  },
  {
    slug: "raymond-tam",
    nameEn: "Raymond Tam",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: "高級客戶經理",
    branch: "麗都分行",
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/raymond-tam.jpg",
  },
  {
    slug: "eric-lai",
    nameEn: "Eric Lai",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: "高級客戶經理",
    branch: "海韻分行",
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/eric-lai.jpg",
  },
  {
    slug: "shadow-cheung",
    nameEn: "Shadow Cheung",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: "客戶經理",
    branch: "青山公路豪景分行",
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/shadow-cheung.jpg",
  },
  {
    slug: "terry-chan",
    nameEn: "Terry Chan",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: "高級客戶經理",
    branch: "麗都分行",
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/terry-chan.jpg",
  },
  {
    slug: "dickson-wong",
    nameEn: "Dickson Wong",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: "高級客戶經理",
    branch: "海韻分行",
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/dickson-wong.jpg",
  },
  {
    slug: "andy-hah",
    nameEn: "Andy Han",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: "高級客戶經理",
    branch: "麗都分行",
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/andy-hah.jpg",
  },
  {
    slug: "winnie-cheung",
    nameEn: "Winnie Cheung",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: "高級客戶經理",
    branch: "青山公路豪景分行",
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/winnie-cheung.jpg",
  },
  {
    slug: "joanna-tang",
    nameEn: "Joanna Tang",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: "高級客戶經理",
    branch: "青山公路豪景分行",
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/joanna-tang.jpg",
  },
  {
    slug: "eunice-yau",
    nameEn: "Eunice Yau",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: "客戶經理",
    branch: "麗都分行",
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/eunice-yau.jpg",
  },
];

export const SITE_TEAM: TeamSeedMember[] = RAW_TEAM;
