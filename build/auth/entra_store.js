import { createHash, randomBytes, randomUUID } from "node:crypto";
import { encodeStoredApiKey } from "./credential_secret.js";
export const SSO_LINK_TTL_MS = 10 * 60_000;
export const isPendingRequestHandle = (value) => typeof value === "string" && /^req_[A-Za-z0-9_-]{43}$/.test(value);
export function ownerKey(owner) {
    const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!guid.test(owner.tenantId) || !guid.test(owner.objectId))
        throw new Error("Invalid owner identity.");
    return createHash("sha256").update(`${owner.tenantId.toLowerCase()}:${owner.objectId.toLowerCase()}`).digest("hex");
}
const linkId = (token) => `link:${createHash("sha256").update(token).digest("hex")}`;
/** Separate namespace: legacy session/ref lookup cannot address these records. */
export class EntraConnectionStore {
    backend;
    now;
    constructor(backend, now = Date.now) {
        this.backend = backend;
        this.now = now;
    }
    async owner(owner, create = false) {
        const key = ownerKey(owner), pk = `entra:${key}`;
        let record = await this.backend.read(pk, "owner");
        if (!record && create) {
            const candidate = { pk, id: "owner", type: "entraOwner", ownerKey: key, connectionId: randomUUID(), ttl: -1 };
            await this.backend.create(candidate); // Cosmos (pk,id) uniqueness arbitrates races.
            record = await this.backend.read(pk, "owner");
        }
        if (record && (record.ownerKey !== key || record.type !== "entraOwner"))
            throw new Error("Owner access denied.");
        return record;
    }
    async createLink(owner) {
        const record = await this.owner(owner, true);
        if (!record)
            throw new Error("Connection unavailable.");
        const token = randomBytes(32).toString("base64url");
        const created = await this.backend.create({ ...record, _etag: undefined, id: linkId(token), type: "entraLink", used: false, expiresAt: this.now() + SSO_LINK_TTL_MS, ttl: SSO_LINK_TTL_MS / 1000 });
        if (!created)
            throw new Error("Connection unavailable.");
        return token;
    }
    async checkLink(owner, token, consume = false) {
        if (!/^[A-Za-z0-9_-]{43}$/.test(token))
            return false;
        const record = await this.owner(owner);
        if (!record)
            return false;
        const link = await this.backend.read(record.pk, linkId(token));
        if (!link || link.type !== "entraLink" || link.ownerKey !== record.ownerKey || link.connectionId !== record.connectionId || link.used || !link.expiresAt || link.expiresAt <= this.now())
            return false;
        if (!consume)
            return true;
        return this.backend.replace({ ...link, used: true }, link._etag);
    }
    /** Public locator only. Authorization always requires the verified owner. */
    async createPendingRequest(owner) {
        const record = await this.owner(owner, true);
        if (!record)
            throw new Error("Connection unavailable.");
        const handle = "req_" + randomBytes(32).toString("base64url");
        const created = await this.backend.create({
            pk: record.pk, id: this.requestId(handle), type: "entraPendingRequest",
            connectionId: record.connectionId, ownerKey: record.ownerKey,
            used: false, expiresAt: this.now() + SSO_LINK_TTL_MS, ttl: SSO_LINK_TTL_MS / 1000,
        });
        if (!created)
            throw new Error("Connection unavailable.");
        return handle;
    }
    requestId(handle) {
        return "request:" + createHash("sha256").update(handle).digest("hex");
    }
    async pendingRequest(owner, handle) {
        if (!isPendingRequestHandle(handle))
            return null;
        const record = await this.owner(owner);
        if (!record)
            return null;
        // Never search other partitions or resolve an owner from a public handle.
        const request = await this.backend.read(record.pk, this.requestId(handle));
        if (!request || request.type !== "entraPendingRequest" ||
            request.ownerKey !== record.ownerKey || request.connectionId !== record.connectionId ||
            request.used || !request.expiresAt || request.expiresAt <= this.now())
            return null;
        return request;
    }
    async pendingRequestExpiry(owner, handle) {
        return (await this.pendingRequest(owner, handle))?.expiresAt ?? null;
    }
    async checkPendingRequest(owner, handle, consume = false) {
        const request = await this.pendingRequest(owner, handle);
        if (!request)
            return false;
        if (!consume)
            return true;
        return this.backend.replace({ ...request, used: true }, request._etag);
    }
    async listCompanies(owner) {
        const record = await this.owner(owner);
        if (!record)
            return [];
        const docs = await this.backend.list(record.pk);
        return docs.filter(d => d.type === "entraCompany" && d.ownerKey === record.ownerKey && d.connectionId === record.connectionId && d.credential && d.credential.expiresAt > this.now())
            .map(d => ({ ...d.credential })).sort((a, b) => a.companyName.localeCompare(b.companyName));
    }
    async saveCompanies(owner, companies) {
        const record = await this.owner(owner);
        if (!record)
            throw new Error("Owner access denied.");
        // SSO never falls back to the non-encrypted memory encoding.
        const encoded = companies.map(company => {
            const encryptedSecret = encodeStoredApiKey(company.apiKey);
            if (!encryptedSecret.startsWith("enc:"))
                throw new Error("SSO encrypted storage is not configured.");
            return { company, encryptedSecret };
        });
        for (const { company, encryptedSecret } of encoded) {
            const id = `company:${createHash("sha256").update(company.companyName.trim().toLowerCase()).digest("hex")}`;
            let saved = false;
            for (let attempt = 0; attempt < 5 && !saved; attempt++) {
                const old = await this.backend.read(record.pk, id);
                const doc = { pk: record.pk, id, type: "entraCompany", ownerKey: record.ownerKey, connectionId: record.connectionId,
                    ttl: Math.max(1, Math.ceil((company.expiresAt - this.now()) / 1000)),
                    credential: { connectionId: record.connectionId, companyName: company.companyName.trim(), credentialType: "apiKey", encryptedSecret,
                        expiresAt: company.expiresAt, createdAt: old?.credential?.createdAt ?? this.now(), updatedAt: this.now(), credentialValidatedAt: company.credentialValidatedAt } };
                saved = old ? await this.backend.replace(doc, old._etag) : await this.backend.create(doc);
            }
            if (!saved)
                throw new Error("Connection update conflict. Please retry.");
        }
    }
}
export function createMemorySsoBackend() {
    const records = new Map();
    const key = (pk, id) => `${pk}|${id}`;
    return {
        async read(pk, id) { const d = records.get(key(pk, id)); return d ? structuredClone(d) : null; },
        async create(d) { const k = key(d.pk, d.id); if (records.has(k))
            return false; records.set(k, structuredClone({ ...d, _etag: randomUUID() })); return true; },
        async replace(d, etag) { const k = key(d.pk, d.id); if (!etag || records.get(k)?._etag !== etag)
            return false; records.set(k, structuredClone({ ...d, _etag: randomUUID() })); return true; },
        async list(pk) { return [...records.values()].filter(d => d.pk === pk).map(d => structuredClone(d)); },
    };
}
