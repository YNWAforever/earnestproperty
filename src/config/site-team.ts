/**
 * Placeholder team manifest.
 *
 * These 24 entries come from studio headshots supplied by the client
 * (`同事P好相片/1024x1024/*.png`) but are NOT yet linked to real staff
 * records — the English name is guessed from the photo filename only.
 * Chinese name, job title, branch, phone, WhatsApp number and licence number
 * are all unconfirmed (`// TODO`) and MUST be verified with the client before
 * this manifest is treated as authoritative.
 *
 * `/agents` and the homepage team preview render real Neon `staff_users`
 * profiles first; this manifest is only a fallback so agent faces show up
 * immediately instead of an empty directory. Once real profiles exist in
 * Neon (via the admin panel), this file becomes unused and can be deleted.
 */

export type TeamMemberPlaceholder = {
  slug: string;
  nameEn: string;
  nameZh: string | null;
  jobTitle: string | null;
  branch: string | null;
  phone: string | null;
  whatsapp: string | null;
  licenceNo: string | null;
  photo: string;
  isPlaceholder: true;
};

const RAW_TEAM: Omit<TeamMemberPlaceholder, "isPlaceholder">[] = [
  {
    slug: "andy-hah",
    nameEn: "Andy Hah",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: null, // TODO: confirm job title
    branch: null, // TODO: confirm branch assignment
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/andy-hah.jpg",
  },
  {
    slug: "dickson-wong",
    nameEn: "Dickson Wong",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: null, // TODO: confirm job title
    branch: null, // TODO: confirm branch assignment
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/dickson-wong.jpg",
  },
  {
    slug: "eric-lai",
    nameEn: "Eric Lai",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: null, // TODO: confirm job title
    branch: null, // TODO: confirm branch assignment
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/eric-lai.jpg",
  },
  {
    slug: "eunice-yau",
    nameEn: "Eunice Yau",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: null, // TODO: confirm job title
    branch: null, // TODO: confirm branch assignment
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/eunice-yau.jpg",
  },
  {
    slug: "george-chau",
    nameEn: "George Chau",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: null, // TODO: confirm job title
    branch: null, // TODO: confirm branch assignment
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/george-chau.jpg",
  },
  {
    slug: "joanna-tang",
    nameEn: "Joanna Tang",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: null, // TODO: confirm job title
    branch: null, // TODO: confirm branch assignment
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/joanna-tang.jpg",
  },
  {
    slug: "joe-yuen",
    nameEn: "Joe Yuen",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: null, // TODO: confirm job title
    branch: null, // TODO: confirm branch assignment
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/joe-yuen.jpg",
  },
  {
    slug: "kelvin-lee",
    nameEn: "Kelvin Lee",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: null, // TODO: confirm job title
    branch: null, // TODO: confirm branch assignment
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/kelvin-lee.jpg",
  },
  {
    slug: "kenneth",
    nameEn: "Kenneth",
    nameZh: null, // TODO: confirm Traditional Chinese name + surname (filename has first name only)
    jobTitle: null, // TODO: confirm job title
    branch: null, // TODO: confirm branch assignment
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/kenneth.jpg",
  },
  {
    slug: "king-lau",
    nameEn: "King Lau",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: null, // TODO: confirm job title
    branch: null, // TODO: confirm branch assignment
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/king-lau.jpg",
  },
  {
    slug: "michael-wong",
    nameEn: "Michael Wong",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: null, // TODO: confirm job title
    branch: null, // TODO: confirm branch assignment
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/michael-wong.jpg",
  },
  {
    slug: "mike-cheung",
    nameEn: "Mike Cheung",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: null, // TODO: confirm job title
    branch: null, // TODO: confirm branch assignment
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/mike-cheung.jpg",
  },
  {
    slug: "mon-lau",
    nameEn: "Mon Lau",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: null, // TODO: confirm job title
    branch: null, // TODO: confirm branch assignment
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/mon-lau.jpg",
  },
  {
    slug: "mun-chu",
    nameEn: "Mun Chu",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: null, // TODO: confirm job title
    branch: null, // TODO: confirm branch assignment
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/mun-chu.jpg",
  },
  {
    slug: "raymond-tam",
    nameEn: "Raymond Tam",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: null, // TODO: confirm job title
    branch: null, // TODO: confirm branch assignment
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/raymond-tam.jpg",
  },
  {
    slug: "ruby-lee",
    nameEn: "Ruby Lee",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: null, // TODO: confirm job title
    branch: null, // TODO: confirm branch assignment
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/ruby-lee.jpg",
  },
  {
    slug: "sam-lee",
    nameEn: "Sam Lee",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: null, // TODO: confirm job title
    branch: null, // TODO: confirm branch assignment
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/sam-lee.jpg",
  },
  {
    slug: "shadow-cheung",
    nameEn: "Shadow Cheung",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: null, // TODO: confirm job title
    branch: null, // TODO: confirm branch assignment
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/shadow-cheung.jpg",
  },
  {
    slug: "terence-tang",
    nameEn: "Terence Tang",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: null, // TODO: confirm job title
    branch: null, // TODO: confirm branch assignment
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/terence-tang.jpg",
  },
  {
    slug: "terry-chan",
    nameEn: "Terry Chan",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: null, // TODO: confirm job title
    branch: null, // TODO: confirm branch assignment
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/terry-chan.jpg",
  },
  {
    slug: "tommy-yiu",
    nameEn: "Tommy Yiu",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: null, // TODO: confirm job title
    branch: null, // TODO: confirm branch assignment
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/tommy-yiu.jpg",
  },
  {
    slug: "vincy-lam",
    nameEn: "Vincy Lam",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: null, // TODO: confirm job title
    branch: null, // TODO: confirm branch assignment
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/vincy-lam.jpg",
  },
  {
    slug: "wendy-lu",
    nameEn: "Wendy Lu",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: null, // TODO: confirm job title
    branch: null, // TODO: confirm branch assignment
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/wendy-lu.jpg",
  },
  {
    slug: "winnie-cheung",
    nameEn: "Winnie Cheung",
    nameZh: null, // TODO: confirm Traditional Chinese name
    jobTitle: null, // TODO: confirm job title
    branch: null, // TODO: confirm branch assignment
    phone: null, // TODO: confirm direct phone number
    whatsapp: null, // TODO: confirm WhatsApp number (if different from phone)
    licenceNo: null, // TODO: confirm individual estate agent licence number, if applicable
    photo: "/team/winnie-cheung.jpg",
  },
];

export const SITE_TEAM: TeamMemberPlaceholder[] = RAW_TEAM.map((member) => ({
  ...member,
  isPlaceholder: true,
}));

export function getTeamPreview(count: number): TeamMemberPlaceholder[] {
  return SITE_TEAM.slice(0, count);
}
