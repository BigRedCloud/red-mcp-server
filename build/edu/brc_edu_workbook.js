import ExcelJS from "exceljs";
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
