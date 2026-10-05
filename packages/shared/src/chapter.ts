/**
 * A chapter is the index of a story block: the full text lives in
 * `chapter-NN.md` inside the world directory, the index row lives in the
 * database. `canonRefs` ties the chapter events to the canon entries
 * that make them true, so it is always known which canon it rests on.
 */
export interface Chapter {
  id: string;
  worldId: string;
  n: number;
  locale: string;
  title: string;
  summary: string;
  /** Relative path of the markdown file inside the world directory. */
  path: string;
  tokenStart: number;
  tokenEnd: number;
  canonRefs: string[];
  /** Arc this chapter belongs to, if the campaign uses arcs. */
  arcId: string | null;
  createdAt: string;
}

/** Shape returned by the model when it closes a chapter. */
export interface ChapterDraft {
  title: string;
  summary: string;
  notableEvents: string[];
  canonRefs: string[];
  introducedEntities: string[];
}

/**
 * A manual correction to a canon entry.
 *
 * Different from `CanonAuditEntry`, which is the **reviewer verdict** on
 * a chapter claim. Keep the two separate because asking how many
 * facts were verified by the model and how many changed by a person are two
 * numbers with different weight, and putting them in the same table makes
 * answering impossible.
 *
 * `beforeValue` and `afterValue` are raw JSON because the entry shape
 * changes from one version to the next and a fixed-column table starts
 * losing information at the first schema migration.
 */
export interface CanonEdit {
  id: string;
  worldId: string;
  /** Id of the corrected entry. Stays valid even if the entry was removed. */
  entryId: string;
  subject: string;
  /** List of touched fields, so the JSON is not repeated in a single column. */
  fields: string;
  beforeValue: string;
  afterValue: string;
  /** Why the person corrected it. Useful because in six months the reason matters more than the value. */
  reason: string;
  createdAt: string;
}

/** Canon-check verdict, on explicit player request. */
export const CANON_VERDICTS = ["canon", "unsupported", "contradiction", "retcon_aware"] as const;

export type CanonVerdict = (typeof CANON_VERDICTS)[number];

export interface CanonAuditEntry {
  id: string;
  worldId: string;
  chapterId: string | null;
  claim: string;
  verdict: CanonVerdict;
  canonRef: string;
  suggestion: string;
  createdAt: string;
}
