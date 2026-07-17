import { z } from "zod";

/** Typed handoffs keep the four-agent loop inspectable and independently testable. */
export const IssueSchema = z.object({
  id: z.string(),
  title: z.string(),
  wcag: z.string(),
  impact: z.enum(["Critical", "Serious", "Moderate"]),
  helps: z.string(),
  selector: z.string().optional(),
  status: z.enum(["Found", "Verified", "Review"])
});

export const AuditHandoffSchema = z.object({
  runId: z.string().uuid(),
  targetUrl: z.string().url(),
  screenshotPath: z.string(),
  accessibilityTree: z.string(),
  issues: z.array(IssueSchema)
});

export const PatchHandoffSchema = z.object({
  issueId: z.string(),
  branch: z.string(),
  filesChanged: z.array(z.string()),
  diff: z.string(),
  attempt: z.number().int().min(1).max(3)
});

export const VerdictSchema = z.object({
  issueId: z.string(),
  resolved: z.boolean(),
  regression: z.boolean(),
  explanation: z.string(),
  afterScreenshotPath: z.string()
});

export type Issue = z.infer<typeof IssueSchema>;
export type AuditHandoff = z.infer<typeof AuditHandoffSchema>;
export type PatchHandoff = z.infer<typeof PatchHandoffSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
