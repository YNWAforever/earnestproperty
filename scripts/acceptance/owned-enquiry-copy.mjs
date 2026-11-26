import { LEAD_COPY_STAFF_ID } from "../../src/lib/neon/lead-default-assignee.js";

export const ownedCopyPhone = "85297987775";

export async function seedOwnedEnquiryCopy(query) {
  await query(
    "INSERT INTO staff_users(id,active,show_on_website,whatsapp) VALUES($1,true,false,$2) ON CONFLICT(id) DO UPDATE SET active=true,whatsapp=EXCLUDED.whatsapp",
    [LEAD_COPY_STAFF_ID, ownedCopyPhone],
  );
  await query(
    "UPDATE enquiry_notification_recipients SET staff_id=$1,phone=$2 WHERE recipient_key='copy' AND NOT enabled",
    [LEAD_COPY_STAFF_ID, ownedCopyPhone],
  );
}
