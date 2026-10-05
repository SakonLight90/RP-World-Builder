import type { LoreDescriptor } from "./layout.js";

/**
 * The contract the engine expects from a library.
 *
 * The engine knows how to read no format: it knows how to ask which entry types
 * exist, get the index of a type, get the text of an entry, and ask whether that
 * entry is primary or only quoted. Whoever knows how to answer is an adapter, and
 * an adapter can describe a format the engine has never seen, because the variable
 * part is all inside the adapter.
 *
 * Matching too is a question and not a rule: which names are too short, which
 * words distinguish nothing and which word hooks onto an abbreviated name are
 * facts of that library, and they come back as answers.
 */

/** A library, in terms of what an adapter needs to know to read it. */
export interface LoreLibrary {
  /** Id with which the world required it. */
  id: string;
  /** The library's absolute folder. */
  dir: string;
}

/**
 * An entry as the library describes it.
 *
 * `file` is relative to the library's folder and is validated by the engine before
 * any read: it comes from data, so it is an input to be treated as such.
 */
export interface LoreRecord {
  /** Canonical name. */
  subject: string;
  /** Other forms of the name the player may use. */
  variants: string[];
  /** The labels the library wrote next to the name. */
  categories: string[];
  /** The sub-index that lists the entry: the game, the book, the archive. */
  group: string;
  /** Entry type: the name of the index section that lists it. */
  kind: string;
  /** The entry's path, relative to the library. */
  file: string;
  /** Entry owned by the sub-index, or only quoted by it. */
  primary: boolean;
  /** How many sub-indexes list this entry. */
  sources: number;
  /** Importance: the higher it is, the earlier it enters the context. */
  weight: number;
}

export interface LoreProvider {
  /** The format this adapter knows how to read. */
  readonly id: string;
  /** The normalised description this adapter is using. */
  readonly layout: LoreDescriptor;
  /** Entry types this library knows about. */
  kinds(): string[];
  /** The index of an entry type. Empty if the type does not exist or does not read. */
  readIndex(library: LoreLibrary, kind: string): Promise<LoreRecord[]>;
  /** The entry's text. */
  readEntry(library: LoreLibrary, record: Pick<LoreRecord, "file">): Promise<string>;
  /** Whether the entry is of this type or only mentioned in a margin note. */
  isPrimary(record: LoreRecord): boolean;
  /** The name's weak keys, that is the words that hook onto it when abbreviated. */
  searchKeys(subject: string): string[];
  /** Whether a name shape is worth looking for. */
  isUsefulName(name: string): boolean;
}
