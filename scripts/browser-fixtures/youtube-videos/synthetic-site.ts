// No environment or contact credentials are read by the fixture.
export const SITE_CONTACT = {
  phoneTel: "",
  phoneDisplay: "",
  email: "synthetic@example.invalid",
  address: "Synthetic fixture only",
};
export const SITE_YOUTUBE_CHANNEL = {
  name: "Synthetic channel",
  handleLabel: "@synthetic-fixture",
  url: "https://www.youtube.com/@synthetic-fixture",
};
export function whatsappUrl(_message: string) {
  return "/contact";
}
