import assert from "node:assert/strict";
import test from "node:test";
import { mergeAndPrioritize } from "../../lib/prioritize";

test("prioritization deduplicates a shared issue and keeps the higher impact", () => {
  const result = mergeAndPrioritize(
    [{ id: "axe-1", title: "Contrast", wcag: "wcag143", impact: "Serious", helps: "Low vision", selector: "#buy", status: "Found" }],
    [{ id: "vision-1", title: "Contrast is hard to see", wcag: "wcag143", impact: "Critical", helps: "Low vision", selector: "#buy", status: "Found" }]
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].impact, "Critical");
});

test("prioritization places critical findings before moderate findings", () => {
  const result = mergeAndPrioritize(
    [{ id: "moderate", title: "Heading", wcag: "wcag131", impact: "Moderate", helps: "Screen readers", status: "Found" }, { id: "critical", title: "Keyboard trap", wcag: "wcag211", impact: "Critical", helps: "Keyboard", status: "Found" }],
    []
  );
  assert.deepEqual(result.map((issue) => issue.id), ["critical", "moderate"]);
});
