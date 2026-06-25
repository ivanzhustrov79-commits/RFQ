import type { Supplier, RFQ, Email, Alarm, Exception, PartNumber, WorkflowStep, ComponentStatus, KpiData } from '@/types';

export const workflowSteps: WorkflowStep[] = [
  { id: 0, stepKey: 'PR', stepName: 'PR', displayOrder: 0, expectedDays: 3, gradientFrom: '#3498DB', gradientTo: '#2980B9' },
  { id: 1, stepKey: 'RFQ', stepName: 'RFQ', displayOrder: 1, expectedDays: 7, gradientFrom: '#9B5BAF', gradientTo: '#7B3F9B' },
  { id: 2, stepKey: 'CI', stepName: 'CI', displayOrder: 2, expectedDays: 10, gradientFrom: '#E67E22', gradientTo: '#D35400' },
  { id: 3, stepKey: 'DOWNPAYMENT', stepName: 'Downpayment', displayOrder: 3, expectedDays: 5, gradientFrom: '#16A085', gradientTo: '#0E6655' },
];

export const suppliers: Supplier[] = [
  { id: 1, name: 'Promkomplekt LLC', emailDomain: 'promkomplekt.ru', thunderbirdFolder: 'promkomplekt', contactEmail: 'sales@promkomplekt.ru', defaultCurrency: 'RUB', openRfqCount: 4 },
  { id: 2, name: 'MetallServis Group', emailDomain: 'metallservis.ru', thunderbirdFolder: 'metallservis', contactEmail: 'quotes@metallservis.ru', defaultCurrency: 'RUB', openRfqCount: 3 },
  { id: 3, name: 'Field-Pro Equipment', emailDomain: 'field-pro.ae', thunderbirdFolder: 'fieldpro', contactEmail: 'info@field-pro.ae', defaultCurrency: 'USD', openRfqCount: 2 },
  { id: 4, name: 'AgroPro Supply', emailDomain: 'agro-pro2014.ru', thunderbirdFolder: 'agropro', contactEmail: 'vlebedinets@agro-pro2014.ru', defaultCurrency: 'RUB', openRfqCount: 5 },
  { id: 5, name: 'EuroParts GmbH', emailDomain: 'europarts.de', thunderbirdFolder: 'europarts', contactEmail: 'export@europarts.de', defaultCurrency: 'EUR', openRfqCount: 2 },
  { id: 6, name: 'Import Detal 36', emailDomain: 'import-detal36.ru', thunderbirdFolder: 'importdetal', contactEmail: 'izhustrov@import-detal36.ru', defaultCurrency: 'RUB', openRfqCount: 0 },
];

export const rfqs: RFQ[] = [
  { id: 1, supplierId: 1, rfqName: 'Hydraulic cylinder seals HCS-2400', rfqNameSource: 'auto', ciNumber: 'CI-2026-0841', currentStep: 2, status: 'Open', sourceLanguage: 'en', translatedName: null, confidenceScore: 0.92, alarmCount: 0, createdAt: '2026-05-10T08:30:00', updatedAt: '2026-05-26T14:22:00' },
  { id: 2, supplierId: 1, rfqName: 'Bearing housings BH-450 series', rfqNameSource: 'auto', ciNumber: 'CI-2026-0903', currentStep: 3, status: 'Open', sourceLanguage: 'en', translatedName: null, confidenceScore: 0.88, alarmCount: 1, createdAt: '2026-05-05T11:15:00', updatedAt: '2026-05-25T09:45:00' },
  { id: 3, supplierId: 1, rfqName: 'Pneumatic valves PV-120 kit', rfqNameSource: 'manual', ciNumber: null, currentStep: 0, status: 'Pending', sourceLanguage: 'en', translatedName: null, confidenceScore: 0.65, alarmCount: 0, createdAt: '2026-05-27T07:00:00', updatedAt: '2026-05-27T07:00:00' },
  { id: 4, supplierId: 1, rfqName: 'Oil filter elements OFE-900', rfqNameSource: 'auto', ciNumber: 'CI-2026-0955', currentStep: 4, status: 'Open', sourceLanguage: 'en', translatedName: null, confidenceScore: 0.95, alarmCount: 1, createdAt: '2026-04-28T16:45:00', updatedAt: '2026-05-24T11:30:00' },
  { id: 5, supplierId: 2, rfqName: 'Steel grade S355 plates 20mm', rfqNameSource: 'auto', ciNumber: 'CI-2026-0882', currentStep: 1, status: 'Open', sourceLanguage: 'en', translatedName: null, confidenceScore: 0.90, alarmCount: 0, createdAt: '2026-05-15T10:00:00', updatedAt: '2026-05-26T13:00:00' },
  { id: 6, supplierId: 2, rfqName: 'Aluminum profile AP-4040 extrusion', rfqNameSource: 'auto', ciNumber: 'CI-2026-0917', currentStep: 3, status: 'Open', sourceLanguage: 'en', translatedName: null, confidenceScore: 0.85, alarmCount: 1, createdAt: '2026-05-08T09:30:00', updatedAt: '2026-05-25T16:20:00' },
  { id: 7, supplierId: 2, rfqName: 'Stainless bolts M16x80 DIN 933', rfqNameSource: 'auto', ciNumber: null, currentStep: 0, status: 'Pending', sourceLanguage: 'en', translatedName: null, confidenceScore: 0.72, alarmCount: 0, createdAt: '2026-05-27T06:15:00', updatedAt: '2026-05-27T06:15:00' },
  { id: 8, supplierId: 3, rfqName: 'Pump assembly PA-300 replacement kit', rfqNameSource: 'auto', ciNumber: 'CI-2026-0870', currentStep: 2, status: 'Open', sourceLanguage: 'en', translatedName: null, confidenceScore: 0.91, alarmCount: 0, createdAt: '2026-05-12T14:00:00', updatedAt: '2026-05-26T10:45:00' },
  { id: 9, supplierId: 3, rfqName: 'Motor coupling MC-150 flexible', rfqNameSource: 'auto', ciNumber: 'CI-2026-0934', currentStep: 5, status: 'Approved', sourceLanguage: 'en', translatedName: null, confidenceScore: 0.97, alarmCount: 0, createdAt: '2026-04-20T08:00:00', updatedAt: '2026-05-22T15:30:00' },
  { id: 10, supplierId: 4, rfqName: 'Conveyor belt CB-800 rubber', rfqNameSource: 'auto', ciNumber: 'CI-2026-0895', currentStep: 2, status: 'Open', sourceLanguage: 'en', translatedName: null, confidenceScore: 0.89, alarmCount: 0, createdAt: '2026-05-14T11:30:00', updatedAt: '2026-05-26T12:00:00' },
  { id: 11, supplierId: 4, rfqName: 'Gearbox reducer GR-75 1:50', rfqNameSource: 'auto', ciNumber: 'CI-2026-0948', currentStep: 3, status: 'Open', sourceLanguage: 'en', translatedName: null, confidenceScore: 0.83, alarmCount: 1, createdAt: '2026-05-06T07:45:00', updatedAt: '2026-05-25T14:00:00' },
  { id: 12, supplierId: 4, rfqName: 'Drive chain DC-20B duplex', rfqNameSource: 'auto', ciNumber: null, currentStep: 1, status: 'Open', sourceLanguage: 'en', translatedName: null, confidenceScore: 0.78, alarmCount: 0, createdAt: '2026-05-18T09:00:00', updatedAt: '2026-05-26T08:30:00' },
  { id: 13, supplierId: 4, rfqName: 'Safety switch SS-220 IP67', rfqNameSource: 'manual', ciNumber: 'CI-2026-0971', currentStep: 4, status: 'Open', sourceLanguage: 'en', translatedName: null, confidenceScore: 0.94, alarmCount: 1, createdAt: '2026-05-01T13:15:00', updatedAt: '2026-05-24T09:00:00' },
  { id: 14, supplierId: 4, rfqName: 'PLC module S7-1200 CPU 1214C', rfqNameSource: 'auto', ciNumber: 'CI-2026-0989', currentStep: 0, status: 'Pending', sourceLanguage: 'en', translatedName: null, confidenceScore: 0.68, alarmCount: 0, createdAt: '2026-05-27T05:30:00', updatedAt: '2026-05-27T05:30:00' },
  { id: 15, supplierId: 5, rfqName: 'Hydraulic hose HH-16-2500mm', rfqNameSource: 'auto', ciNumber: 'CI-2026-0921', currentStep: 2, status: 'Open', sourceLanguage: 'en', translatedName: null, confidenceScore: 0.87, alarmCount: 0, createdAt: '2026-05-09T10:30:00', updatedAt: '2026-05-26T11:15:00' },
  { id: 16, supplierId: 5, rfqName: 'Pressure gauge PG-100 0-250 bar', rfqNameSource: 'auto', ciNumber: null, currentStep: 0, status: 'Pending', sourceLanguage: 'en', translatedName: null, confidenceScore: 0.71, alarmCount: 0, createdAt: '2026-05-27T04:00:00', updatedAt: '2026-05-27T04:00:00' },
];

export const emails: Email[] = [
  { id: 1, rfqId: 1, supplierId: 1, messageId: '<msg-001@promkomplekt.ru>', subject: 'Re: RFQ Hydraulic cylinder seals HCS-2400', senderEmail: 'sales@promkomplekt.ru', senderName: 'Promkomplekt Sales', sentAt: '2026-05-26T14:22:00', stepAssigned: 2, isInternal: false, isSentByUser: false, threadConfidence: 1.0, hasConflict: false, baseSuggestedStep: 2, smartConfirmedStep: 2, isLowConfidence: false, isProvisional: false },
  { id: 2, rfqId: 1, supplierId: 1, messageId: '<msg-002@import-detal36.ru>', subject: 'RFQ Hydraulic cylinder seals HCS-2400', senderEmail: 'izhustrov@import-detal36.ru', senderName: 'Igor Zhustrov', sentAt: '2026-05-10T08:30:00', stepAssigned: 2, isInternal: false, isSentByUser: true, threadConfidence: 1.0, hasConflict: false, baseSuggestedStep: null, smartConfirmedStep: null, isLowConfidence: false, isProvisional: false },
  { id: 3, rfqId: 2, supplierId: 1, messageId: '<msg-003@promkomplekt.ru>', subject: 'Re: RFQ Bearing housings BH-450 series', senderEmail: 'sales@promkomplekt.ru', senderName: 'Promkomplekt Sales', sentAt: '2026-05-25T09:45:00', stepAssigned: 3, isInternal: false, isSentByUser: false, threadConfidence: 0.92, hasConflict: false, baseSuggestedStep: 3, smartConfirmedStep: 3, isLowConfidence: false, isProvisional: false },
  { id: 4, rfqId: 2, supplierId: 1, messageId: '<msg-004@import-detal36.ru>', subject: 'Bearing housings BH-450 — price check', senderEmail: 'izhustrov@import-detal36.ru', senderName: 'Igor Zhustrov', sentAt: '2026-05-20T11:00:00', stepAssigned: 3, isInternal: false, isSentByUser: true, threadConfidence: 0.88, hasConflict: false, baseSuggestedStep: null, smartConfirmedStep: null, isLowConfidence: false, isProvisional: false },
  { id: 5, rfqId: 2, supplierId: 1, messageId: '<msg-005@promkomplekt.ru>', subject: 'RE: Bearing housings BH-450 — discount available', senderEmail: 'sales@promkomplekt.ru', senderName: 'Promkomplekt Sales', sentAt: '2026-05-22T16:30:00', stepAssigned: 3, isInternal: false, isSentByUser: false, threadConfidence: 0.95, hasConflict: true, baseSuggestedStep: 2, smartConfirmedStep: 3, isLowConfidence: false, isProvisional: false },
  { id: 6, rfqId: 3, supplierId: 1, messageId: '<msg-006@field-pro.ae>', subject: 'Purchase Request: Pneumatic valves PV-120 kit', senderEmail: 'info@field-pro.ae', senderName: 'Field-Pro Manager', sentAt: '2026-05-27T07:00:00', stepAssigned: 0, isInternal: true, isSentByUser: false, threadConfidence: 1.0, hasConflict: false, baseSuggestedStep: 0, smartConfirmedStep: 0, isLowConfidence: false, isProvisional: false },
  { id: 7, rfqId: 4, supplierId: 1, messageId: '<msg-007@promkomplekt.ru>', subject: 'Invoice: Oil filter elements OFE-900', senderEmail: 'billing@promkomplekt.ru', senderName: 'Promkomplekt Billing', sentAt: '2026-05-24T11:30:00', stepAssigned: 4, isInternal: false, isSentByUser: false, threadConfidence: 0.98, hasConflict: false, baseSuggestedStep: 4, smartConfirmedStep: 4, isLowConfidence: false, isProvisional: false },
  { id: 8, rfqId: 4, supplierId: 1, messageId: '<msg-008@import-detal36.ru>', subject: 'Re: Oil filter elements OFE-900 — approved', senderEmail: 'izhustrov@import-detal36.ru', senderName: 'Igor Zhustrov', sentAt: '2026-05-24T13:00:00', stepAssigned: 4, isInternal: false, isSentByUser: true, threadConfidence: 0.95, hasConflict: false, baseSuggestedStep: null, smartConfirmedStep: null, isLowConfidence: false, isProvisional: false },
  { id: 9, rfqId: 5, supplierId: 2, messageId: '<msg-009@import-detal36.ru>', subject: 'RFQ Steel grade S355 plates 20mm', senderEmail: 'izhustrov@import-detal36.ru', senderName: 'Igor Zhustrov', sentAt: '2026-05-15T10:00:00', stepAssigned: 1, isInternal: false, isSentByUser: true, threadConfidence: 1.0, hasConflict: false, baseSuggestedStep: null, smartConfirmedStep: null, isLowConfidence: false, isProvisional: false },
  { id: 10, rfqId: 5, supplierId: 2, messageId: '<msg-010@metallservis.ru>', subject: 'Re: Steel grade S355 plates 20mm — awaiting quote', senderEmail: 'quotes@metallservis.ru', senderName: 'MetallServis Quotes', sentAt: '2026-05-26T13:00:00', stepAssigned: 1, isInternal: false, isSentByUser: false, threadConfidence: 0.90, hasConflict: false, baseSuggestedStep: 1, smartConfirmedStep: 1, isLowConfidence: false, isProvisional: false },
  { id: 11, rfqId: 6, supplierId: 2, messageId: '<msg-011@metallservis.ru>', subject: 'Re: Aluminum profile AP-4040 — revised pricing', senderEmail: 'quotes@metallservis.ru', senderName: 'MetallServis Quotes', sentAt: '2026-05-25T16:20:00', stepAssigned: 3, isInternal: false, isSentByUser: false, threadConfidence: 0.94, hasConflict: false, baseSuggestedStep: 3, smartConfirmedStep: 3, isLowConfidence: false, isProvisional: false },
  { id: 12, rfqId: 7, supplierId: 2, messageId: '<msg-012@field-pro.ae>', subject: 'PR: Stainless bolts M16x80 DIN 933', senderEmail: 'info@field-pro.ae', senderName: 'Field-Pro Manager', sentAt: '2026-05-27T06:15:00', stepAssigned: 0, isInternal: true, isSentByUser: false, threadConfidence: 1.0, hasConflict: false, baseSuggestedStep: 0, smartConfirmedStep: 0, isLowConfidence: false, isProvisional: false },
  { id: 13, rfqId: 8, supplierId: 3, messageId: '<msg-013@field-pro.ae>', subject: 'Pump assembly PA-300 — field report attached', senderEmail: 'info@field-pro.ae', senderName: 'Field-Pro Manager', sentAt: '2026-05-12T14:00:00', stepAssigned: 2, isInternal: true, isSentByUser: false, threadConfidence: 1.0, hasConflict: false, baseSuggestedStep: 2, smartConfirmedStep: 2, isLowConfidence: false, isProvisional: false },
  { id: 14, rfqId: 9, supplierId: 3, messageId: '<msg-014@import-detal36.ru>', subject: 'Motor coupling MC-150 — proceed with order', senderEmail: 'izhustrov@import-detal36.ru', senderName: 'Igor Zhustrov', sentAt: '2026-05-22T15:30:00', stepAssigned: 5, isInternal: false, isSentByUser: true, threadConfidence: 1.0, hasConflict: false, baseSuggestedStep: null, smartConfirmedStep: null, isLowConfidence: false, isProvisional: false },
  { id: 15, rfqId: 10, supplierId: 4, messageId: '<msg-015@agro-pro2014.ru>', subject: 'Re: Conveyor belt CB-800 — delivery update', senderEmail: 'vlebedinets@agro-pro2014.ru', senderName: 'Viktor Lebedinets', sentAt: '2026-05-26T12:00:00', stepAssigned: 2, isInternal: false, isSentByUser: false, threadConfidence: 0.96, hasConflict: false, baseSuggestedStep: 2, smartConfirmedStep: 2, isLowConfidence: false, isProvisional: false },
  { id: 16, rfqId: 10, supplierId: 4, messageId: '<msg-016@import-detal36.ru>', subject: 'RFQ Conveyor belt CB-800 rubber', senderEmail: 'izhustrov@import-detal36.ru', senderName: 'Igor Zhustrov', sentAt: '2026-05-14T11:30:00', stepAssigned: 2, isInternal: false, isSentByUser: true, threadConfidence: 1.0, hasConflict: false, baseSuggestedStep: null, smartConfirmedStep: null, isLowConfidence: false, isProvisional: false },
  { id: 17, rfqId: 11, supplierId: 4, messageId: '<msg-017@agro-pro2014.ru>', subject: 'Re: Gearbox reducer GR-75 — technical spec', senderEmail: 'vlebedinets@agro-pro2014.ru', senderName: 'Viktor Lebedinets', sentAt: '2026-05-25T14:00:00', stepAssigned: 3, isInternal: false, isSentByUser: false, threadConfidence: 0.91, hasConflict: false, baseSuggestedStep: 3, smartConfirmedStep: 3, isLowConfidence: false, isProvisional: false },
  { id: 18, rfqId: 12, supplierId: 4, messageId: '<msg-018@import-detal36.ru>', subject: 'RFQ Drive chain DC-20B duplex', senderEmail: 'izhustrov@import-detal36.ru', senderName: 'Igor Zhustrov', sentAt: '2026-05-18T09:00:00', stepAssigned: 1, isInternal: false, isSentByUser: true, threadConfidence: 1.0, hasConflict: false, baseSuggestedStep: null, smartConfirmedStep: null, isLowConfidence: false, isProvisional: false },
  { id: 19, rfqId: 13, supplierId: 4, messageId: '<msg-019@agro-pro2014.ru>', subject: 'Proforma: Safety switch SS-220 IP67', senderEmail: 'billing@agro-pro2014.ru', senderName: 'AgroPro Billing', sentAt: '2026-05-24T09:00:00', stepAssigned: 4, isInternal: false, isSentByUser: false, threadConfidence: 0.97, hasConflict: false, baseSuggestedStep: 4, smartConfirmedStep: 4, isLowConfidence: false, isProvisional: false },
  { id: 20, rfqId: 14, supplierId: 4, messageId: '<msg-020@field-pro.ae>', subject: 'Purchase Request: PLC module S7-1200', senderEmail: 'info@field-pro.ae', senderName: 'Field-Pro Manager', sentAt: '2026-05-27T05:30:00', stepAssigned: 0, isInternal: true, isSentByUser: false, threadConfidence: 1.0, hasConflict: false, baseSuggestedStep: 0, smartConfirmedStep: 0, isLowConfidence: false, isProvisional: false },
  { id: 21, rfqId: 15, supplierId: 5, messageId: '<msg-021@europarts.de>', subject: 'Re: RFQ Hydraulic hose HH-16-2500mm', senderEmail: 'export@europarts.de', senderName: 'EuroParts Export', sentAt: '2026-05-26T11:15:00', stepAssigned: 2, isInternal: false, isSentByUser: false, threadConfidence: 0.93, hasConflict: false, baseSuggestedStep: 2, smartConfirmedStep: 2, isLowConfidence: false, isProvisional: false },
  { id: 22, rfqId: 15, supplierId: 5, messageId: '<msg-022@import-detal36.ru>', subject: 'RFQ Hydraulic hose HH-16-2500mm', senderEmail: 'izhustrov@import-detal36.ru', senderName: 'Igor Zhustrov', sentAt: '2026-05-09T10:30:00', stepAssigned: 2, isInternal: false, isSentByUser: true, threadConfidence: 1.0, hasConflict: false, baseSuggestedStep: null, smartConfirmedStep: null, isLowConfidence: false, isProvisional: false },
  { id: 23, rfqId: 16, supplierId: 5, messageId: '<msg-023@field-pro.ae>', subject: 'PR: Pressure gauge PG-100 0-250 bar', senderEmail: 'info@field-pro.ae', senderName: 'Field-Pro Manager', sentAt: '2026-05-27T04:00:00', stepAssigned: 0, isInternal: true, isSentByUser: false, threadConfidence: 1.0, hasConflict: false, baseSuggestedStep: 0, smartConfirmedStep: 0, isLowConfidence: false, isProvisional: false },
  { id: 24, rfqId: 4, supplierId: 1, messageId: '<msg-024@promkomplekt.ru>', subject: 'Oil filter elements — price anomaly detected', senderEmail: 'sales@promkomplekt.ru', senderName: 'Promkomplekt Sales', sentAt: '2026-05-20T09:00:00', stepAssigned: 4, isInternal: false, isSentByUser: false, threadConfidence: 0.82, hasConflict: false, baseSuggestedStep: 4, smartConfirmedStep: 4, isLowConfidence: true, isProvisional: true },
  { id: 25, rfqId: 11, supplierId: 4, messageId: '<msg-025@agro-pro2014.ru>', subject: 'Re: Gearbox reducer — waiting for approval', senderEmail: 'vlebedinets@agro-pro2014.ru', senderName: 'Viktor Lebedinets', sentAt: '2026-05-20T10:00:00', stepAssigned: 3, isInternal: false, isSentByUser: false, threadConfidence: 0.85, hasConflict: false, baseSuggestedStep: 3, smartConfirmedStep: 3, isLowConfidence: true, isProvisional: false },
];

export const alarms: Alarm[] = [
  { id: 1, rfqId: 2, alarmType: 'No Response', urgency: 'High', reason: 'No quote received after 5 days', isActive: true, dismissedUntil: null, createdAt: '2026-05-22T00:00:00' },
  { id: 2, rfqId: 4, alarmType: 'CI Missing', urgency: 'High', reason: 'CI number not assigned yet', isActive: true, dismissedUntil: null, createdAt: '2026-05-24T00:00:00' },
  { id: 3, rfqId: 6, alarmType: 'Price Anomaly', urgency: 'Medium', reason: 'Quote exceeds previous by 25%', isActive: true, dismissedUntil: null, createdAt: '2026-05-25T00:00:00' },
  { id: 4, rfqId: 11, alarmType: 'Stalled RFQ', urgency: 'Medium', reason: 'No activity for 10 days', isActive: true, dismissedUntil: null, createdAt: '2026-05-26T00:00:00' },
  { id: 5, rfqId: 13, alarmType: 'Overdue Step', urgency: 'Low', reason: 'Step 4 expected within 7 days', isActive: true, dismissedUntil: null, createdAt: '2026-05-24T00:00:00' },
  { id: 6, rfqId: 5, alarmType: 'No Response', urgency: 'High', reason: 'No response for 11 days', isActive: true, dismissedUntil: null, createdAt: '2026-05-26T00:00:00' },
  { id: 7, rfqId: 6, alarmType: 'Stalled RFQ', urgency: 'Medium', reason: 'No updates for 8 days', isActive: true, dismissedUntil: null, createdAt: '2026-05-25T00:00:00' },
  { id: 8, rfqId: 1, alarmType: 'Unresolved Exception', urgency: 'Medium', reason: 'Attachment processing failed', isActive: true, dismissedUntil: null, createdAt: '2026-05-26T00:00:00' },
  { id: 9, rfqId: 2, alarmType: 'Overdue Step', urgency: 'Low', reason: 'Negotiation exceeds 14-day target', isActive: false, dismissedUntil: '2026-05-28T00:00:00', createdAt: '2026-05-20T00:00:00' },
  { id: 10, rfqId: 15, alarmType: 'CI Missing', urgency: 'High', reason: 'Pending CI assignment', isActive: true, dismissedUntil: null, createdAt: '2026-05-26T00:00:00' },
];

export const exceptions: Exception[] = [
  { id: 1, emailId: 24, emailSubject: 'Oil filter elements — price anomaly detected', reason: 'OCR confidence below threshold (0.42)', aiSuggestion: 'Request supplier resend PDF in higher quality', createdAt: '2026-05-20T09:00:00' },
  { id: 2, emailId: 25, emailSubject: 'Re: Gearbox reducer — waiting for approval', reason: 'Low confidence classification (0.38)', aiSuggestion: 'Manual review recommended — ambiguous language', createdAt: '2026-05-20T10:00:00' },
  { id: 3, emailId: 3, emailSubject: 'Pneumatic valves PV-120 kit', reason: 'New supplier auto-detected, needs confirmation', aiSuggestion: 'Verify supplier domain and folder mapping', createdAt: '2026-05-27T07:00:00' },
  { id: 4, emailId: 7, emailSubject: 'Invoice: Oil filter elements OFE-900', reason: 'CI number mismatch detected', aiSuggestion: 'Cross-reference with accounting system', createdAt: '2026-05-24T11:30:00' },
  { id: 5, emailId: 17, emailSubject: 'Re: Gearbox reducer GR-75 — technical spec', reason: 'Thread resolution ambiguity (0.62 confidence)', aiSuggestion: 'Check for related emails with similar subjects', createdAt: '2026-05-25T14:00:00' },
  { id: 6, emailId: 10, emailSubject: 'Re: Steel grade S355 plates 20mm — awaiting quote', reason: 'Sent folder match failed', aiSuggestion: 'Verify RFQ was sent to correct supplier', createdAt: '2026-05-26T13:00:00' },
];

export const parts: PartNumber[] = [
  { id: 1, rfqId: 1, supplierId: 1, partNumber: 'HCS-2400-S', description: 'Hydraulic cylinder seal kit, standard', quantity: 24, price: 1850.00, currency: 'RUB', isBestPrice: true, quotedAt: '2026-05-26T14:22:00' },
  { id: 2, rfqId: 1, supplierId: 1, partNumber: 'HCS-2400-H', description: 'Hydraulic cylinder seal, heavy duty', quantity: 8, price: 3200.00, currency: 'RUB', isBestPrice: false, quotedAt: '2026-05-26T14:22:00' },
  { id: 3, rfqId: 2, supplierId: 1, partNumber: 'BH-450-SL', description: 'Bearing housing, split type, large', quantity: 12, price: 5600.00, currency: 'RUB', isBestPrice: true, quotedAt: '2026-05-25T09:45:00' },
  { id: 4, rfqId: 2, supplierId: 1, partNumber: 'BH-450-SS', description: 'Bearing housing, split type, small', quantity: 20, price: 3800.00, currency: 'RUB', isBestPrice: true, quotedAt: '2026-05-25T09:45:00' },
  { id: 5, rfqId: 5, supplierId: 2, partNumber: 'S355-20-2000', description: 'Steel plate S355, 20mm x 2000x6000', quantity: 6, price: 42000.00, currency: 'RUB', isBestPrice: true, quotedAt: '2026-05-15T10:00:00' },
  { id: 6, rfqId: 6, supplierId: 2, partNumber: 'AP-4040-6000', description: 'Aluminum profile 40x40, 6000mm', quantity: 50, price: 850.00, currency: 'RUB', isBestPrice: true, quotedAt: '2026-05-25T16:20:00' },
  { id: 7, rfqId: 8, supplierId: 3, partNumber: 'PA-300-KIT', description: 'Pump assembly replacement kit', quantity: 2, price: 1450.00, currency: 'USD', isBestPrice: true, quotedAt: '2026-05-12T14:00:00' },
  { id: 8, rfqId: 9, supplierId: 3, partNumber: 'MC-150-FL', description: 'Motor coupling, flexible, 150mm', quantity: 4, price: 320.00, currency: 'USD', isBestPrice: true, quotedAt: '2026-05-22T15:30:00' },
  { id: 9, rfqId: 10, supplierId: 4, partNumber: 'CB-800-RB', description: 'Conveyor belt, rubber, 800mm width', quantity: 15, price: 12500.00, currency: 'RUB', isBestPrice: true, quotedAt: '2026-05-26T12:00:00' },
  { id: 10, rfqId: 11, supplierId: 4, partNumber: 'GR-75-1:50', description: 'Gearbox reducer, 75mm, ratio 1:50', quantity: 3, price: 28500.00, currency: 'RUB', isBestPrice: true, quotedAt: '2026-05-25T14:00:00' },
  { id: 11, rfqId: 13, supplierId: 4, partNumber: 'SS-220-IP67', description: 'Safety switch, 220V, IP67 rated', quantity: 10, price: 4200.00, currency: 'RUB', isBestPrice: true, quotedAt: '2026-05-24T09:00:00' },
  { id: 12, rfqId: 15, supplierId: 5, partNumber: 'HH-16-2500', description: 'Hydraulic hose, DN16, 2500mm', quantity: 8, price: 68.50, currency: 'EUR', isBestPrice: true, quotedAt: '2026-05-26T11:15:00' },
];

export const componentStatuses: ComponentStatus[] = [
  { name: 'Thunderbird', status: 'online' },
  { name: 'Ollama', status: 'online' },
  { name: 'SQLite', status: 'online' },
  { name: 'Python', status: 'online' },
];

export const getSupplierKpis = (supplierId: number): KpiData => {
  const kpis: Record<number, KpiData> = {
    1: { openRfqs: 4, avgResponseDays: 3.2, quoteSuccessRate: 78, pendingAlarms: 2, lastActivity: '2026-05-26' },
    2: { openRfqs: 3, avgResponseDays: 4.1, quoteSuccessRate: 65, pendingAlarms: 2, lastActivity: '2026-05-26' },
    3: { openRfqs: 2, avgResponseDays: 2.5, quoteSuccessRate: 92, pendingAlarms: 0, lastActivity: '2026-05-26' },
    4: { openRfqs: 5, avgResponseDays: 3.8, quoteSuccessRate: 71, pendingAlarms: 3, lastActivity: '2026-05-26' },
    5: { openRfqs: 2, avgResponseDays: 5.2, quoteSuccessRate: 60, pendingAlarms: 1, lastActivity: '2026-05-26' },
    6: { openRfqs: 0, avgResponseDays: 0, quoteSuccessRate: 0, pendingAlarms: 0, lastActivity: '2026-05-24' },
  };
  return kpis[supplierId] || { openRfqs: 0, avgResponseDays: 0, quoteSuccessRate: 0, pendingAlarms: 0, lastActivity: '—' };
};

export const troubleshootTopics: Record<number, string[]> = {
  1: ['Wrong Step Assignment', 'Duplicate Email', 'Missing Attachment', 'Incorrect Sender', 'Other Issue'],
  2: ['Wrong Supplier Name', 'Domain Mapping Error', 'Folder Path Issue', 'KPI Discrepancy', 'Other Issue'],
  3: ['Wrong CI Number', 'Rename RFQ', 'Merge with Another RFQ', 'Split RFQ', 'Other Issue'],
  4: ['Wrong Price', 'Wrong Part Number', 'Wrong Quantity', 'Wrong Delivery Time', 'Other Issue'],
};
