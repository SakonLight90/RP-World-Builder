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

/**
 * A playable scenario inside a world.
 *
 * A world is a setting and a start is a way into it: one world can offer a start in one region
 * and another in a different one, and the player picks when they begin. Selecting a start is
 * what makes the first message of the conversation that scenario's opening, instead of a
 * generic prologue.
 *
 * `narration` is written to be the first thing the player reads. It sets the scene, hands the
 * player a situation, and stops: it never decides who they are. A start that put words in the
 * player's mouth would take away the only decision that matters at the start of a roleplay.
 *
 * `playable` is not decorative. Sources that have lore but no scenario to step into stay in the
 * library as reference: the narrator can cite them when the player names them, but there is
 * nothing to begin from.
 */
export interface WorldStart {
  /** Stable identifier, derived from the game: survives a rename of the name. */
  id: string;
  /** Shown in the selector. The name of the game. */
  name: string;
  /** Which game the scenario comes from, e.g. `new-vegas`. */
  game: string;
  /** False for lore-only games: present in the library, absent from the selector. */
  playable: boolean;
  /** The opening narration, shown as the first message of the conversation. */
  narration: string;
  /**
   * A place name from the canon that this scenario starts in.
   *
   * Not a database id and not something the player picks: the place the scenario begins in,
   * matched against the world's places by name when the turn is sent.
   *
   * It exists because the narrator has to know where the player is from the first turn, and
   * the narration alone does not say it in a form the narrator can use: it reads prose and
   * looks up a record. Without this the state card has nothing to put in it and the narrator
   * places the player wherever the prose happens to be standing.
   *
   * `null` when the scenario does not name one, and a name that matches nothing sends
   * nothing: a custom start written by hand must not become a guess.
   */
  location?: string;
}

/**
 * A world's starts and which one is in play.
 *
 * Both live in one place, and not as two independent fields, because the question
 * "which start is selected" only has a meaning relative to the list. Stored apart,
 * a selection can point at a start that no longer exists, and the conversation
 * would open on a scenario with no narration to show.
 *
 * `selectedId` is null and not "the first one" on purpose. The opening narration
 * is the player's first real choice, and picking one for them would spend it
 * before they arrive.
 */
export interface StartsState {
  list: WorldStart[];
  selectedId: string | null;
}

export const EMPTY_STARTS: StartsState = { list: [], selectedId: null };

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
  /**
   * The playable starts, and which one is in play.
   *
   * Never absent and never optional: a world with no starts is a legitimate state
   * reached by every world built from scratch, so it is an empty list rather than
   * a missing field. The client draws the selector from this, and a missing field
   * would mean a check on every read to tell "no starts" apart from "old database".
   */
  starts: StartsState;
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
