/**
 * Bible sections. They are the initial context that must never be lost:
 * the narrator agent's `gm.md` contains them in full, so they survive
 * any session compaction.
 */
export const BIBLE_SECTIONS = ["premise", "rules", "tone", "style", "conventions"] as const;

export type BibleSection = (typeof BIBLE_SECTIONS)[number];

export type Bible = Record<BibleSection, string>;

export const EMPTY_BIBLE: Bible = {
  premise: "",
  rules: "",
  tone: "",
  style: "",
  conventions: "",
};

export const WORLD_CANON_MODES = ["strict"] as const;

export type WorldCanonMode = (typeof WORLD_CANON_MODES)[number];

/**
 * Reasoning power requested from the model.
 *
 * "default" is not the maximum: it means **asking for nothing** and leaving the model
 * at its base behavior. It is the right choice for a narrator, because long
 * reasoning does not improve a story and costs: it spends tokens the
 * chapter would better spend remembering the story. Whoever wants more depth
 * asks for it explicitly, and pays for it.
 */
export const REASONING_EFFORTS = ["default", "low", "medium", "high"] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "default";

/**
 * A lore library required by a world.
 *
 * `hash` is not decorative: it is the content fingerprint from when the world
 * declared the requirement. If the library on disk changes, the hash no
 * longer matches and validation reports it, instead of letting a
 * campaign written against one version keep citing another.
 */
export interface LibraryRequirement {
  id: string;
  version: string;
  hash: string;
}

/**
 * The protagonist the player brings along.
 *
 * Declared by the player, never inferred. The narrator does not know who they are, and
 * asking at every new campaign costs two things: one question at the start of
 * every story and a name that changes from one session to the next, with a campaign
 * that stops being the same one. Here the answer exists exactly once.
 *
 * Three fields and not free text so the narrator can cite the name
 * and role without hunting for them inside a sentence.
 */
export interface PlayerCharacter {
  name: string;
  description: string;
  role: string;
}

export interface World {
  id: string;
  name: string;
  slug: string;
  /** Language the canon is written in. Proper names do not change it. */
  baseLocale: string;
  /** Language the narrator writes in. Follows the UI language. */
  activeLocale: string;
  description: string;
  canonMode: WorldCanonMode;
  model: string;
  smallModel: string;
  /** Reasoning power requested. "default" = ask for nothing. */
  reasoningEffort: ReasoningEffort;
  /**
   * The context window in tokens, chosen by the player, or null to ask the
   * provider what the model accepts. Free models and paid plans differ by an
   * order of magnitude and providers do not always declare a window, so the
   * player is the one who knows which plan they are on.
   */
  contextLimit: number | null;
  /** Chapter-closing threshold, as a fraction of the context window. */
  chapterThresholdRatio: number;
  /** Share of the context window reserved for the canon slice. */
  canonBudgetRatio: number;
  opencodeDir: string;
  opencodeSessionId: string | null;
  /** Lore libraries this world requires. Read-only, never modified. */
  libraries: LibraryRequirement[];
  /**
   * The protagonist, if the player declared one.
   *
   * Optional and not `null`: a world without a character is a legitimate
   * state, not an incomplete world, and is declared by the absence of the field.
   * An empty object, or worse an empty string, would be a nameless character:
   * the narrator would fill it in and the campaign would start with
   * a protagonist the player did not write.
   */
  player?: PlayerCharacter;
  isTemplate: boolean;
  templateAuthor: string | null;
  createdAt: string;
  updatedAt: string;
}

export const WORLD_DEFAULTS = {
  chapterThresholdRatio: 0.7,
  canonBudgetRatio: 0.25,
  reasoningEffort: DEFAULT_REASONING_EFFORT,
} as const;

export interface Location {
  id: string;
  worldId: string;
  name: string;
  description: string;
  parentId: string | null;
  aliases: string[];
  era: string;
}

export interface Character {
  id: string;
  worldId: string;
  name: string;
  role: string;
  description: string;
  personality: string;
  secret: string;
  status: string;
  locationId: string | null;
  isPlayer: boolean;
  /** Only player-promoted canon enters the state. */
  canonical: boolean;
  era: string;
  createdAt: string;
}

export interface Relationship {
  worldId: string;
  fromCharacterId: string;
  toCharacterId: string;
  affinity: number;
  trust: number;
  note: string;
}
