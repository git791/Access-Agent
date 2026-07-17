import type { Issue } from "./contracts";

const rank: Record<Issue["impact"], number> = { Critical: 0, Serious: 1, Moderate: 2 };

export function mergeAndPrioritize(staticIssues: Issue[], visualIssues: Issue[]) {
  const unique = new Map<string, Issue>();
  for (const issue of [...staticIssues, ...visualIssues]) {
    const key = `${issue.wcag}:${issue.selector ?? issue.title}`.toLowerCase();
    const previous = unique.get(key);
    if (!previous || rank[issue.impact] < rank[previous.impact]) unique.set(key, issue);
  }
  return [...unique.values()].sort((left, right) => rank[left.impact] - rank[right.impact] || left.title.localeCompare(right.title));
}
