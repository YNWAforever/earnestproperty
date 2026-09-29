import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { readEnquiryResolutionContext } from './enquiry-access.server.ts';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('resolution options come only from the readable enquiry, fresh MLS and verified alias', async () => {
  const db = new PGlite();
  const query = async (sql, params=[]) => (await db.query(sql,params)).rows;
  try {
    await db.exec(`
      CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean,branch_id uuid,name_zh text,name_en text,email text);
      CREATE TABLE staff_roles(staff_user_id uuid,role text);
      CREATE TABLE inquiries(id uuid PRIMARY KEY,source text,enquiry_version bigint,public_listing_no text,
        association_review boolean,provider_thread_review boolean,enquiry_owner_staff_id uuid,
        requested_staff_id uuid,property_id uuid,enquiry_resolution jsonb);
      CREATE TABLE whatsapp_enquiry_reference_links(inquiry_id uuid,source text,external_listing_id text,
        deal_type text,scope_id text,interpretation_id uuid,receipt_id uuid,created_at timestamptz,
        event_id uuid,ref_index int);
      CREATE TABLE mls_source_state(source text,scope_id text,external_listing_id text,deal_type text,
        property_id uuid,source_status text,last_accepted_at timestamptz);
      CREATE TABLE properties(id uuid,status text,listing_no text,title_zh text);
      CREATE TABLE property_public_members(property_id uuid,public_listing_no text);
      CREATE TABLE whatsapp_portal_interpretations(id uuid,interpretation jsonb);
      CREATE TABLE whatsapp_inbound_receipts(id uuid,channel_id text);
      CREATE TABLE whatsapp_portal_source_scopes(channel_id text,source text,scope_id text,enabled boolean,staff_namespace text);
      CREATE TABLE staff_external_references(namespace text,external_reference text,valid_from timestamptz,
        valid_until timestamptz,verified_at timestamptz,staff_id uuid);
      CREATE FUNCTION wa_can_read_enquiry(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT $1='${id(1)}'::uuid AND $2='${id(10)}'::uuid $$;
      CREATE FUNCTION wa_can_correct_enquiry(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT wa_can_read_enquiry($1,$2) $$;
    `);
    await query("INSERT INTO staff_users VALUES($1,true,$3,'經理',NULL,NULL),($2,true,$3,'鄧錦雄',NULL,NULL),($4,true,$5,'別區職員',NULL,NULL)", [id(1),id(2),id(3),id(4),id(5)]);
    await query("INSERT INTO staff_roles VALUES($1,'manager')",[id(1)]);
    await query("INSERT INTO inquiries VALUES($1,'whatsapp',2,'A074714',true,false,$2,$2,$3,'{}')",[id(10),id(2),id(20)]);
    await query("INSERT INTO whatsapp_enquiry_reference_links VALUES($1,'28hse','4033349','sale','scope-1',$2,$3,now(),$4,0)",[id(10),id(11),id(12),id(13)]);
    await query("INSERT INTO mls_source_state VALUES('28hse_agent_540','scope-1','4033349','sale',$1,'active',now())",[id(20)]);
    await query("INSERT INTO properties VALUES($1,'active','P100','碧堤半島')",[id(20)]);
    await query("INSERT INTO property_public_members VALUES($1,'A074714')",[id(20)]);
    await query("INSERT INTO whatsapp_portal_interpretations VALUES($1,$2::jsonb)",[id(11),JSON.stringify({requestedStaffText:'鄧錦雄 Terence Tang'})]);
    await query("INSERT INTO whatsapp_inbound_receipts VALUES($1,'company-channel')",[id(12)]);
    await query("INSERT INTO whatsapp_portal_source_scopes VALUES('company-channel','28hse_agent_540','scope-1',true,'28hse:staff')");
    await query("INSERT INTO staff_external_references VALUES('28hse:staff','鄧錦雄 Terence Tang',now()-interval '1 day',NULL,now()-interval '1 day',$1)",[id(2)]);
    const visible = await readEnquiryResolutionContext({staffId:id(1)},id(10),query);
    assert.equal(visible.version,2);
    assert.deepEqual(visible.references.map((r)=>r.externalListingId),['4033349']);
    assert.deepEqual(visible.propertyCandidates.map((x)=>x.id),[id(20)]);
    assert.deepEqual(visible.requestedStaffCandidates.map((x)=>x.id),[id(2)]);
    assert.ok(!visible.ownerCandidates.some((x)=>x.id===id(4)));
    await assert.rejects(readEnquiryResolutionContext({staffId:id(4)},id(10),query), (e)=>e.status===403);
    await query("UPDATE inquiries SET enquiry_resolution='{\"propertyId\":null}'::jsonb");
    const cleared = await readEnquiryResolutionContext({staffId:id(1)},id(10),query);
    assert.equal(cleared.propertyId,null);
    await query("UPDATE mls_source_state SET last_accepted_at=now()-interval '40 days'");
    await query("UPDATE staff_external_references SET valid_until=now()-interval '1 minute'");
    const stale = await readEnquiryResolutionContext({staffId:id(1)},id(10),query);
    assert.equal(stale.propertyCandidates.length,0);
    assert.equal(stale.requestedStaffCandidates.length,0);
  } finally { await db.close(); }
});
