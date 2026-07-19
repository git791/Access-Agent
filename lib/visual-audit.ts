import OpenAI from "openai";
import { z } from "zod";
import type { Issue } from "./contracts";
import { required } from "./config";

const VisualIssueSchema = z.object({ title: z.string(), wcag: z.string(), impact: z.enum(["Critical", "Serious", "Moderate"]), helps: z.string(), selector: z.string().nullable() });
const VisualResultSchema = z.object({ issues: z.array(VisualIssueSchema) });
const visualSchema = { type: "object", additionalProperties: false, required: ["issues"], properties: { issues: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "wcag", "impact", "helps", "selector"], properties: { title: { type: "string" }, wcag: { type: "string" }, impact: { type: "string", enum: ["Critical", "Serious", "Moderate"] }, helps: { type: "string" }, selector: { type: ["string", "null"] } } } } } } as const;
const verdictSchema = { type: "object", additionalProperties: false, required: ["resolved", "regression", "explanation"], properties: { resolved: { type: "boolean" }, regression: { type: "boolean" }, explanation: { type: "string" } } } as const;

export async function inspectRenderedPage(screenshot: Buffer, accessibilityTree: string, staticIssues: Issue[]): Promise<Issue[]> {
  const client = new OpenAI({ apiKey: required("OPENAI_API_KEY") });
  const prompt = `You are the visual accessibility auditor in a closed verification loop. Inspect the screenshot and accessibility tree. Flag only WCAG-relevant barriers missed by the provided axe findings. Return JSON: { issues: [{ title, wcag, impact: Critical|Serious|Moderate, helps, selector }] }. selector must be a CSS selector when you can identify one, otherwise null. Do not claim a fix or verification. Axe findings: ${JSON.stringify(staticIssues)}. Accessibility tree: ${accessibilityTree.slice(0, 12_000)}`;
  const response = await client.responses.create({
    model: process.env.OPENAI_VISION_MODEL || "gpt-5.4",
    input: [{ role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", image_url: `data:image/png;base64,${screenshot.toString("base64")}`, detail: "high" }] }],
    text: { format: { type: "json_schema", name: "visual_audit", strict: true, schema: visualSchema } }
  });
  const parsed = VisualResultSchema.safeParse(JSON.parse(response.output_text));
  if (!parsed.success) throw new Error("Visual auditor returned an invalid response.");
  return parsed.data.issues.map((issue, index) => ({ ...issue, selector: issue.selector ?? undefined, id: `vision-${index}`, status: "Found" }));
}

const VerdictResponseSchema = z.object({ resolved: z.boolean(), regression: z.boolean(), explanation: z.string() });

export async function verifyRenderedFix(before: Buffer, after: Buffer, issue: Issue, afterTree: string) {
  const client = new OpenAI({ apiKey: required("OPENAI_API_KEY") });
  const prompt = `You are the verification role in an accessibility remediation workflow. Compare the before and after screenshots and the after accessibility tree for this target issue: ${JSON.stringify(issue)}. Return JSON only: { resolved: boolean, regression: boolean, explanation: string }. resolved may only be true when the target barrier is clearly gone; regression must be true for any meaningful new accessibility or visual failure. After tree: ${afterTree.slice(0, 12_000)}`;
  const response = await client.responses.create({
    model: process.env.OPENAI_VISION_MODEL || "gpt-5.4",
    input: [{ role: "user", content: [
      { type: "input_text", text: prompt },
      { type: "input_image", image_url: `data:image/png;base64,${before.toString("base64")}`, detail: "high" },
      { type: "input_image", image_url: `data:image/png;base64,${after.toString("base64")}`, detail: "high" }
    ] }],
    text: { format: { type: "json_schema", name: "verification_verdict", strict: true, schema: verdictSchema } }
  });
  const parsed = VerdictResponseSchema.safeParse(JSON.parse(response.output_text));
  if (!parsed.success) throw new Error("Verification role returned an invalid verdict.");
  return parsed.data;
}
