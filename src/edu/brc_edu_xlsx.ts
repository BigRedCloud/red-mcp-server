import ExcelJS from "exceljs";

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
