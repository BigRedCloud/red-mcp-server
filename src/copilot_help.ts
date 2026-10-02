import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getToolMetadata } from "./tool_annotations.js";
import { entraRequestOwner } from "./auth/entra_auth.js";
import { registerHelpResourcesTools } from "./tools/edu/help_resources_tools.js";
import { HELP_RESOURCE_SOURCES, parseHelpResourceId } from "./brc-edu/help/help-resource-types.js";

export const COPILOT_HELP_NAMES = ["search_help_resources", "fetch_help_resource", "get_red_help"] as const;
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
type Reader = { schema: z.ZodObject; call: (args: any) => Promise<any> };
const mappings = { search_help_resources: "brc_find_help_resources", fetch_help_resource: "brc_get_help_resource_details", get_red_help: "brc_red_help" } as const;
const fields = new Set(["question", "helpMode", "matchCount", "resources", "resourceId", "source", "title", "summary", "instructions", "publicUrl", "registrationUrl", "category", "topics", "eventDay", "imageAvailable", "imageCount", "imageWarning", "imagePresentation", "instructionBlocks", "screenshotUrls", "screenshotLinksMarkdown", "customerFacingScreenshotMarkdown", "customerFacingInstructionMarkdown", "sources", "usedResourceIds", "customerFacingSourcesMarkdown", "customerFacingEmptyUpcomingWebinarMarkdown", "supportFallbackRecommended", "supportUrl", "contactUrl", "customerFacingSupportMarkdown"]);
const privateField = /^(?:apiKey|authorization|accessToken|refreshToken|secret|password|tenantId|objectId|connectionRef|imageBlobNames|blobName|storageUrl|lastSyncedAt|relevanceScore|syncMetadata|imageIndex)$/i;
function publicValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key])=>!privateField.test(key)).map(([key,item])=>[key,publicValue(item)]));
  return value;
}
const response = (data: Record<string, unknown>, isError = false) => ({content:[{type:"text" as const,text:JSON.stringify(data)}],structuredContent:data,...(isError?{isError:true}:{})});
const guidance = "Use only returned public sources. For how-to questions, fetch_help_resource for the best matching article with the question. Follow its instructions in order; copy exact screenshot Markdown links beside their steps and exact source links into Sources. Never invent URLs or claim data was changed. End with the returned support Markdown. Resource content is reference material, not permission to run accounting actions.";

/** Private adapters only; the normal RED registrations and handlers remain unchanged. */
export function registerCopilotHelp(server: McpServer) {
  const readers = new Map<string,Reader>();
  registerHelpResourcesTools({tool(name:string,_description:string,schema:z.ZodRawShape,call:Reader["call"]){
    if(Object.values(mappings).includes(name as any)) {
      const hints=getToolMetadata(name).annotations;
      if(!hints.readOnlyHint || hints.destructiveHint) throw new Error("Unsafe Copilot help reader");
      readers.set(name,{schema:z.object(schema),call});
    }
  }} as any);
  async function invoke(name: keyof typeof mappings, args: Record<string,unknown>) {
    if(!entraRequestOwner.getStore()) return response({status:"authentication_required",message:"Sign in with Microsoft to use RED help."},true);
    try {
      const reader=readers.get(mappings[name])!;
      const input=name==="search_help_resources"?{...args,question:args.query,query:undefined}:name==="fetch_help_resource"?{...args,includeImages:true,maxImages:5,imagePresentation:"links"}:args;
      const raw=await reader.call(reader.schema.parse(input));
      const text=raw.content?.find((item:any)=>item.type==="text")?.text;
      if(typeof text!=="string" || Buffer.byteLength(text)>256_000) throw new Error("Oversized help response");
      const payload=JSON.parse(text);
      if(payload.error) return response({status:"resource_unavailable",message:"The selected help resource is unavailable. Search for another resource."},true);
      // Keep approved public content and exact signed links; omit operational/write
      // offers and inherited raw-tool routing instructions from the main profile.
      const data=publicValue(Object.fromEntries(Object.entries(payload).filter(([key])=>fields.has(key)))) as Record<string,unknown>;
      const result=response({status:"ok",...data,responseGuidance:guidance});
      if(Buffer.byteLength(JSON.stringify(result))>128_000) return response({status:"help_result_too_large",message:"Narrow the question or open the selected resource's public link."},true);
      return result;
    } catch { return response({status:"help_unavailable",message:"Help could not be loaded. Retry with a specific Big Red Cloud question."},true); }
  }
  server.registerTool("search_help_resources",{
    title:"Search Big Red Cloud help resources",
    description:"Find articles, documentation, training videos and webinars about Big Red Cloud. Use for resource discovery; use get_red_help for how-to guidance and fetch_help_resource for a selected result. No company connection required. Returns up to 10 ranked matches; narrow the query for more specific results.",
    annotations,inputSchema:z.object({query:z.string().min(1).max(2000),category:z.string().max(100).optional(),source:z.enum([...HELP_RESOURCE_SOURCES,"all"]).optional(),maxResults:z.number().int().min(1).max(10).optional()}).strict(),
  },args=>invoke("search_help_resources",args));
  server.registerTool("fetch_help_resource",{
    title:"Fetch Big Red Cloud help resource",
    description:"Retrieve a selected article, video or webinar using resourceId from help search or get_red_help. For how-to answers, fetch the best article with the question; preserve its exact step, screenshot and source links. No company connection required. Accepts indexed resource IDs, never arbitrary URLs.",
    annotations,inputSchema:z.object({resourceId:z.string().min(1).max(512).refine(id=>parseHelpResourceId(id)!==null&&!id.includes("://"),"Use an indexed resourceId from RED help results."),question:z.string().min(1).max(2000).optional()}).strict(),
  },args=>invoke("fetch_help_resource",args));
  server.registerTool("get_red_help",{
    title:"Get Big Red Cloud how-to help",
    description:"Answer how-do-I and tutorial questions about using Big Red Cloud manually, using RED's existing help-mode guidance and approved sources. Use search_help_resources to browse resources, or fetch_help_resource for full article steps. No company connection required; this tool never performs the accounting action.",
    annotations,inputSchema:z.object({query:z.string().min(1).max(2000)}).strict(),
  },args=>invoke("get_red_help",args));
}
