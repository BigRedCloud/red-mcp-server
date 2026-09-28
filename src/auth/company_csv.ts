import { parse } from "csv-parse/sync";

export const COMPANY_CSV_MAX_BYTES = 1024 * 1024;
export const SSO_MAX_COMPANIES = 5;
// Only deliberately authored messages from this class may reach the customer.
export class CompanyInputError extends Error {}

const nameColumns = ["companyName", "CompanyName", "company", "Company", "Company Name"];
const keyColumns = ["apiKey", "ApiKey", "api_key", "APIKey", "API Key"];

/** Legacy parsing is preserved; authenticated uploads opt into strict limits. */
export function parseCompanyCsv(buffer: Buffer, strict = false): { companyName: string; apiKey: string }[] {
  if (strict && buffer.length > COMPANY_CSV_MAX_BYTES) {
    throw new CompanyInputError("The CSV file is too large. Choose a file no larger than 1 MB.");
  }
  try {
    const rows = parse(buffer, {
      columns: strict ? (columns: string[]) => {
        if (columns.length !== 2 || columns.filter(c => nameColumns.includes(c)).length !== 1 ||
            columns.filter(c => keyColumns.includes(c)).length !== 1) {
          throw new CompanyInputError("Use a CSV with just the companyName and apiKey columns.");
        }
        return columns;
      } : true,
      skip_empty_lines: true,
      trim: true,
      ...(strict ? { bom: true, max_record_size: 8192 } : {}),
    }) as Array<Record<string, string>>;
    if (strict && rows.length > SSO_MAX_COMPANIES) {
      throw new CompanyInputError("Connect up to five companies at a time. Reduce the number of CSV rows and try again.");
    }
    const companies = rows.map(row => ({
      companyName: String(nameColumns.map(c => row[c]).find(v => v != null) ?? "").trim(),
      apiKey: String(keyColumns.map(c => row[c]).find(v => v != null) ?? "").trim(),
    }));
    if (strict && (!companies.length || companies.some(c => !c.companyName || !c.apiKey ||
        c.companyName.length > 200 || c.apiKey.length > 4096 || /[\u0000-\u001f\u007f]/.test(c.companyName + c.apiKey)))) {
      throw new CompanyInputError("Each CSV row needs a company name (up to 200 characters) and an API key (up to 4096 characters).");
    }
    return companies.filter(c => c.companyName && c.apiKey);
  } catch (error) {
    if (!strict || error instanceof CompanyInputError) throw error;
    // csv-parse errors can contain credential-bearing records. Never expose them.
    throw new CompanyInputError("The CSV could not be read. Check the two columns and quoting, then try again.");
  }
}
