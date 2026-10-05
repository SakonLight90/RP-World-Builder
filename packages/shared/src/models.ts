/**
 * Model policy.
 *
 * Being free is not enough for a model to suit roleplay: some
 * free endpoints take as counterpart the right to use prompts and
 * responses to train future models. On a story platform that
 * price is not acceptable, and the choice must not be left to a silent
 * heuristic.
 *
 * The free models offered by opencode change over time ("limited time"), so
 * the table cannot be written as a fixed list of candidates: only the
 * **known properties** of models seen so far live here, and the rest is
 * treated as unknown and therefore excluded from automatic choice.
 */

export interface ModelPolicy {
  /** Trains future models on prompts and responses. */
  trainsOnPrompts: boolean;
  /** Data is not retained by the provider. */
  zeroRetention: boolean;
  /** Note shown in the picker, in English. */
  note: string;
}

const UNKNOWN: ModelPolicy = {
  trainsOnPrompts: false,
  zeroRetention: false,
  note: "Data retention policy not declared.",
};

const POLICIES: Record<string, Partial<ModelPolicy>> = {
  "opencode/space-bunny-free": {
    zeroRetention: true,
    note: "Free and with no data retention.",
  },
  "opencode/longcat-2.5-preview-free": {
    zeroRetention: true,
    note: "Free and with no data retention.",
  },
  "opencode/big-pickle": {
    note: "Free for a limited period; the data may be used to improve the model.",
  },
  "opencode/mimo-v2.6-flash-free": {
    note: "Free for a limited period; the data may be used to improve the model.",
  },
  "opencode/mimo-v2.5-free": {
    note: "Free for a limited period; the data may be used to improve the model.",
  },
  "opencode/ling-3.0-flash-fin-free": {
    note: "Free for a limited period; the data may be used to improve the model.",
  },
  "opencode/nemotron-3-ultra-free": {
    note: "NVIDIA trial endpoint: use requires registration, do not use it with personal data.",
  },
  "opencode/nemotron-3.5-lightning-free": {
    note: "NVIDIA trial endpoint: use requires registration, do not use it with personal data.",
  },
  "opencode/muse-spark-1.3-contributor-free": {
    trainsOnPrompts: true,
    note: "Free in exchange for permission to use prompts and responses to train future models.",
  },
};

export function modelPolicy(ref: string): ModelPolicy {
  const declared = POLICIES[ref];
  if (declared === undefined) return { ...UNKNOWN };
  return {
    trainsOnPrompts: declared.trainsOnPrompts ?? false,
    zeroRetention: declared.zeroRetention ?? false,
    note: declared.note ?? UNKNOWN.note,
  };
}

/**
 * A model is not suitable by default if it trains on prompts or if nothing
 * is known about its data retention. On an NVIDIA trial endpoint hope
 * is not enough: the project cannot recommend a model that logs
 * players' stories.
 */
export function isAdmissibleByDefault(ref: string): boolean {
  const policy = modelPolicy(ref);
  return !policy.trainsOnPrompts && policy.zeroRetention;
}

/**
 * The narrator is a long, quality task, and choosing a
 * zero-retention model costs nothing. `space-bunny-free` is the platform default: if
 * it ever went away, the wizard would say so and ask to choose.
 */
export const DEFAULT_NARRATOR_MODEL = "opencode/space-bunny-free";
