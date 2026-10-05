"use client";

import { REASONING_EFFORTS, type ReasoningEffort } from "@rpwb/shared";
import { useEffect, useState } from "react";
import type { MessageKey } from "../i18n";
import { useI18n } from "../i18n/provider";
import type { World } from "../lib/api";
import { api } from "../lib/api";

/**
 * What each level means, in one line.
 *
 * They live here and not in a shared constant because they're explanations, not data:
 * the server must know the four values without knowing how they're
 * described to the user. The flip side is that the value list comes from
 * `@rpwb/shared`, because bare values can diverge from what
 * the server accepts, and the picker would offer a choice that saving
 * rejects.
 *
 * Only the keys live here, and each explanation is resolved at render time, because
 * a catalog key cannot be looked up outside a component: the language exists only
 * inside the provider.
 */
const EXPLANATION_KEYS: Record<ReasoningEffort, MessageKey> = {
  default: "setup.picker.reasoning.default",
  low: "setup.picker.reasoning.low",
  medium: "setup.picker.reasoning.medium",
  high: "setup.picker.reasoning.high",
};

/**
 * Reasoning-power picker.
 *
 * Same reason as `ModelPicker`: the world page and the chat settings column both use
 * it, and two copies would hold two lists diverging
 * as soon as someone adds a level.
 *
 * `disabled` means the same as in the model picker: if the
 * narrator is writing, changing settings mid-turn would change the
 * narrator under the running turn.
 */
export function ReasoningPicker({
  worldId,
  world,
  onSaved,
  disabled = false,
}: {
  worldId: string;
  world: World;
  onSaved: (world: World) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // The effective value can come from the server even when it isn't one of the four
  // known ones, e.g. written by a newer version or hand-edited in the database.
  // Showing it as the current choice avoids a `<select>` presenting "default"
  // while the world is worth something else.
  const current: ReasoningEffort = (REASONING_EFFORTS as readonly string[]).includes(
    world.reasoningEffort,
  )
    ? (world.reasoningEffort as ReasoningEffort)
    : (REASONING_EFFORTS[0] ?? "default");

  // The dependency isn't read in the body: it restarts the effect when the
  // power changes elsewhere (another tab saves, this one re-reads the world).
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above.
  useEffect(() => {
    setSaved(false);
  }, [world.reasoningEffort]);

  async function choose(power: string): Promise<void> {
    setBusy(true);
    setProblem(null);
    setSaved(false);
    try {
      onSaved((await api.updateWorld(worldId, { reasoningEffort: power })).world);
      setSaved(true);
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="row" style={{ gap: 6 }}>
        <select
          className="pick pick-green"
          value={current}
          disabled={disabled || busy}
          aria-label={t("setup.picker.reasoning.label")}
          onChange={(e) => void choose(e.target.value)}
        >
          {REASONING_EFFORTS.map((power) => (
            <option key={power} value={power}>
              {power}
            </option>
          ))}
        </select>
        {saved && problem === null && <span className="chip chip-green">{t("setup.saved")}</span>}
      </div>

      <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
        {t(EXPLANATION_KEYS[current])}
      </p>

      {problem !== null && (
        <div className="note note-bad" style={{ marginTop: 10 }}>
          {problem}
        </div>
      )}
    </div>
  );
}
