export interface MboxFile {
  name: string;
  path: string;
  size: number;
  modified: string;
  emailCount: number;
}

export interface FolderNode {
  name: string;
  path: string;
  grey: boolean;
  children: FolderNode[];
  mboxes: MboxFile[];
  mboxCount: number;
}

export interface AccountTree {
  name: string;
  type: string;
  children: FolderNode[];
  totalEmails: number;
}

export interface ThunderbirdProfile {
  name: string;
  path: string;
  trees: AccountTree[];
  totalEmails: number;
}

export interface ParsedEmail {
  subject: string;
  from: string;
  to: string;
  date: string;
  messageId: string;
  body: string;
  isInternal: boolean;
  isSentByUser: boolean;
}

export interface DiscoverResult {
  error?: string;
  path: string;
  profiles: ThunderbirdProfile[];
}

export interface ReadMboxResult {
  success: boolean;
  emails?: ParsedEmail[];
  total?: number;
  error?: string;
}

declare global {
  interface Window {
    electronAPI: {
      thunderbird: {
        discover: () => Promise<DiscoverResult>;
        readMbox: (mboxPath: string, maxEmails?: number) => Promise<ReadMboxResult>;
      };
    };
  }
}
