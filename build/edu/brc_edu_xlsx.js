import ExcelJS from "exceljs";
function escapeCsvCell(value) {
    if (value == null) {
        return "";
    }
    const text = String(value);
    if (/[",\r\n]/.test(text)) {
        return `"${text.replaceAll('"', '""')}"`;
    }
    return text;
}
export async function xlsxBufferToCsvText(buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
        throw new Error("XLSX workbook has no worksheets.");
    }
    const rows = [];
    worksheet.eachRow((row) => {
        const values = row.values;
        const cells = Array.isArray(values)
            ? values.slice(1).map((cell) => escapeCsvCell(cell))
            : [];
        rows.push(cells.join(","));
    });
    return rows.join("\n");
}
