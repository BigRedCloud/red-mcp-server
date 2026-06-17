export type CompanyCredential = {
    companyName: string;
    credentialType: "api_key" | "oauth";
    secret: string;
    expiresAt?: number;
  };
  
  export interface CompanyCredentialProvider {
    getCredential(sessionId: string, companyName: string): Promise<CompanyCredential | null>;
    setCredential(sessionId: string, credential: CompanyCredential): Promise<void>;
    listCompanies(sessionId: string): Promise<string[]>;
    clearCredential(sessionId: string, companyName: string): Promise<void>;
  }