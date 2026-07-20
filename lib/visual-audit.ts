import { z } from "zod";
import type { Issue } from "./contracts";
import { accessibilityContextLimit, aiClient, aiProvider, imageDetail, modelFor, outputFormat } from "./ai-provider";

const VisualIssueSchema = z.object({ title: z.string(), wcag: z.string(), impact: z.enum(["Critical", "Serious", "Moderate"]), helps: z.string(), selector: z.string() });
const VisualResultSchema = z.object({ issues: z.array(VisualIssueSchema) });
const visualSchema = { type: "object", additionalProperties: false, required: ["issues"], properties: { issues: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "wcag", "impact", "helps", "selector"], properties: { title: { type: "string" }, wcag: { type: "string" }, impact: { type: "string", enum: ["Critical", "Serious", "Moderate"] }, helps: { type: "string" }, selector: { type: "string" } } } } } } as const;
const verdictSchema = { type: "object", additionalProperties: false, required: ["resolved", "regression", "explanation"], properties: { resolved: { type: "boolean" }, regression: { type: "boolean" }, explanation: { type: "string" } } } as const;

async function generateVisionJson(prompt: string, screenshots: Buffer[], name: string, schema: any): Promise<string> {
  const client = aiClient();
  const encoded = screenshots.map((screenshot) => `data:image/png;base64,${screenshot.toString("base64")}`);
  if (aiProvider() === "groq") {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await client.chat.completions.create({
          model: modelFor("vision"),
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              ...encoded.map((url) => ({ type: "image_url" as const, image_url: { url, detail: imageDetail() } }))
            ]
          }]
        });
        return response.choices[0]?.message.content ?? "";
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : "";
        if (attempt === 0 && /premature close|econnreset|fetch failed/i.test(message)) {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }
  const format = outputFormat(name, schema);
  const response = await client.responses.create({
    model: modelFor("vision"),
    input: [{ role: "user", content: [{ type: "input_text", text: prompt }, ...encoded.map((image_url) => ({ type: "input_image" as const, image_url, detail: imageDetail() }))] }],
    text: { format: format! }
  });
  return response.output_text;
}

export async function inspectRenderedPage(screenshot: Buffer, accessibilityTree: string, staticIssues: Issue[]): Promise<Issue[]> {
  const prompt = `You are the visual accessibility auditor in a closed verification loop. Inspect the screenshot and accessibility tree. Flag only WCAG-relevant barriers missed by the provided axe findings. Return only one valid JSON object with this exact shape: {"issues":[{"title":"string","wcag":"string","impact":"Critical|Serious|Moderate","helps":"string","selector":"string"}]}. Do not use Markdown, code fences, or explanatory text. selector must be a CSS selector when you can identify one; otherwise use an empty string. Do not claim a fix or verification. Axe findings: ${JSON.stringify(staticIssues)}. Accessibility tree: ${accessibilityTree.slice(0, accessibilityContextLimit())}`;
  const parsed = VisualResultSchema.safeParse(parseJsonObject(await generateVisionJson(prompt, [screenshot], "visual_audit", visualSchema)));
  if (!parsed.success) throw new Error("Visual auditor returned an invalid response.");
  return parsed.data.issues.map((issue, index) => ({ ...issue, selector: issue.selector || undefined, id: `vision-${index}`, status: "Found" }));
}

const VerdictResponseSchema = z.object({ resolved: z.boolean(), regression: z.boolean(), explanation: z.string() });

function parseJsonObject(output: string): unknown {
  const trimmed = output.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first < 0 || last < first) throw new Error("AI response did not contain a JSON object.");
  return JSON.parse(trimmed.slice(first, last + 1));
}

export async function verifyRenderedFix(before: Buffer, after: Buffer, issue: Issue, afterTree: string) {
  const prompt = `You are the verification role in an accessibility remediation workflow. Compare the before and after screenshots and the after accessibility tree for this target issue: ${JSON.stringify(issue)}. Return only one valid JSON object with this exact shape: {"resolved":true,"regression":false,"explanation":"string"}. Do not use Markdown, code fences, or explanatory text. resolved may only be true when the target barrier is clearly gone; regression must be true for any meaningful new accessibility or visual failure. After tree: ${afterTree.slice(0, accessibilityContextLimit())}`;
  const parsed = VerdictResponseSchema.safeParse(parseJsonObject(await generateVisionJson(prompt, [before, after], "verification_verdict", verdictSchema)));
  if (!parsed.success) throw new Error("Verification role returned an invalid verdict.");
  return parsed.data;
}
