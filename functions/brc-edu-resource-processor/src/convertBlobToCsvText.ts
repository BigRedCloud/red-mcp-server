import ExcelJS from "exceljs";

export type SupportedBrcEduExtension = "csv" | "xlsx";

export function resolveBrcEduBlobExtension(fileName: string): SupportedBrcEduExtension | null {
  const normalized = fileName.trim().toLowerCase();

  if (normalized.endsWith(".csv")) {
    return "csv";
  }

  if (normalized.endsWith(".xlsx")) {
    return "xlsx";
  }

  return null;
}

export function csvBufferToText(buffer: Buffer): string {
  let text = buffer.toString("utf8");

  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  return text;
}

function escapeCsvCell(value: unknown): string {
  if (value == null) {
    return "";
  }

  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

export async function xlsxBufferToCsvText(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    buffer as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0],
  );

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("XLSX workbook has no worksheets.");
  }

  const rows: string[] = [];

  worksheet.eachRow((row) => {
    const values = row.values;
    const cells = Array.isArray(values)
      ? values.slice(1).map((cell) => escapeCsvCell(cell))
      : [];

    rows.push(cells.join(","));
  });

  return rows.join("\n");
}

export async function convertBrcEduBlobToCsvText(
  buffer: Buffer,
  extension: SupportedBrcEduExtension,
): Promise<string> {
  if (extension === "csv") {
    return csvBufferToText(buffer);
  }

  return xlsxBufferToCsvText(buffer);
}
