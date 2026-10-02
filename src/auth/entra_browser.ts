import { createHash, randomBytes } from "node:crypto";
import type { Express, Request, Response } from "express";
import { decryptCredentialSecret, encryptCredentialSecret } from "./credential_encryption.js";
import { ensureConnectionStoreInitialized, getConnectionStore } from "./connection_store.js";
import { entraRequestOwner, verifyEntraToken } from "./entra_auth.js";
import { isPendingRequestHandle, ownerKey, type EntraOwner } from "./entra_store.js";
import { renderConnectPage, renderManageConfirmPage, renderManageErrorPage, renderManagePage, renderManageSignInPage, renderSsoSignInPage, renderSsoErrorPage, renderSsoResultPage } from "./connection_page.js";
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
const MANAGE_COOKIE = "__Host-red-manage";
const random = () => randomBytes(32).toString("base64url");
type BrowserState = { purpose: "oauth" | "connected" | "manage"; flow?: "connect" | "manage"; exp: number; request?: string; state: string; verifier?: string; nonce?: string; owner?: EntraOwner };
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
function writeCookie(res: Response, name: string, value: BrowserState) {
  res.setHeader("Set-Cookie", `${name}=${encodeURIComponent(encryptCredentialSecret(JSON.stringify(value)))}; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=600`);
}
function cookie(res: Response, value: BrowserState) {
  writeCookie(res, COOKIE, value);
}
function microsoftAuthorizeUrl(session: BrowserState): string {
  const client = process.env.RED_ENTRA_WEB_CLIENT_ID;
  if (!client || !session.verifier || !session.nonce) throw new Error();
  const url = new URL("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize");
  url.search = new URLSearchParams({ client_id:client, response_type:"code", response_mode:"form_post", redirect_uri:`${ssoPublicBase()}/connect/sso/callback`, scope:"openid profile", state:session.state, nonce:session.nonce, code_challenge:createHash("sha256").update(session.verifier).digest("base64url"), code_challenge_method:"S256" }).toString();
  return url.toString();
}
export function openSsoEnvelope(value: string): string {
  // Node's base64 decoder is permissive; reject noncanonical/trailing input.
  const parts = value.split(".");
  if (value.length > 8192 || parts.length !== 3 || parts.some(part => !part || Buffer.from(part,"base64").toString("base64") !== part)) throw new Error("Invalid SSO state.");
  return decryptCredentialSecret(value);
}
function readNamedCookie(req: Request, name: string): BrowserState {
  const value = req.headers.cookie?.split(";").map(s=>s.trim()).find(s=>s.startsWith(`${name}=`))?.slice(name.length+1);
  if (!value) throw new Error("Sign-in required.");
  const data = JSON.parse(openSsoEnvelope(decodeURIComponent(value))) as BrowserState;
  if (!data.exp || data.exp <= Date.now()) throw new Error("Sign-in expired.");
  return data;
}
function readCookie(req: Request): BrowserState {
  return readNamedCookie(req, COOKIE);
}
function matchingOauth(req: Request): BrowserState {
  const posted = req.body?.state;
  if (typeof posted !== "string" || !posted) throw new Error();
  for (const name of [MANAGE_COOKIE, COOKIE]) {
    try {
      const session = readNamedCookie(req, name);
      if (session.purpose === "oauth" && session.state === posted) return session;
    } catch { /* The other browser flow may hold a different cookie. */ }
  }
  throw new Error();
}
function readManageSession(req: Request): BrowserState {
  const session = readNamedCookie(req, MANAGE_COOKIE);
  if (session.purpose !== "manage" || !session.owner) throw new Error();
  ownerKey(session.owner);
  return session;
}
function rotateManageSession(res: Response, session: BrowserState): BrowserState {
  const next: BrowserState = { purpose: "manage", flow: "manage", exp: session.exp, owner: session.owner, state: random() };
  writeCookie(res, MANAGE_COOKIE, next);
  return next;
}
function sameOrigin(req: Request) { if (req.headers.origin !== ssoPublicBase()) throw new Error("Invalid request origin."); }
function safe(handler: (req: Request,res: Response)=>Promise<void>, renderError: (message?: string) => string = renderSsoErrorPage) {
  return async (req: Request,res: Response) => { headers(res); try { await handler(req,res); } catch (error) { res.status(error instanceof CompanyInputError ? 400 : 401).type("html").send(renderError(error instanceof CompanyInputError ? error.message : undefined)); } };
}
function collectSubmittedCompanies(req: Request): {companyName:string;apiKey:string;expiresAt:number;credentialValidatedAt:number}[] {
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
  return companies;
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
      if (!session.request || !await getConnectionStore().entra.checkPendingRequest(session.owner, session.request)) throw new Error();
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
    res.redirect(303, microsoftAuthorizeUrl(session));
  }));
  app.post("/connect/sso/callback", safe(async (req,res) => {
    const session = matchingOauth(req);
    if (!session.verifier || !session.nonce || typeof req.body.code !== "string") throw new Error();
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
    if (session.flow === "manage") {
      writeCookie(res, MANAGE_COOKIE, { purpose:"manage", flow:"manage", exp:session.exp, owner, state:random() });
      res.redirect(303, "/manage-companies");
      return;
    }
    if (!session.request) throw new Error();
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
    const companies = collectSubmittedCompanies(req);
    await ensureConnectionStoreInitialized();
    const store = getConnectionStore().entra;
    if (!session.request || !await store.checkPendingRequest(session.owner,session.request,true)) throw new Error();
    try {
      const validated = [];
      const failedNames: string[] = [];
      for (const company of companies) {
        const result = await entraRequestOwner.run(session.owner, () => validateCompanyApiKeyCredential(company.companyName,company.apiKey));
        if (result.valid) validated.push(company);
        else failedNames.push(company.companyName);
      }
      await store.saveCompanies(session.owner,validated);
      res.setHeader("Set-Cookie",`${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=0`);
      res.status(validated.length ? 200 : 400).type("html").send(
        renderSsoResultPage(validated.map(c => c.companyName), failedNames)
      );
    } catch {
      res.status(500).type("html").send(renderSsoErrorPage("RED could not finish connecting your companies. Please request a new connection link and try again."));
    }
  }));
  async function sendManagePage(res: Response, session: BrowserState, notice?: string, status = 200) {
    await ensureConnectionStoreInitialized();
    const companies = await getConnectionStore().entra.listCompanies(session.owner!);
    res.status(status).type("html").send(renderManagePage({
      csrfToken: session.state,
      companies: companies.map(company => company.companyName),
      notice,
    }));
  }
  app.get("/manage-companies", async (req, res) => {
    headers(res);
    let session: BrowserState;
    try { session = readManageSession(req); }
    catch {
      res.type("html").send(renderManageSignInPage());
      return;
    }
    try { await sendManagePage(res, session); }
    catch { res.status(500).type("html").send(renderManageErrorPage("RED could not load your companies. Return to this page and try again.")); }
  });
  app.post("/manage-companies/start", safe(async (req, res) => {
    sameOrigin(req);
    if (!process.env.RED_ENTRA_WEB_CLIENT_ID) throw new Error();
    const session: BrowserState = { purpose:"oauth", flow:"manage", exp:Date.now()+600_000, state:random(), nonce:random(), verifier:random() };
    writeCookie(res, MANAGE_COOKIE, session);
    res.redirect(303, microsoftAuthorizeUrl(session));
  }, renderManageErrorPage));
  app.post("/manage-companies/companies", safe(async (req, res) => {
    sameOrigin(req);
    const session = readManageSession(req);
    await readCompanyUpload(req, res);
    if (req.body.csrfToken !== session.state) throw new Error();
    const companies = collectSubmittedCompanies(req);
    await ensureConnectionStoreInitialized();
    try {
      const validated = [];
      const failedNames: string[] = [];
      for (const company of companies) {
        const result = await entraRequestOwner.run(session.owner!, () => validateCompanyApiKeyCredential(company.companyName, company.apiKey));
        if (result.valid) validated.push(company);
        else failedNames.push(company.companyName);
      }
      if (validated.length) {
        await getConnectionStore().entra.ensureOwner(session.owner!);
        await getConnectionStore().entra.saveCompanies(session.owner!, validated);
      }
      const next = validated.length ? rotateManageSession(res, session) : session;
      const notice = validated.length
        ? failedNames.length
          ? `Connected ${validated.map(company => company.companyName).join(", ")}. ${failedNames.join(", ")} could not be connected. Companies already linked are unchanged.`
          : `Connected ${validated.map(company => company.companyName).join(", ")}.`
        : "No companies were connected because the credentials could not be validated. Companies already linked are unchanged.";
      await sendManagePage(res, next, notice, validated.length ? 200 : 400);
    } catch {
      res.status(500).type("html").send(renderManageErrorPage("RED could not update your companies. Return to this page and try again."));
    }
  }, renderManageErrorPage));
  app.post("/manage-companies/disconnect", safe(async (req, res) => {
    sameOrigin(req);
    const session = readManageSession(req);
    if (req.body.csrfToken !== session.state) throw new Error();
    const companyName = req.body.companyName;
    if (typeof companyName !== "string" || !companyName.trim() || companyName.length > 200) throw new CompanyInputError("Choose one connected company to disconnect.");
    await ensureConnectionStoreInitialized();
    const store = getConnectionStore().entra;
    const match = (await store.listCompanies(session.owner!)).find(company => company.companyName.trim().toLowerCase() === companyName.trim().toLowerCase());
    if (!match) {
      await sendManagePage(res, session, "That company is not connected.");
      return;
    }
    if (req.body.confirm !== "yes") {
      res.type("html").send(renderManageConfirmPage({ csrfToken: session.state, companyName: match.companyName }));
      return;
    }
    if (!await store.removeCompany(session.owner!, match.companyName)) {
      await sendManagePage(res, session, "That company is not connected.");
      return;
    }
    const next = rotateManageSession(res, session);
    await sendManagePage(res, next, `${match.companyName} has been disconnected.`);
  }, renderManageErrorPage));
}
