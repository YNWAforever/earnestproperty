import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const migration = new URL('../../../neon/migrations/20260929106000_whatsapp_enquiry_resolution_guard.sql', import.meta.url);

test('no-link requested staff override requires the current exact verified alias', async () => {
  const db = new PGlite();
  const query = async (sql,params=[]) => (await db.query(sql,params)).rows;
  try {
    await db.exec(`CREATE TABLE inquiries(id uuid PRIMARY KEY,source text,enquiry_resolution jsonb);
      CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean);
      CREATE TABLE whatsapp_enquiry_reference_links(inquiry_id uuid,source text,scope_id text,
        interpretation_id uuid,receipt_id uuid);
      CREATE TABLE whatsapp_portal_interpretations(id uuid PRIMARY KEY,interpretation jsonb);
      CREATE TABLE whatsapp_inbound_receipts(id uuid PRIMARY KEY,channel_id text);
      CREATE TABLE whatsapp_portal_source_scopes(channel_id text,source text,scope_id text,
        enabled boolean,staff_namespace text);
      CREATE TABLE staff_external_references(namespace text,external_reference text,staff_id uuid,
        valid_from timestamptz,valid_until timestamptz,verified_at timestamptz);`);
    await db.exec(readFileSync(migration,'utf8'));
    await query("INSERT INTO inquiries VALUES($1,'whatsapp','{}')",[id(1)]);
    await query("INSERT INTO staff_users VALUES($1,true),($2,true)",[id(2),id(3)]);
    await query("INSERT INTO whatsapp_enquiry_reference_links VALUES($1,'28hse','scope-1',$2,$3)",[id(1),id(4),id(5)]);
    await query("INSERT INTO whatsapp_portal_interpretations VALUES($1,$2::jsonb)",[id(4),JSON.stringify({requestedStaffText:'鄧錦雄 Terence Tang'})]);
    await query("INSERT INTO whatsapp_inbound_receipts VALUES($1,'channel-1')",[id(5)]);
    await query("INSERT INTO whatsapp_portal_source_scopes VALUES('channel-1','28hse_agent_540','scope-1',true,'28hse:staff')");
    const change = (staff) => query('UPDATE inquiries SET enquiry_resolution=$2::jsonb WHERE id=$1',
      [id(1),JSON.stringify({requestedStaffId:staff})]);
    await assert.rejects(change(id(2)),/WA_ENQUIRY_STAFF_MAPPING_STALE/);
    await query("INSERT INTO staff_external_references VALUES('28hse:staff','鄧錦雄 Terence Tang',$1,now()-interval '1 day',NULL,now()-interval '1 day')",[id(2)]);
    await assert.rejects(change(id(3)),/WA_ENQUIRY_STAFF_MAPPING_STALE/);
    await change(id(2));
    assert.equal((await query('SELECT enquiry_resolution FROM inquiries WHERE id=$1',[id(1)]))[0].enquiry_resolution.requestedStaffId,id(2));
    await query("UPDATE staff_external_references SET valid_until=now()-interval '1 minute'");
    await assert.rejects(change(id(3)),/WA_ENQUIRY_STAFF_MAPPING_STALE/);
  } finally { await db.close(); }
});
