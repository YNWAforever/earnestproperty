import assert from 'node:assert/strict';
import test from 'node:test';
import { validateForwardedEnquiry } from './forwarded-enquiries.ts';
const base={requestId:'00000000-0000-4000-8000-000000000020',text:'朋友轉來的查詢',businessSource:'朋友轉介',sourceUrl:null,originalCustomerContact:null,originalReceivedAt:null,note:null,followUpTitle:null,followUpDueAt:null,responsibleStaffId:null};
test('forwarded enquiry needs original text and business source; contact stays unverified',()=>{
 assert.equal(validateForwardedEnquiry(base).text,base.text);
 assert.throws(()=>validateForwardedEnquiry({...base,text:' '}));
 assert.throws(()=>validateForwardedEnquiry({...base,businessSource:''}));
 assert.throws(()=>validateForwardedEnquiry({...base,sourceUrl:'javascript:alert(1)'}));
 assert.throws(()=>validateForwardedEnquiry({...base,followUpTitle:'致電'}));
 assert.equal(validateForwardedEnquiry({...base,originalCustomerContact:' 61234567 '}).originalCustomerContact,'61234567');
});
