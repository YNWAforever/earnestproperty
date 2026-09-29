import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildEnquiryCorrection, emptyResolutionDraft, EnquiryResolutionReview } from './EnquiryResolutionPanel';
const inquiryId = '11111111-1111-4111-8111-111111111111';

test('cancel or unchanged fields prepare no mutation; one enquiry and CAS version are explicit', () => {
  expect(() => buildEnquiryCorrection(inquiryId, 2, emptyResolutionDraft)).toThrow();
  const command = buildEnquiryCorrection(inquiryId, 2, {
    ...emptyResolutionDraft,
    ownerStaffId: '22222222-2222-4222-8222-222222222222',
    reason: ' 已核實指定同事 ',
  });
  expect(command).toEqual({ inquiryId, expectedVersion: 2,
    ownerStaffId: '22222222-2222-4222-8222-222222222222', reason: '已核實指定同事' });
  expect(command).not.toHaveProperty('conversationId');
});
test('explicit clear differs from unchanged and reason is required', () => {
  expect(buildEnquiryCorrection(inquiryId, 3, { ...emptyResolutionDraft,
    requestedStaffId: 'none', reason: '映射已撤銷' })).toEqual({ inquiryId, expectedVersion: 3,
      requestedStaffId: null, reason: '映射已撤銷' });
  expect(() => buildEnquiryCorrection(inquiryId, 3, { ...emptyResolutionDraft,
    ownerStaffId: 'none', reason: 'x' })).toThrow();
});
test('review displays original source, external ID and warns whole-thread assignment is separate', () => {
  const html = renderToStaticMarkup(createElement(EnquiryResolutionReview, { context: {
    inquiryId, version: 2, publicListingNo: 'A074714', associationReview: true,
    providerThreadReview: true, ownerStaffId: null, requestedStaffId: null, propertyId: null,
    references: [{ source: '28hse', externalListingId: '4033349', dealType: 'sale' }],
    ownerCandidates: [], propertyCandidates: [], requestedStaffCandidates: [],
  } }));
  for (const text of ['A074714', '4033349', '28hse', '供應商整段對話負責人仍需核對'])
    expect(html).toContain(text);
  expect(html).not.toContain(inquiryId);
});
