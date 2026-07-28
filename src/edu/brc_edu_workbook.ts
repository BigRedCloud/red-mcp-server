import ExcelJS from "exceljs";

import {
  normaliseSupportEduRows,
  parseSupportEduCsv,
} from "./brc_edu_enrichment.js";
import { xlsxBufferToCsvText } from "./brc_edu_xlsx.js";

export const WEBINAR_WORKBOOK_LATEST_BLOB =
  "brc-edu/latest/webinar_video_routing_index.xlsx";

const WORKBOOK_MAX_BYTES = 5 * 1024 * 1024;

export const WEBINAR_WORKBOOK_CORE_HEADERS = [
  "Video Title",
  "Video URL",
  "Help-Routing Category",
  "Description",
  "Active",
] as const;

export const WEBINAR_WORKBOOK_OPTIONAL_HEADERS = [
  "Resource Type",
  "Start Date",
  "End Date",
] as const;

export type WebinarResourceAdminRow = {
  videoTitle: string;
  videoUrl: string;
  helpRoutingCategory: string;
  description: string;
  active: string;
  resourceType?: string;
  startDate?: string;
  endDate?: string;
};

export type WebinarWorkbookMetadata = {
  etag: string;
  lastModified: string;
  rowCount: number;
};

export type WebinarWorkbookPayload = WebinarWorkbookMetadata & {
  rows: WebinarResourceAdminRow[];
  warnings?: string[];
};

const HEADER_ALIASES: Record<string, keyof WebinarResourceAdminRow> = {
  video_title: "videoTitle",
  title: "videoTitle",
  video_url: "videoUrl",
  url: "videoUrl",
  help_routing_category: "helpRoutingCategory",
  preferred_category: "helpRoutingCategory",
  preferredcategory: "helpRoutingCategory",
  helproutingcategory: "helpRoutingCategory",
  description: "description",
  notes: "description",
  note: "description",
  active: "active",
  is_active: "active",
  resource_type: "resourceType",
  resourcetype: "resourceType",
  start_date: "startDate",
  startdate: "startDate",
  end_date: "endDate",
  enddate: "endDate",
};

function normalizeHeaderKey(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
}

function asTrimmedString(value: unknown): string {
  if (value == null) {
    return "";
  }

  return String(value).trim();
}

function cellValueToString(value: ExcelJS.CellValue): string {
  if (value == null) {
    return "";
  }

  if (typeof value === "object") {
    if ("text" in value && value.text != null) {
      return asTrimmedString(value.text);
    }

    if ("result" in value && value.result != null) {
      return asTrimmedString(value.result);
    }

    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? "").join("").trim();
    }

    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }
  }

  return asTrimmedString(value);
}

function isBlankAdminRow(row: WebinarResourceAdminRow): boolean {
  return (
    !row.videoTitle &&
    !row.videoUrl &&
    !row.helpRoutingCategory &&
    !row.description &&
    !row.active &&
    !row.resourceType &&
    !row.startDate &&
    !row.endDate
  );
}

export async function parseWorkbookBufferToAdminRows(
  buffer: Buffer,
): Promise<WebinarResourceAdminRow[]> {
  return parseWorkbookWorksheetRows(buffer);
}

async function parseWorkbookWorksheetRows(
  buffer: Buffer,
): Promise<WebinarResourceAdminRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    buffer as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0],
  );

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return [];
  }

  const headerRow = worksheet.getRow(1);
  const headerValues = headerRow.values;
  const headers = Array.isArray(headerValues)
    ? headerValues.slice(1).map((value) => cellValueToString(value))
    : [];

  const columnMap = new Map<number, keyof WebinarResourceAdminRow>();
  headers.forEach((header, index) => {
    const field = HEADER_ALIASES[normalizeHeaderKey(header)];
    if (field) {
      columnMap.set(index + 1, field);
    }
  });

  const rows: WebinarResourceAdminRow[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }

    const adminRow: WebinarResourceAdminRow = {
      videoTitle: "",
      videoUrl: "",
      helpRoutingCategory: "",
      description: "",
      active: "Yes",
    };

    columnMap.forEach((field, columnNumber) => {
      const value = cellValueToString(row.getCell(columnNumber).value);
      if (field === "videoTitle") {
        adminRow.videoTitle = value;
      } else if (field === "videoUrl") {
        adminRow.videoUrl = value;
      } else if (field === "helpRoutingCategory") {
        adminRow.helpRoutingCategory = value;
      } else if (field === "description") {
        adminRow.description = value;
      } else if (field === "active") {
        adminRow.active = value || "Yes";
      } else if (field === "resourceType") {
        adminRow.resourceType = value || undefined;
      } else if (field === "startDate") {
        adminRow.startDate = value || undefined;
      } else if (field === "endDate") {
        adminRow.endDate = value || undefined;
      }
    });

    if (!isBlankAdminRow(adminRow)) {
      rows.push(adminRow);
    }
  });

  return rows;
}

function rowHasOptionalValues(rows: WebinarResourceAdminRow[]): {
  resourceType: boolean;
  startDate: boolean;
  endDate: boolean;
} {
  return {
    resourceType: rows.some((row) => asTrimmedString(row.resourceType)),
    startDate: rows.some((row) => asTrimmedString(row.startDate)),
    endDate: rows.some((row) => asTrimmedString(row.endDate)),
  };
}

export async function buildWorkbookBufferFromAdminRows(
  rows: WebinarResourceAdminRow[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Sheet1");
  const optional = rowHasOptionalValues(rows);
  const headers = [
    ...WEBINAR_WORKBOOK_CORE_HEADERS,
    ...(optional.resourceType ? ["Resource Type" as const] : []),
    ...(optional.startDate ? ["Start Date" as const] : []),
    ...(optional.endDate ? ["End Date" as const] : []),
  ];

  worksheet.addRow(headers);

  for (const row of rows) {
    const values: string[] = [
      row.videoTitle,
      row.videoUrl,
      row.helpRoutingCategory,
      row.description,
      row.active,
    ];

    if (optional.resourceType) {
      values.push(row.resourceType ?? "");
    }

    if (optional.startDate) {
      values.push(row.startDate ?? "");
    }

    if (optional.endDate) {
      values.push(row.endDate ?? "");
    }

    worksheet.addRow(values);
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeComparableText(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidActiveValue(value: string): boolean {
  const normalized = normalizeComparableText(value);
  return [
    "yes",
    "no",
    "true",
    "false",
    "1",
    "0",
    "active",
    "inactive",
    "y",
    "n",
  ].includes(normalized);
}

export type WebinarAdminValidationResult =
  | { ok: true; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

export function validateWebinarAdminRows(
  rows: WebinarResourceAdminRow[],
): WebinarAdminValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenTitles = new Map<string, number>();
  const seenUrls = new Map<string, number>();

  rows.forEach((row, index) => {
    const rowLabel = `Row ${index + 1}`;

    if (!asTrimmedString(row.videoTitle)) {
      errors.push(`${rowLabel}: Video Title is required.`);
    }

    if (!asTrimmedString(row.videoUrl)) {
      errors.push(`${rowLabel}: Video URL is required.`);
    } else if (!isValidHttpUrl(row.videoUrl.trim())) {
      errors.push(`${rowLabel}: Video URL must be a valid http or https URL.`);
    }

    if (!asTrimmedString(row.helpRoutingCategory)) {
      errors.push(`${rowLabel}: Help-Routing Category is required.`);
    }

    if (!asTrimmedString(row.active)) {
      errors.push(`${rowLabel}: Active is required.`);
    } else if (!isValidActiveValue(row.active)) {
      errors.push(`${rowLabel}: Active must be Yes, No, True, or False.`);
    }

    const titleKey = normalizeComparableText(row.videoTitle);
    if (titleKey) {
      const previousTitleRow = seenTitles.get(titleKey);
      if (previousTitleRow != null) {
        warnings.push(
          `${rowLabel}: Duplicate Video Title matches row ${previousTitleRow + 1}.`,
        );
      } else {
        seenTitles.set(titleKey, index);
      }
    }

    const urlKey = normalizeComparableText(row.videoUrl);
    if (urlKey) {
      const previousUrlRow = seenUrls.get(urlKey);
      if (previousUrlRow != null) {
        errors.push(
          `${rowLabel}: Duplicate Video URL matches row ${previousUrlRow + 1}.`,
        );
      } else {
        seenUrls.set(urlKey, index);
      }
    }
  });

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  return { ok: true, warnings };
}

export async function validateWorkbookBufferSize(
  buffer: Buffer,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (buffer.byteLength > WORKBOOK_MAX_BYTES) {
    return {
      ok: false,
      error: "Workbook exceeds the maximum size of 5 MB.",
    };
  }

  return { ok: true };
}

export async function adminRowsToSupportCsvText(
  rows: WebinarResourceAdminRow[],
): Promise<string> {
  const buffer = await buildWorkbookBufferFromAdminRows(rows);
  return xlsxBufferToCsvText(buffer);
}

export function supportRowsFromAdminRows(rows: WebinarResourceAdminRow[]) {
  return normaliseSupportEduRows(
    parseSupportEduCsv(
      [
        "Video Title,Video URL,Help-Routing Category,Description,Active",
        ...rows.map((row) =>
          [
            row.videoTitle,
            row.videoUrl,
            row.helpRoutingCategory,
            row.description,
            row.active,
          ]
            .map((value) => `"${String(value).replaceAll('"', '""')}"`)
            .join(","),
        ),
      ].join("\n"),
    ),
  );
}
