import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_BRC_EDU_ENRICHED_CSV_PATH, DEFAULT_BRC_EDU_SUPPORT_CSV_PATH, getBrcEduEnrichedCsvPath, getBrcEduSupportCsvPath, resolveBrcEduCsvPath, } from "./brc_edu_paths.js";
const BASE_DIR = join(tmpdir(), "brc-edu-path-test");
test("resolveBrcEduCsvPath keeps absolute paths unchanged", () => {
    const absolutePath = "C:\\Users\\Lauren.Dwyer\\OneDrive - Big Red Book\\Red Edu\\webinar_video_routing_index.csv";
    assert.equal(resolveBrcEduCsvPath(absolutePath, DEFAULT_BRC_EDU_SUPPORT_CSV_PATH, BASE_DIR), absolutePath);
});
test("resolveBrcEduCsvPath resolves relative defaults against baseDir", () => {
    assert.equal(resolveBrcEduCsvPath(undefined, DEFAULT_BRC_EDU_ENRICHED_CSV_PATH, BASE_DIR), join(BASE_DIR, DEFAULT_BRC_EDU_ENRICHED_CSV_PATH));
});
test("getBrcEduSupportCsvPath and getBrcEduEnrichedCsvPath read environment variables", () => {
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
