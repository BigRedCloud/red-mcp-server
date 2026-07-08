import { isAbsolute, resolve } from "node:path";
export const DEFAULT_BRC_EDU_SUPPORT_CSV_PATH = "data/webinar_video_routing_index.csv";
export const DEFAULT_BRC_EDU_ENRICHED_CSV_PATH = "data/dev_only_video_routing_index_updated.csv";
export function resolveBrcEduCsvPath(envValue, defaultRelativePath, baseDir) {
    const candidate = envValue?.trim() || defaultRelativePath;
    if (isAbsolute(candidate)) {
        return candidate;
    }
    return resolve(baseDir, candidate);
}
export function getBrcEduSupportCsvPath(baseDir = process.cwd()) {
    return resolveBrcEduCsvPath(process.env.BRC_EDU_SUPPORT_CSV_PATH, DEFAULT_BRC_EDU_SUPPORT_CSV_PATH, baseDir);
}
export function getBrcEduEnrichedCsvPath(baseDir = process.cwd()) {
    return resolveBrcEduCsvPath(process.env.BRC_EDU_ENRICHED_CSV_PATH, DEFAULT_BRC_EDU_ENRICHED_CSV_PATH, baseDir);
}
