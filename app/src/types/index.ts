export interface Supplier {
  id: number;
  name: string;
  emailDomain: string;
  thunderbirdFolder: string;
  contactEmail: string;
  defaultCurrency: string;
  openRfqCount: number;
}

export interface RFQ {
  id: number;
  supplierId: number;
  rfqName: string;
  rfqNameSource: 'auto' | 'manual';
  ciNumber: string | null;
  currentStep: number;
  status: 'Open' | 'Pending' | 'Approved' | 'Closed';
  sourceLanguage: string;
  translatedName: string | null;
  confidenceScore: number | null;
  alarmCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Email {
  id: number;
  rfqId: number;
  supplierId: number;
  messageId: string;
  subject: string;
  senderEmail: string;
  senderName: string;
  sentAt: string;
  stepAssigned: number;
  isInternal: boolean;
  isSentByUser: boolean;
  threadConfidence: number;
  hasConflict: boolean;
  baseSuggestedStep: number | null;
  smartConfirmedStep: number | null;
  isLowConfidence: boolean;
  isProvisional: boolean;
}

export interface Alarm {
  id: number;
  rfqId: number;
  alarmType: 'No Response' | 'Stalled RFQ' | 'CI Missing' | 'Price Anomaly' | 'Overdue Step' | 'Unresolved Exception';
  urgency: 'High' | 'Medium' | 'Low';
  reason: string;
  isActive: boolean;
  dismissedUntil: string | null;
  createdAt: string;
}

export interface Exception {
  id: number;
  emailId: number;
  emailSubject: string;
  reason: string;
  aiSuggestion: string | null;
  createdAt: string;
}

export interface PartNumber {
  id: number;
  rfqId: number;
  supplierId: number;
  partNumber: string;
  description: string;
  quantity: number;
  price: number;
  currency: string;
  isBestPrice: boolean;
  quotedAt: string;
}

export interface WorkflowStep {
  id: number;
  stepKey: string;
  stepName: string;
  displayOrder: number;
  expectedDays: number;
  gradientFrom: string;
  gradientTo: string;
}

export type AiMode = 'BASE' | 'SMART' | 'BOOST';

export type TroubleshootLevel = 1 | 2 | 3 | 4;

export interface ChatMessage {
  id: string;
  role: 'ai' | 'user';
  content: string;
  isStreaming?: boolean;
}

export interface ComponentStatus {
  name: string;
  status: 'online' | 'warning' | 'offline';
}

export interface KpiData {
  openRfqs: number;
  avgResponseDays: number;
  quoteSuccessRate: number;
  pendingAlarms: number;
  lastActivity: string;
}
