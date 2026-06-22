import path from "node:path";
import { fileURLToPath } from "node:url";

export const RED_LOGO_URL = "/assets/red.png";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

export const redAssetsDirectory = path.join(packageRoot, "assets");
