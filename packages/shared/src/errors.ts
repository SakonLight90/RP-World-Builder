/**
 * Every failure the API can report, as a code.
 *
 * The reason this file exists: the interface cannot translate a sentence. If the
 * server sends `problem: "Nonexistent world"` and the reader's language is
 * German, there is nothing to translate *from* — the client would have to
 * pattern-match on the server's English or Italian prose, which breaks the
 * moment somebody rewrites a message to say it better.
 *
 * So an error carries a code, and the code is the contract. `problem` stays in
 * the payload as the English fallback, built from this same table, which means
 * the sentence a script or an old client reads and the sentence the code
 * describes can never drift apart.
 *
 * Naming: `<area>.<whatHappened>`, lowercase, past tense as an assertion
 * ("world.notFound" is what the server found, not a command).
 */

export const ERROR_CATALOG = {
  // A body that did not survive validation. `detail` is the validator's own
  // message: it names the field, and rewriting it here would lose that.
  "body.invalid": "Invalid request: {{detail}}",
  "body.expectedList": "Expected a list",

  "world.notFound": "World not found",
  "world.templateNotFound": "Template not found",
  /** The folder is still held open by something, so nothing was deleted. */
  "world.deleteBlocked":
    "Could not delete the campaign folder, so nothing was deleted: {{path}}. Close whatever is using it, for example an opencode server still running for this campaign, and try again.",

  "canon.entryNotFound": "Canon entry not found",

  "cast.characterNotFound": "Character not found",
  "cast.locationNotFound": "Location not found",
  "cast.relationshipNotFound": "Relationship not found",
  /** Only the route builds characters and locations; a fact has to be written by hand. */
  "cast.kindNotCreatable":
    'This route only creates characters and locations: an entry of kind "{{kind}}" must be written by hand.',
  "cast.characterOtherWorld": "The character {{role}} does not belong to this campaign.",
  "cast.locationSelfParent": "A place cannot be inside itself.",
  "cast.locationParentOtherWorld": "The parent location does not belong to this campaign.",
  "cast.locationParentNested": "The parent location is inside the place being moved.",

  "arc.notFound": "Arc not found",
  "arc.alreadyClosed": "Arc already closed",
  "arc.hasChapters":
    "The arc contains {{count}} chapters: the chapters would be left without an arc.",

  "chapter.notFound": "Chapter not found",
  "chapter.invalidNumber": "Invalid chapter number",

  "turn.notFound": "Turn not found",
  "turn.failed": "The turn failed: {{reason}}",
  "turn.notFinished": "The narrator did not finish the turn.",
  "turn.timeout":
    "The narrator did not answer within {{seconds}} seconds. The request was interrupted: try again, and if it happens again change model.",
  "turn.emptyOutput":
    "The narrator wrote nothing. The model may be unavailable or it may have interrupted the answer: change model and try again.",
  "turn.aborted": "The turn was stopped: {{reason}}",

  "narrator.unavailable": "The narrator is not available: {{reason}}",
  "opencode.unavailable": "opencode is not available",
  "models.unavailable": "The model list could not be read: {{reason}}",

  "conversation.notStarted": "The campaign has not started yet.",
  "conversation.prologueProtected":
    "The world prologue cannot be deleted: it is the first message.",

  "settings.nothingToSave": "Nothing to save",

  "import.unrecognizedFile": "Unrecognized campaign file",
  "import.noWorld": "Campaign without a world",

  /**
   * The start is not one of the world's. The campaign may have been forked from a
   * template that has since changed its starts, so this is not always a mistake by
   * the caller: the selection is stale and the player has to choose again.
   */
  "start.notFound": "This world has no start called {{detail}}",

  /**
   * The start exists but cannot be played.
   *
   * Separate from `start.notFound` because the two need different words in the
   * interface: here the player is being offered something the project does not have
   * an opening for, which is a different thing from a start that does not exist.
   */
  "start.loreOnly": "This start is lore only: it cannot be played",

  /** An error nobody planned for. The message is the only thing there is to show. */
  "server.unexpected": "Something went wrong: {{reason}}",
} as const;

/** Every code the API can send. */
export type ErrorCode = keyof typeof ERROR_CATALOG;

/** Values substituted into a code's fallback sentence. */
export type ErrorParams = Record<string, string | number>;

/** A failure as it travels over HTTP. */
export interface ApiProblem {
  code: ErrorCode;
  /** The English sentence, built from `ERROR_CATALOG`. Never localised here. */
  problem: string;
  params?: ErrorParams;
}

/**
 * Builds the English sentence for a code.
 *
 * Only `{{name}}` is substituted, and only for names present in the caller's
 * params: a missing value is left visible rather than blanked, because a blank
 * sentence reads like a bug in the interface and a visible `{{count}}` reads
 * like the bug it is.
 */
export function errorFallback(code: ErrorCode, params?: ErrorParams): string {
  const template: string = ERROR_CATALOG[code];
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Builds the whole payload.
 *
 * Every route goes through this, so a code and its sentence cannot be sent
 * apart by hand.
 */
export function apiProblem(code: ErrorCode, params?: ErrorParams): ApiProblem {
  return params === undefined
    ? { code, problem: errorFallback(code) }
    : { code, problem: errorFallback(code, params), params };
}
