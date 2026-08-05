import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_BRC_EDU_ENRICHED_CSV_PATH, DEFAULT_BRC_EDU_SUPPORT_CSV_PATH, getBrcEduEnrichedCsvPath, getBrcEduSupportCsvPath, isWindowsAbsolutePath, resolveBrcEduCsvPath, } from "./brc_edu_paths.js";
const BASE_DIR = join(tmpdir(), "brc-edu-path-test");
test("isWindowsAbsolutePath recognises drive-letter and UNC paths", () => {
    assert.equal(isWindowsAbsolutePath("C:\\Users\\Lauren.Dwyer\\OneDrive - Big Red Book\\Red Edu\\webinar_video_routing_index.csv"), true);
    assert.equal(isWindowsAbsolutePath("C:/Users/Lauren.Dwyer/OneDrive - Big Red Book/Red Edu/webinar_video_routing_index.csv"), true);
    assert.equal(isWindowsAbsolutePath("\\\\server\\share\\file.csv"), true);
    assert.equal(isWindowsAbsolutePath("data/webinar_video_routing_index.csv"), false);
});
test("resolveBrcEduCsvPath keeps POSIX absolute paths unchanged", () => {
    const absolutePath = "/var/red-edu/webinar_video_routing_index.csv";
    assert.equal(resolveBrcEduCsvPath(absolutePath, DEFAULT_BRC_EDU_SUPPORT_CSV_PATH, BASE_DIR), absolutePath);
});
test("resolveBrcEduCsvPath keeps Windows drive-letter paths unchanged", () => {
    const backslashPath = "C:\\Users\\Lauren.Dwyer\\OneDrive - Big Red Book\\Red Edu\\webinar_video_routing_index.csv";
    const forwardSlashPath = "C:/Users/Lauren.Dwyer/OneDrive - Big Red Book/Red Edu/webinar_video_routing_index.csv";
    assert.equal(resolveBrcEduCsvPath(backslashPath, DEFAULT_BRC_EDU_SUPPORT_CSV_PATH, BASE_DIR), backslashPath);
    assert.equal(resolveBrcEduCsvPath(forwardSlashPath, DEFAULT_BRC_EDU_SUPPORT_CSV_PATH, BASE_DIR), forwardSlashPath);
});
test("resolveBrcEduCsvPath keeps UNC paths unchanged", () => {
    const uncPath = "\\\\server\\share\\dev_only_video_routing_index_updated.csv";
    assert.equal(resolveBrcEduCsvPath(uncPath, DEFAULT_BRC_EDU_ENRICHED_CSV_PATH, BASE_DIR), uncPath);
});
test("resolveBrcEduCsvPath resolves relative defaults against baseDir", () => {
    assert.equal(resolveBrcEduCsvPath(undefined, DEFAULT_BRC_EDU_ENRICHED_CSV_PATH, BASE_DIR), join(BASE_DIR, DEFAULT_BRC_EDU_ENRICHED_CSV_PATH));
});
test("getBrcEduSupportCsvPath and getBrcEduEnrichedCsvPath return absolute Windows env paths unchanged", () => {
    const previousSupport = process.env.BRC_EDU_SUPPORT_CSV_PATH;
    const previousEnriched = process.env.BRC_EDU_ENRICHED_CSV_PATH;
    try {
        process.env.BRC_EDU_SUPPORT_CSV_PATH =
            "C:\\Users\\Lauren.Dwyer\\OneDrive - Big Red Book\\Red Edu\\webinar_video_routing_index.csv";
        process.env.BRC_EDU_ENRICHED_CSV_PATH =
            "C:\\Users\\Lauren.Dwyer\\OneDrive - Big Red Book\\Red Edu\\dev_only_video_routing_index_updated.csv";
        assert.equal(getBrcEduSupportCsvPath(BASE_DIR), process.env.BRC_EDU_SUPPORT_CSV_PATH);
        assert.equal(getBrcEduEnrichedCsvPath(BASE_DIR), process.env.BRC_EDU_ENRICHED_CSV_PATH);
    }
    finally {
        if (previousSupport === undefined) {
            delete process.env.BRC_EDU_SUPPORT_CSV_PATH;
        }
        else {
            process.env.BRC_EDU_SUPPORT_CSV_PATH = previousSupport;
        }
        if (previousEnriched === undefined) {
            delete process.env.BRC_EDU_ENRICHED_CSV_PATH;
        }
        else {
            process.env.BRC_EDU_ENRICHED_CSV_PATH = previousEnriched;
        }
    }
});
