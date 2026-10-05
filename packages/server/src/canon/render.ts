import type { CanonEntry } from "@rpwb/shared";
import { CANON_TIERS, type CanonSlice, type CanonTier } from "./inject.js";

const TIER_HEADINGS: Record<CanonTier, string> = {
  rules: "ABSOLUTE WORLD RULES",
  eras: "ACTIVE ERA",
  present: "CHARACTERS ON STAGE",
  location: "WHERE YOU ARE",
  mentioned: "CITED BY THE PLAYER",
  search: "REFERENCES FOUND IN THE CANON",
};

const TIER_INTENT: Record<CanonTier, string> = {
  rules: "They come before everything else and always hold.",
  eras: "The story takes place only in these eras.",
  present: "They are here with you, now.",
  location: "Everything you can touch comes from here.",
  mentioned: "The player just cited them.",
  search: "References found in the canon for what you said.",
};

/**
 * The slice text is what the narrator actually reads, so it is written
 * to instruct, not to read well. Section headings tell the model *why*
 * that block is there: knowing an entry is the current situation
 * rather than background changes how it gets used.
 */
export function renderCanonSlice(slice: CanonSlice): string {
  if (slice.entries.length === 0) return "";

  const blocks: string[] = [];
  for (const tier of CANON_TIERS) {
    const lines: string[] = [];
    slice.tiers.forEach((current, index) => {
      if (current !== tier) return;
      const entry = slice.entries[index];
      if (entry) lines.push(renderEntry(entry));
    });
    if (lines.length === 0) continue;
    blocks.push(`### ${TIER_HEADINGS[tier]}\n*${TIER_INTENT[tier]}*\n${lines.join("\n")}`);
  }

  return [
    "## CANON",
    "The entries below are authoritative: they are the truth of the world. Do not",
    "contradict them, do not fill in what is missing by inventing, and do not",
    "treat a fact absent from here as if it did not exist.",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

function renderEntry(entry: CanonEntry): string {
  const lines: string[] = [];
  const label =
    entry.status === "retconned"
      ? `${entry.subject} [SUPERSEDED: the retcon holds]`
      : entry.subject;
  lines.push(`**${label}**`);
  if (entry.summary.trim() !== "") lines.push(entry.summary.trim());
  for (const fact of entry.facts) lines.push(`- ${fact}`);
  return lines.join("\n");
}

/**
 * Compact summary for the turn debug panel: what landed in
 * context and what was dropped, so fidelity is checkable, not a
 * promise.
 */
export function summarizeSlice(slice: CanonSlice): string[] {
  const lines: string[] = [];
  for (const report of slice.reports) {
    if (report.included === 0 && report.dropped === 0) continue;
    const dropped = report.dropped === 0 ? "" : `, dropped ${report.dropped} (${report.reason})`;
    lines.push(`${report.tier}: ${report.included} entries, ${report.tokens} tokens${dropped}`);
  }
  if (slice.overBudget) {
    lines.push(
      `WARNING: the mandatory tiers alone exceed the budget (${slice.tokens} > ${slice.budgetTokens})`,
    );
  }
  return lines;
}
