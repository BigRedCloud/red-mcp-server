import { createHash, randomBytes, randomUUID } from "node:crypto";
import { encodeStoredApiKey } from "./credential_secret.js";
import type { CompanyCredentialInput, StoredCompanyCredential } from "./connection_store_types.js";

export type EntraOwner = { tenantId: string; objectId: string };
export type SsoRecord = {
  pk: string; id: string; type: string; connectionId: string;
  ownerKey: string; expiresAt?: number; used?: boolean; ttl: number;
  credential?: StoredCompanyCredential; _etag?: string;
};
/** create and replace return false only on a conflict / failed precondition. */
export interface SsoBackend {
  read(pk: string, id: string): Promise<SsoRecord | null>;
  create(record: SsoRecord): Promise<boolean>;
  replace(record: SsoRecord, etag: string): Promise<boolean>;
  remove(pk: string, id: string, etag: string): Promise<boolean>;
  list(pk: string): Promise<SsoRecord[]>;
}
export const SSO_LINK_TTL_MS = 10 * 60_000;
export const isPendingRequestHandle = (value: unknown): value is string =>
  typeof value === "string" && /^req_[A-Za-z0-9_-]{43}$/.test(value);
export function ownerKey(owner: EntraOwner): string {
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!guid.test(owner.tenantId) || !guid.test(owner.objectId)) throw new Error("Invalid owner identity.");
  return createHash("sha256").update(`${owner.tenantId.toLowerCase()}:${owner.objectId.toLowerCase()}`).digest("hex");
}
const linkId = (token: string) => `link:${createHash("sha256").update(token).digest("hex")}`;

/** Separate namespace: legacy session/ref lookup cannot address these records. */
export class EntraConnectionStore {
  constructor(private backend: SsoBackend, private now = Date.now) {}
  private async owner(owner: EntraOwner, create = false): Promise<SsoRecord | null> {
    const key = ownerKey(owner), pk = `entra:${key}`;
    let record = await this.backend.read(pk, "owner");
    if (!record && create) {
      const candidate: SsoRecord = { pk, id: "owner", type: "entraOwner", ownerKey: key, connectionId: randomUUID(), ttl: -1 };
      await this.backend.create(candidate); // Cosmos (pk,id) uniqueness arbitrates races.
      record = await this.backend.read(pk, "owner");
    }
    if (record && (record.ownerKey !== key || record.type !== "entraOwner")) throw new Error("Owner access denied.");
    return record;
  }
  async createLink(owner: EntraOwner): Promise<string> {
    const record = await this.owner(owner, true);
    if (!record) throw new Error("Connection unavailable.");
    const token = randomBytes(32).toString("base64url");
    const created = await this.backend.create({ ...record, _etag: undefined, id: linkId(token), type: "entraLink", used: false, expiresAt: this.now() + SSO_LINK_TTL_MS, ttl: SSO_LINK_TTL_MS / 1000 });
    if (!created) throw new Error("Connection unavailable.");
    return token;
  }
  async checkLink(owner: EntraOwner, token: string, consume = false): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    const record = await this.owner(owner);
    if (!record) return false;
    const link = await this.backend.read(record.pk, linkId(token));
    if (!link || link.type !== "entraLink" || link.ownerKey !== record.ownerKey || link.connectionId !== record.connectionId || link.used || !link.expiresAt || link.expiresAt <= this.now()) return false;
    if (!consume) return true;
    return this.backend.replace({ ...link, used: true }, link._etag!);
  }
  /** Public locator only. Authorization always requires the verified owner. */
  async createPendingRequest(owner: EntraOwner): Promise<string> {
    const record = await this.owner(owner, true);
    if (!record) throw new Error("Connection unavailable.");
    const handle = "req_" + randomBytes(32).toString("base64url");
    const created = await this.backend.create({
      pk: record.pk, id: this.requestId(handle), type: "entraPendingRequest",
      connectionId: record.connectionId, ownerKey: record.ownerKey,
      used: false, expiresAt: this.now() + SSO_LINK_TTL_MS, ttl: SSO_LINK_TTL_MS / 1000,
    });
    if (!created) throw new Error("Connection unavailable.");
    return handle;
  }
  private requestId(handle: string): string {
    return "request:" + createHash("sha256").update(handle).digest("hex");
  }
  private async pendingRequest(owner: EntraOwner, handle: string): Promise<SsoRecord | null> {
    if (!isPendingRequestHandle(handle)) return null;
    const record = await this.owner(owner);
    if (!record) return null;
    // Never search other partitions or resolve an owner from a public handle.
    const request = await this.backend.read(record.pk, this.requestId(handle));
    if (!request || request.type !== "entraPendingRequest" ||
        request.ownerKey !== record.ownerKey || request.connectionId !== record.connectionId ||
        request.used || !request.expiresAt || request.expiresAt <= this.now()) return null;
    return request;
  }
  async pendingRequestExpiry(owner: EntraOwner, handle: string): Promise<number | null> {
    return (await this.pendingRequest(owner, handle))?.expiresAt ?? null;
  }
  async checkPendingRequest(owner: EntraOwner, handle: string, consume = false): Promise<boolean> {
    const request = await this.pendingRequest(owner, handle);
    if (!request) return false;
    if (!consume) return true;
    return this.backend.replace({ ...request, used: true }, request._etag!);
  }
  async listCompanies(owner: EntraOwner): Promise<StoredCompanyCredential[]> {
    const record = await this.owner(owner);
    if (!record) return [];
    const docs = await this.backend.list(record.pk);
    return docs.filter(d => d.type === "entraCompany" && d.ownerKey === record.ownerKey && d.connectionId === record.connectionId && d.credential && d.credential.expiresAt > this.now())
      .map(d => ({ ...d.credential! })).sort((a,b) => a.companyName.localeCompare(b.companyName));
  }
  async saveCompanies(owner: EntraOwner, companies: CompanyCredentialInput[]): Promise<void> {
    const record = await this.owner(owner);
    if (!record) throw new Error("Owner access denied.");
    // SSO never falls back to the non-encrypted memory encoding.
    const encoded = companies.map(company => {
      const encryptedSecret = encodeStoredApiKey(company.apiKey);
      if (!encryptedSecret.startsWith("enc:")) throw new Error("SSO encrypted storage is not configured.");
      return { company, encryptedSecret };
    });
    for (const {company, encryptedSecret} of encoded) {
      const id = `company:${createHash("sha256").update(company.companyName.trim().toLowerCase()).digest("hex")}`;
      let saved = false;
      for (let attempt = 0; attempt < 5 && !saved; attempt++) {
        const old = await this.backend.read(record.pk, id);
        const doc: SsoRecord = { pk: record.pk, id, type: "entraCompany", ownerKey: record.ownerKey, connectionId: record.connectionId,
          ttl: Math.max(1, Math.ceil((company.expiresAt - this.now()) / 1000)),
          credential: { connectionId: record.connectionId, companyName: company.companyName.trim(), credentialType: "apiKey", encryptedSecret,
            expiresAt: company.expiresAt, createdAt: old?.credential?.createdAt ?? this.now(), updatedAt: this.now(), credentialValidatedAt: company.credentialValidatedAt } };
        saved = old ? await this.backend.replace(doc, old._etag!) : await this.backend.create(doc);
      }
      if (!saved) throw new Error("Connection update conflict. Please retry.");
    }
  }
  /** Creates the empty owner partition when a verified browser session is the first connection. */
  async ensureOwner(owner: EntraOwner): Promise<void> {
    if (!await this.owner(owner, true)) throw new Error("Connection unavailable.");
  }
  /** Deletes one company in this owner's partition. A name that exists only for another owner is a no-op. */
  async removeCompany(owner: EntraOwner, companyName: string): Promise<boolean> {
    const record = await this.owner(owner);
    const name = companyName.trim();
    if (!record || !name || name.length > 200) return false;
    const id = `company:${createHash("sha256").update(name.toLowerCase()).digest("hex")}`;
    for (let attempt = 0; attempt < 5; attempt++) {
      const doc = await this.backend.read(record.pk, id);
      if (!doc || doc.type !== "entraCompany" || doc.ownerKey !== record.ownerKey || doc.connectionId !== record.connectionId || !doc.credential) return false;
      if (doc.credential.companyName.trim().toLowerCase() !== name.toLowerCase()) return false;
      if (!doc._etag) return false;
      if (await this.backend.remove(record.pk, id, doc._etag)) return true;
    }
    return false;
  }
}

export function createMemorySsoBackend(): SsoBackend {
  const records = new Map<string, SsoRecord>();
  const key = (pk: string, id: string) => `${pk}|${id}`;
  return {
    async read(pk,id) { const d = records.get(key(pk,id)); return d ? structuredClone(d) : null; },
    async create(d) { const k = key(d.pk,d.id); if (records.has(k)) return false; records.set(k, structuredClone({...d,_etag:randomUUID()})); return true; },
    async replace(d, etag) { const k = key(d.pk,d.id); if (!etag || records.get(k)?._etag !== etag) return false; records.set(k, structuredClone({...d,_etag:randomUUID()})); return true; },
    async remove(pk, id, etag) { const k = key(pk,id); if (!etag || records.get(k)?._etag !== etag) return false; records.delete(k); return true; },
    async list(pk) { return [...records.values()].filter(d => d.pk === pk).map(d => structuredClone(d)); },
  };
}
