import ExcelJS from "exceljs";
import { normaliseSupportEduRows, parseSupportEduCsv, } from "./brc_edu_enrichment.js";
import { BRC_EDU_UPLOAD_MAX_BYTES } from "./brc_edu_upload_store.js";
import { xlsxBufferToCsvText } from "./brc_edu_xlsx.js";
export const WEBINAR_WORKBOOK_LATEST_BLOB = "brc-edu/latest/webinar_video_routing_index.xlsx";
export const WEBINAR_WORKBOOK_CORE_HEADERS = [
    "Video Title",
    "Video URL",
    "Help-Routing Category",
    "Description",
    "Active",
];
export const WEBINAR_WORKBOOK_OPTIONAL_HEADERS = [
    "Resource Type",
    "Start Date",
    "End Date",
];
const HEADER_ALIASES = {
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
function normalizeHeaderKey(value) {
    return value
        .replace(/^\uFEFF/, "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_")
        .replace(/_+/g, "_");
}
function asTrimmedString(value) {
    if (value == null) {
        return "";
    }
    return String(value).trim();
}
function cellValueToString(value) {
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
function isBlankAdminRow(row) {
    return (!row.videoTitle &&
        !row.videoUrl &&
        !row.helpRoutingCategory &&
        !row.description &&
        !row.active &&
        !row.resourceType &&
        !row.startDate &&
        !row.endDate);
}
export async function parseWorkbookBufferToAdminRows(buffer) {
    return parseWorkbookWorksheetRows(buffer);
}
async function parseWorkbookWorksheetRows(buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
        return [];
    }
    const headerRow = worksheet.getRow(1);
    const headerValues = headerRow.values;
    const headers = Array.isArray(headerValues)
        ? headerValues.slice(1).map((value) => cellValueToString(value))
        : [];
    const columnMap = new Map();
    headers.forEach((header, index) => {
        const field = HEADER_ALIASES[normalizeHeaderKey(header)];
        if (field) {
            columnMap.set(index + 1, field);
        }
    });
    const rows = [];
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) {
            return;
        }
        const adminRow = {
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
            }
            else if (field === "videoUrl") {
                adminRow.videoUrl = value;
            }
            else if (field === "helpRoutingCategory") {
                adminRow.helpRoutingCategory = value;
            }
            else if (field === "description") {
                adminRow.description = value;
            }
            else if (field === "active") {
                adminRow.active = value || "Yes";
            }
            else if (field === "resourceType") {
                adminRow.resourceType = value || undefined;
            }
            else if (field === "startDate") {
                adminRow.startDate = value || undefined;
            }
            else if (field === "endDate") {
                adminRow.endDate = value || undefined;
            }
        });
        if (!isBlankAdminRow(adminRow)) {
            rows.push(adminRow);
        }
    });
    return rows;
}
function rowHasOptionalValues(rows) {
    return {
        resourceType: rows.some((row) => asTrimmedString(row.resourceType)),
        startDate: rows.some((row) => asTrimmedString(row.startDate)),
        endDate: rows.some((row) => asTrimmedString(row.endDate)),
    };
}
export async function buildWorkbookBufferFromAdminRows(rows) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Sheet1");
    const optional = rowHasOptionalValues(rows);
    const headers = [
        ...WEBINAR_WORKBOOK_CORE_HEADERS,
        ...(optional.resourceType ? ["Resource Type"] : []),
        ...(optional.startDate ? ["Start Date"] : []),
        ...(optional.endDate ? ["End Date"] : []),
    ];
    worksheet.addRow(headers);
    for (const row of rows) {
        const values = [
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
function isValidHttpUrl(value) {
    try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    }
    catch {
        return false;
    }
}
function normalizeComparableText(value) {
    return value.trim().toLowerCase();
}
export function isValidActiveValue(value) {
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
export function validateWebinarAdminRows(rows) {
    const errors = [];
    const seenTitles = new Map();
    const seenUrls = new Map();
    rows.forEach((row, index) => {
        const rowLabel = `Row ${index + 1}`;
        if (!asTrimmedString(row.videoTitle)) {
            errors.push(`${rowLabel}: Video Title is required.`);
        }
        if (!asTrimmedString(row.videoUrl)) {
            errors.push(`${rowLabel}: Video URL is required.`);
        }
        else if (!isValidHttpUrl(row.videoUrl.trim())) {
            errors.push(`${rowLabel}: Video URL must be a valid http or https URL.`);
        }
        if (!asTrimmedString(row.helpRoutingCategory)) {
            errors.push(`${rowLabel}: Help-Routing Category is required.`);
        }
        if (!asTrimmedString(row.active)) {
            errors.push(`${rowLabel}: Active is required.`);
        }
        else if (!isValidActiveValue(row.active)) {
            errors.push(`${rowLabel}: Active must be Yes, No, True, or False.`);
        }
        const titleKey = normalizeComparableText(row.videoTitle);
        if (titleKey) {
            const previousTitleRow = seenTitles.get(titleKey);
            if (previousTitleRow != null) {
                errors.push(`${rowLabel}: Duplicate Video Title matches row ${previousTitleRow + 1}.`);
            }
            else {
                seenTitles.set(titleKey, index);
            }
        }
        const urlKey = normalizeComparableText(row.videoUrl);
        if (urlKey) {
            const previousUrlRow = seenUrls.get(urlKey);
            if (previousUrlRow != null) {
                errors.push(`${rowLabel}: Duplicate Video URL matches row ${previousUrlRow + 1}.`);
            }
            else {
                seenUrls.set(urlKey, index);
            }
        }
    });
    if (errors.length > 0) {
        return { ok: false, errors };
    }
    return { ok: true };
}
export async function validateWorkbookBufferSize(buffer) {
    if (buffer.byteLength > BRC_EDU_UPLOAD_MAX_BYTES) {
        return {
            ok: false,
            error: "Workbook exceeds the maximum size of 5 MB.",
        };
    }
    return { ok: true };
}
export async function adminRowsToSupportCsvText(rows) {
    const buffer = await buildWorkbookBufferFromAdminRows(rows);
    return xlsxBufferToCsvText(buffer);
}
export function supportRowsFromAdminRows(rows) {
    return normaliseSupportEduRows(parseSupportEduCsv([
        "Video Title,Video URL,Help-Routing Category,Description,Active",
        ...rows.map((row) => [
            row.videoTitle,
            row.videoUrl,
            row.helpRoutingCategory,
            row.description,
            row.active,
        ]
            .map((value) => `"${String(value).replaceAll('"', '""')}"`)
            .join(",")),
    ].join("\n")));
}
