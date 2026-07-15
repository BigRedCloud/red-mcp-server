import sharp from "sharp";
const ANALYSIS_MAX_DIMENSION = 320;
const CONTENT_COLOR_THRESHOLD = 20;
const CONTENT_LUMINANCE_THRESHOLD = 18;
const PADDING_PX = 12;
const MIN_COMPONENT_AREA_RATIO = 0.002;
const SMALL_COMPONENT_AREA_RATIO = 0.05;
const DISTANT_COMPONENT_DISTANCE_RATIO = 0.45;
const ALREADY_CROPPED_COVERAGE = 0.9;
const MIN_AXIS_REDUCTION_RATIO = 0.05;
function median(values) {
    if (values.length === 0) {
        return 0;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
        : sorted[middle];
}
function readRgb(data, width, channels, x, y) {
    const index = (y * width + x) * channels;
    return {
        r: data[index] ?? 0,
        g: data[index + 1] ?? 0,
        b: data[index + 2] ?? 0,
    };
}
function detectBackgroundColor(data, width, height, channels) {
    const reds = [];
    const greens = [];
    const blues = [];
    const samplePatch = (startX, startY) => {
        for (let y = startY; y < Math.min(startY + 4, height); y += 1) {
            for (let x = startX; x < Math.min(startX + 4, width); x += 1) {
                const rgb = readRgb(data, width, channels, x, y);
                reds.push(rgb.r);
                greens.push(rgb.g);
                blues.push(rgb.b);
            }
        }
    };
    samplePatch(0, 0);
    samplePatch(Math.max(0, width - 4), 0);
    samplePatch(0, Math.max(0, height - 4));
    samplePatch(Math.max(0, width - 4), Math.max(0, height - 4));
    return {
        r: median(reds),
        g: median(greens),
        b: median(blues),
    };
}
function isContentPixel(rgb, background) {
    const channelDistance = Math.max(Math.abs(rgb.r - background.r), Math.abs(rgb.g - background.g), Math.abs(rgb.b - background.b));
    if (channelDistance >= CONTENT_COLOR_THRESHOLD) {
        return true;
    }
    const rgbLuminance = rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114;
    const backgroundLuminance = background.r * 0.299 + background.g * 0.587 + background.b * 0.114;
    return Math.abs(rgbLuminance - backgroundLuminance) >= CONTENT_LUMINANCE_THRESHOLD;
}
function buildContentMask(data, width, height, channels, background) {
    const mask = new Array(width * height);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const index = y * width + x;
            mask[index] = isContentPixel(readRgb(data, width, channels, x, y), background);
        }
    }
    return mask;
}
function findContentComponents(mask, width, height) {
    const visited = new Array(width * height).fill(false);
    const components = [];
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const startIndex = y * width + x;
            if (!mask[startIndex] || visited[startIndex]) {
                continue;
            }
            const queue = [startIndex];
            visited[startIndex] = true;
            let minX = x;
            let maxX = x;
            let minY = y;
            let maxY = y;
            let area = 0;
            let sumX = 0;
            let sumY = 0;
            while (queue.length > 0) {
                const current = queue.pop();
                const currentX = current % width;
                const currentY = Math.floor(current / width);
                area += 1;
                sumX += currentX;
                sumY += currentY;
                minX = Math.min(minX, currentX);
                maxX = Math.max(maxX, currentX);
                minY = Math.min(minY, currentY);
                maxY = Math.max(maxY, currentY);
                const neighbors = [
                    [currentX + 1, currentY],
                    [currentX - 1, currentY],
                    [currentX, currentY + 1],
                    [currentX, currentY - 1],
                ];
                for (const [neighborX, neighborY] of neighbors) {
                    if (neighborX < 0 ||
                        neighborX >= width ||
                        neighborY < 0 ||
                        neighborY >= height) {
                        continue;
                    }
                    const neighbor = neighborY * width + neighborX;
                    if (!mask[neighbor] || visited[neighbor]) {
                        continue;
                    }
                    visited[neighbor] = true;
                    queue.push(neighbor);
                }
            }
            components.push({
                minX,
                minY,
                maxX,
                maxY,
                area,
                centroidX: sumX / area,
                centroidY: sumY / area,
            });
        }
    }
    return components.sort((left, right) => right.area - left.area);
}
function selectSignificantComponents(components, analysisWidth, analysisHeight) {
    if (components.length === 0) {
        return [];
    }
    const minArea = Math.max(40, Math.floor(analysisWidth * analysisHeight * MIN_COMPONENT_AREA_RATIO));
    const significant = components.filter((component) => component.area >= minArea);
    if (significant.length === 0) {
        return [];
    }
    const largest = significant[0];
    const smallAreaCutoff = Math.max(minArea, Math.floor(largest.area * SMALL_COMPONENT_AREA_RATIO));
    const maxDistance = Math.hypot(analysisWidth, analysisHeight) * DISTANT_COMPONENT_DISTANCE_RATIO;
    return significant.filter((component) => {
        if (component.area >= smallAreaCutoff) {
            return true;
        }
        const distance = Math.hypot(component.centroidX - largest.centroidX, component.centroidY - largest.centroidY);
        return distance < maxDistance;
    });
}
function unionComponentBounds(components) {
    if (components.length === 0) {
        return null;
    }
    let minX = components[0].minX;
    let minY = components[0].minY;
    let maxX = components[0].maxX;
    let maxY = components[0].maxY;
    for (const component of components.slice(1)) {
        minX = Math.min(minX, component.minX);
        minY = Math.min(minY, component.minY);
        maxX = Math.max(maxX, component.maxX);
        maxY = Math.max(maxY, component.maxY);
    }
    return {
        left: minX,
        top: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
    };
}
function scaleBounds(bounds, analysisWidth, analysisHeight, imageWidth, imageHeight) {
    const scaleX = imageWidth / analysisWidth;
    const scaleY = imageHeight / analysisHeight;
    const left = Math.floor(bounds.left * scaleX);
    const top = Math.floor(bounds.top * scaleY);
    const right = Math.ceil((bounds.left + bounds.width) * scaleX);
    const bottom = Math.ceil((bounds.top + bounds.height) * scaleY);
    const paddedLeft = Math.max(0, left - PADDING_PX);
    const paddedTop = Math.max(0, top - PADDING_PX);
    const paddedRight = Math.min(imageWidth, right + PADDING_PX);
    const paddedBottom = Math.min(imageHeight, bottom + PADDING_PX);
    return {
        left: paddedLeft,
        top: paddedTop,
        width: Math.max(1, paddedRight - paddedLeft),
        height: Math.max(1, paddedBottom - paddedTop),
    };
}
function shouldSkipCrop(bounds, imageWidth, imageHeight) {
    const widthCoverage = bounds.width / imageWidth;
    const heightCoverage = bounds.height / imageHeight;
    if (widthCoverage >= ALREADY_CROPPED_COVERAGE && heightCoverage >= ALREADY_CROPPED_COVERAGE) {
        return true;
    }
    const widthReduction = 1 - widthCoverage;
    const heightReduction = 1 - heightCoverage;
    return (widthReduction < MIN_AXIS_REDUCTION_RATIO &&
        heightReduction < MIN_AXIS_REDUCTION_RATIO);
}
function mimeTypeToSharpFormat(mimeType) {
    switch (mimeType) {
        case "image/png":
            return "png";
        case "image/jpeg":
            return "jpeg";
        case "image/webp":
            return "webp";
        case "image/gif":
            return "gif";
        default:
            return null;
    }
}
export function detectFreshdeskPublicImageCropBounds(analysisWidth, analysisHeight, mask, imageWidth, imageHeight) {
    const components = findContentComponents(mask, analysisWidth, analysisHeight);
    const significant = selectSignificantComponents(components, analysisWidth, analysisHeight);
    const union = unionComponentBounds(significant);
    if (!union) {
        return null;
    }
    const scaled = scaleBounds(union, analysisWidth, analysisHeight, imageWidth, imageHeight);
    if (scaled.width <= 0 ||
        scaled.height <= 0 ||
        scaled.left < 0 ||
        scaled.top < 0 ||
        scaled.left + scaled.width > imageWidth ||
        scaled.top + scaled.height > imageHeight) {
        return null;
    }
    if (shouldSkipCrop(scaled, imageWidth, imageHeight)) {
        return null;
    }
    return scaled;
}
export async function analyzeFreshdeskPublicImageCropBounds(buffer) {
    const image = sharp(buffer, { animated: false });
    const metadata = await image.metadata();
    const imageWidth = metadata.width ?? 0;
    const imageHeight = metadata.height ?? 0;
    if (imageWidth < 32 || imageHeight < 32) {
        return null;
    }
    const analysisScale = Math.min(1, ANALYSIS_MAX_DIMENSION / Math.max(imageWidth, imageHeight));
    const analysisWidth = Math.max(1, Math.round(imageWidth * analysisScale));
    const analysisHeight = Math.max(1, Math.round(imageHeight * analysisScale));
    const { data, info } = await sharp(buffer, { animated: false })
        .resize(analysisWidth, analysisHeight, { fit: "fill" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const background = detectBackgroundColor(data, info.width, info.height, info.channels);
    const mask = buildContentMask(data, info.width, info.height, info.channels, background);
    return detectFreshdeskPublicImageCropBounds(info.width, info.height, mask, imageWidth, imageHeight);
}
export async function normalizeFreshdeskPublicImageBuffer(buffer, mimeType) {
    const format = mimeTypeToSharpFormat(mimeType);
    if (!format) {
        return { buffer, cropped: false };
    }
    try {
        const bounds = await analyzeFreshdeskPublicImageCropBounds(buffer);
        if (!bounds) {
            return { buffer, cropped: false };
        }
        const croppedBuffer = await sharp(buffer, { animated: false })
            .extract(bounds)
            .toFormat(format)
            .toBuffer();
        if (!croppedBuffer.byteLength || croppedBuffer.byteLength > buffer.byteLength * 4) {
            return { buffer, cropped: false };
        }
        return { buffer: croppedBuffer, cropped: true };
    }
    catch {
        return { buffer, cropped: false };
    }
}
