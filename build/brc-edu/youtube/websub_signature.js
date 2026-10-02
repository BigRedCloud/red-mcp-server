import { createHmac, timingSafeEqual } from "node:crypto";
/** WebSub signs the exact delivered bytes with the subscription's hub.secret. */
export function verifyWebSubSignature(body, signature, secret) {
    if (!secret || typeof signature !== "string")
        return false;
    const match = /^(sha1|sha256|sha384|sha512)=([0-9a-f]+)$/i.exec(signature);
    if (!match)
        return false;
    const expected = createHmac(match[1].toLowerCase(), secret).update(body).digest();
    if (match[2].length !== expected.length * 2)
        return false;
    const supplied = Buffer.from(match[2], "hex");
    return supplied.length === expected.length && timingSafeEqual(expected, supplied);
}
