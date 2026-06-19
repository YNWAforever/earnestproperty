const whatsappPhone = import.meta.env.VITE_CONTACT_WHATSAPP_PHONE ?? "";
const phoneDisplay = import.meta.env.VITE_CONTACT_PHONE_DISPLAY ?? "";
const phoneTel = import.meta.env.VITE_CONTACT_PHONE_TEL ?? "";

export const SITE_CONTACT = {
  whatsappPhone,
  phoneDisplay,
  phoneTel,
  email: "info@earnestproperty.com",
  address: "新界深井青山公路深井段 23 號麗都花園地下 5A 舖",
  licenceNo: "C-018613",
};

export function whatsappUrl(message: string) {
  const encoded = encodeURIComponent(message);
  return whatsappPhone ? `https://wa.me/${whatsappPhone}?text=${encoded}` : "/contact";
}
