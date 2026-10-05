import type { OpencodeClient } from "@opencode-ai/sdk";
import type { ModelInfo } from "@rpwb/shared";
import { DEFAULT_NARRATOR_MODEL, isAdmissibleByDefault, modelPolicy } from "@rpwb/shared";
import { isRecord } from "./bridge.js";
import { call } from "./client.js";

export interface ModelCatalog {
  all: ModelInfo[];
  /** Usable, free models: zero cost on input and on output. */
  free: ModelInfo[];
  /** Authenticated providers. A model from a provider that is not connected is useless. */
  connectedProviders: string[];
  problem: string | null;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * A model is free only if it costs zero both on input and on output: a model
 * with free input and paid output still makes you spend, and on an RP platform
 * that is the part that dominates the cost.
 *
 * The list is deliberately not hand-written: the free models opencode offers are
 * "limited time" and change, so they have to be detected every time.
 */
export function isFreeModel(costInput: number, costOutput: number): boolean {
  return costInput === 0 && costOutput === 0;
}

export async function readModelCatalog(client: OpencodeClient): Promise<ModelCatalog> {
  const connected = await readConnectedProviders(client);

  let providers: unknown[] = [];
  try {
    const result = await call<unknown>(() => client.config.providers());
    if (isRecord(result) && Array.isArray(result["providers"])) {
      providers = result["providers"];
    }
  } catch (error) {
    return {
      all: [],
      free: [],
      connectedProviders: connected,
      problem: `Cannot read the providers: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const all: ModelInfo[] = [];
  for (const provider of providers) {
    if (!isRecord(provider)) continue;
    const providerId = typeof provider["id"] === "string" ? provider["id"] : null;
    if (providerId === null) continue;
    if (!connected.includes(providerId)) continue;

    const models = provider["models"];
    if (!isRecord(models)) continue;

    for (const [modelId, model] of Object.entries(models)) {
      if (!isRecord(model)) continue;
      const cost = isRecord(model["cost"]) ? model["cost"] : {};
      const limit = isRecord(model["limit"]) ? model["limit"] : {};
      const inputCost = num(cost["input"]);
      const outputCost = num(cost["output"]);
      const name = typeof model["name"] === "string" ? model["name"] : modelId;
      const ref = `${providerId}/${modelId}`;
      const policy = modelPolicy(ref);

      all.push({
        providerId,
        modelId,
        ref,
        name,
        contextLimit: num(limit["context"], 0),
        inputCost,
        outputCost,
        free: isFreeModel(inputCost, outputCost),
        trainsOnPrompts: policy.trainsOnPrompts,
        zeroRetention: policy.zeroRetention,
        privacyNote: policy.note,
        admissibleByDefault: isAdmissibleByDefault(ref),
        reasoning: isRecord(model["capabilities"])
          ? model["capabilities"]["reasoning"] === true
          : false,
      });
    }
  }

  all.sort((a, b) => a.ref.localeCompare(b.ref));

  return {
    all,
    free: all.filter((model) => model.free),
    connectedProviders: connected,
    problem: connected.length === 0 ? "No authenticated provider: run `opencode auth login`" : null,
  };
}

async function readConnectedProviders(client: OpencodeClient): Promise<string[]> {
  try {
    const result = await call<unknown>(() => client.provider.list());
    if (isRecord(result) && Array.isArray(result["connected"])) {
      return result["connected"].filter((id): id is string => typeof id === "string");
    }
  } catch {
    // If the endpoint fails we carry on without a filter: showing one model too
    // many is worse than none, since the wizard verifies anyway.
  }
  return [];
}

/** Free models sorted by decreasing context window: the widest one wins. */
/**
 * Models suited to the narrator, in order of preference.
 *
 * The ordering is not by context window: a wider context does not improve the
 * quality of a story, and above all an endpoint that trains on prompts is not a
 * choice a story platform can make on its own. First the models that retain data
 * are excluded, then the project default is preferred, and only afterwards is the
 * window considered.
 */
export function narratorCandidates(catalog: ModelCatalog): ModelInfo[] {
  const admissible = catalog.free.filter((model) => model.admissibleByDefault);
  const pool = admissible.length > 0 ? admissible : catalog.free;

  return [...pool].sort((a, b) => {
    const aDefault = a.ref === DEFAULT_NARRATOR_MODEL ? 0 : 1;
    const bDefault = b.ref === DEFAULT_NARRATOR_MODEL ? 0 : 1;
    if (aDefault !== bDefault) return aDefault - bDefault;
    return b.contextLimit - a.contextLimit;
  });
}

/** The model to use if the user has not chosen anything. */
export function defaultNarratorModel(catalog: ModelCatalog): string {
  const candidates = narratorCandidates(catalog);
  const preferred = candidates.find((model) => model.ref === DEFAULT_NARRATOR_MODEL);
  return preferred?.ref ?? candidates[0]?.ref ?? DEFAULT_NARRATOR_MODEL;
}

/** Models the player must choose explicitly, with a warning. */
export function restrictedModels(catalog: ModelCatalog): ModelInfo[] {
  return catalog.free.filter((model) => !model.admissibleByDefault);
}
