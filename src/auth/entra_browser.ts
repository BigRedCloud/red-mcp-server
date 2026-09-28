import { createHash, randomBytes } from "node:crypto";
import type { Express, Request, Response } from "express";
import { decryptCredentialSecret, encryptCredentialSecret } from "./credential_encryption.js";
import { ensureConnectionStoreInitialized, getConnectionStore } from "./connection_store.js";
import { entraRequestOwner, verifyEntraToken } from "./entra_auth.js";
import { isPendingRequestHandle, ownerKey, type EntraOwner } from "./entra_store.js";
import { renderConnectPage, renderSsoSignInPage, renderSsoErrorPage, renderSsoSuccessPage } from "./connection_page.js";
import multer from "multer";
import { parseCompanyCsv, CompanyInputError, COMPANY_CSV_MAX_BYTES, SSO_MAX_COMPANIES } from "./company_csv.js";

import { validateCompanyApiKeyCredential } from "./credential_validation.js";
import { getApiKeyExpirationMs } from "../config/server_config.js";

const companyUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: COMPANY_CSV_MAX_BYTES, files: 1, fields: 11, parts: 13, fieldSize: 8192 },
  fileFilter: (_req, file, done) => {
    if (!/\.csv$/i.test(file.originalname)) return done(new CompanyInputError("Choose a CSV file with the .csv extension."));
    done(null, true);
  },
}).single("companyFile");

async function readCompanyUpload(req: Request, res: Response): Promise<void> {
  await new Promise<void>((resolve, reject) => companyUpload(req, res, error => {
    if (!error) return resolve();
    if (error instanceof CompanyInputError) return reject(error);
    reject(new CompanyInputError(error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
      ? "The CSV file is too large. Choose a file no larger than 1 MB."
      : "The upload could not be read. Use one CSV file with up to five companies."));
  }));
}

const COOKIE = "__Host-red-sso";
const random = () => randomBytes(32).toString("base64url");
type BrowserState = { purpose: "oauth" | "connected"; exp: number; request: string; state: string; verifier?: string; nonce?: string; owner?: EntraOwner };
export function ssoPublicBase(): string {
  const url = new URL(process.env.RED_ENTRA_PUBLIC_BASE_URL ?? "");
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("SSO HTTPS origin is not configured.");
  return url.origin;
}
function headers(res: Response) {
  // Native form POSTs need a non-null Origin for the strict same-origin check.
  res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "strict-origin");
  res.setHeader("X-Frame-Options", "DENY"); res.setHeader("X-Content-Type-Options", "nosniff");
}
function cookie(res: Response, value: BrowserState) {
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(encryptCredentialSecret(JSON.stringify(value)))}; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=600`);
}
export function openSsoEnvelope(value: string): string {
  // Node's base64 decoder is permissive; reject noncanonical/trailing input.
  const parts = value.split(".");
  if (value.length > 8192 || parts.length !== 3 || parts.some(part => !part || Buffer.from(part,"base64").toString("base64") !== part)) throw new Error("Invalid SSO state.");
  return decryptCredentialSecret(value);
}
function readCookie(req: Request): BrowserState {
  const value = req.headers.cookie?.split(";").map(s=>s.trim()).find(s=>s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1);
  if (!value) throw new Error("Sign-in required.");
  const data = JSON.parse(openSsoEnvelope(decodeURIComponent(value))) as BrowserState;
  if (!data.exp || data.exp <= Date.now()) throw new Error("Sign-in expired.");
  return data;
}
function sameOrigin(req: Request) { if (req.headers.origin !== ssoPublicBase()) throw new Error("Invalid request origin."); }
function safe(handler: (req: Request,res: Response)=>Promise<void>) {
  return async (req: Request,res: Response) => { headers(res); try { await handler(req,res); } catch (error) { res.status(error instanceof CompanyInputError ? 400 : 401).type("html").send(renderSsoErrorPage(error instanceof CompanyInputError ? error.message : undefined)); } };
}
export function registerEntraBrowserRoutes(app: Express): void {
  // Public handles disclose no owner or credentials; GET never resolves or consumes state.
  app.get("/connect", (req,res,next) => {
    if (req.query.code !== undefined) { next(); return; } // Existing anonymous flow.
    headers(res);
    if (req.query.sso !== "1") {
      const request = isPendingRequestHandle(req.query.request) ? req.query.request : "";
      res.type("html").send(renderSsoSignInPage(request));
      return;
    }
    void safe(async (request,response) => {
      const session = readCookie(request);
      if (session.purpose !== "connected" || !session.owner) throw new Error();
      await ensureConnectionStoreInitialized();
      if (!await getConnectionStore().entra.checkPendingRequest(session.owner, session.request)) throw new Error();
      response.type("html").send(renderConnectPage(session.state, { sso: true }));
    })(req,res);
  });
  app.post("/connect/sso/start", safe(async (req,res) => {
    sameOrigin(req);
    const request = req.body.request;
    if (!isPendingRequestHandle(request)) throw new Error();
    const client = process.env.RED_ENTRA_WEB_CLIENT_ID;
    if (!client) throw new Error();
    const session: BrowserState = { purpose:"oauth", exp:Date.now()+600_000, request, state:random(), nonce:random(), verifier:random() };
    cookie(res,session);
    const url = new URL("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize");
    url.search = new URLSearchParams({ client_id:client, response_type:"code", response_mode:"form_post", redirect_uri:`${ssoPublicBase()}/connect/sso/callback`, scope:"openid profile", state:session.state, nonce:session.nonce!, code_challenge:createHash("sha256").update(session.verifier!).digest("base64url"), code_challenge_method:"S256" }).toString();
    res.redirect(303,url.toString());
  }));
  app.post("/connect/sso/callback", safe(async (req,res) => {
    const session = readCookie(req);
    if (session.purpose !== "oauth" || !session.verifier || !session.nonce || req.body.state !== session.state || typeof req.body.code !== "string") throw new Error();
    const client = process.env.RED_ENTRA_WEB_CLIENT_ID, secret = process.env.RED_ENTRA_WEB_CLIENT_SECRET;
    if (!client || !secret) throw new Error();
    const response = await fetch("https://login.microsoftonline.com/organizations/oauth2/v2.0/token", {
      method:"POST", signal:AbortSignal.timeout(10_000), redirect:"error",
      body:new URLSearchParams({ grant_type:"authorization_code", client_id:client, client_secret:secret, code:req.body.code, code_verifier:session.verifier, redirect_uri:`${ssoPublicBase()}/connect/sso/callback` }),
    });
    if (!response.ok) throw new Error();
    const result = await response.json() as {id_token?: string};
    if (!result.id_token) throw new Error();
    const owner = await verifyEntraToken(result.id_token,{ audience:client, nonce:session.nonce });
    await ensureConnectionStoreInitialized();
    const expiresAt = await getConnectionStore().entra.pendingRequestExpiry(owner,session.request);
    if (!expiresAt) throw new Error();
    cookie(res,{ purpose:"connected", exp:Math.min(session.exp,expiresAt), request:session.request, owner, state:random() });
    res.redirect(303,"/connect?sso=1");
  }));
  app.post("/connect/sso/complete", safe(async (req,res) => {
    sameOrigin(req);
    const session = readCookie(req);
    if (session.purpose !== "connected" || !session.owner) throw new Error();
    await readCompanyUpload(req, res);
    if (req.body.csrfToken !== session.state) throw new Error();
    ownerKey(session.owner);
    const imported = req.file ? parseCompanyCsv(req.file.buffer, true) : undefined;
    const names = imported ? imported.map(c => c.companyName) : Array.isArray(req.body.companyName) ? req.body.companyName : [req.body.companyName];
    const keys = imported ? imported.map(c => c.apiKey) : Array.isArray(req.body.apiKey) ? req.body.apiKey : [req.body.apiKey];
    if (names.length !== keys.length || names.length > SSO_MAX_COMPANIES) throw new CompanyInputError("Enter a matching company name and API key for up to five companies.");
    const companies: {companyName:string;apiKey:string;expiresAt:number;credentialValidatedAt:number}[] = [];
    for (let i=0;i<names.length;i++) {
      if (!names[i] && !keys[i]) continue;
      if (typeof names[i] !== "string" || typeof keys[i] !== "string" || !names[i].trim() || !keys[i].trim() || names[i].length > 200 || keys[i].length > 4096) throw new CompanyInputError("Enter a company name (up to 200 characters) and API key (up to 4096 characters) for each company.");
      companies.push({companyName:names[i].trim(),apiKey:keys[i].trim(),expiresAt:Date.now()+getApiKeyExpirationMs(),credentialValidatedAt:Date.now()});
    }
    if (!companies.length) throw new CompanyInputError("Enter at least one company name and API key, or choose a CSV file.");
    await ensureConnectionStoreInitialized();
    const store = getConnectionStore().entra;
    if (!await store.checkPendingRequest(session.owner,session.request,true)) throw new Error();
    try {
      const validated = [];
      for (const company of companies) {
        const result = await entraRequestOwner.run(session.owner, () => validateCompanyApiKeyCredential(company.companyName,company.apiKey));
        if (result.valid) validated.push(company);
      }
      await store.saveCompanies(session.owner,validated);
      res.setHeader("Set-Cookie",`${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=0`);
      if (!validated.length) {
        res.status(400).type("html").send(renderSsoErrorPage("No companies were connected because the credentials could not be validated. Check the company details and API keys, then request a new connection link."));
        return;
      }
      res.type("html").send(renderSsoSuccessPage(validated.map(c => c.companyName), companies.length - validated.length));
    } catch {
      res.status(500).type("html").send(renderSsoErrorPage("RED could not finish connecting your companies. Please request a new connection link and try again."));
    }
  }));
}
