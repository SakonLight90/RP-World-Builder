"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useI18n } from "../i18n/provider";
import type { World } from "../lib/api";
import { api } from "../lib/api";

/**
 * Narrator model picker.
 *
 * It lives in its own file because two places use it: the world page and the
 * chat settings column. Two copies would behave differently,
 * and the one aging first would be exactly the one needed
 * while playing.
 *
 * `disabled` is for the running turn: switching models mid-writing
 * would swap the narrator under the turn in progress.
 */
export function ModelPicker({
  worldId,
  world,
  onSaved,
  children,
  disabled = false,
  note,
}: {
  worldId: string;
  world: World;
  onSaved: (world: World) => void;
  /** Elements shown next to the picker, typically context chips. */
  children?: ReactNode;
  /** The narrator is writing: the picker locks until the turn ends. */
  disabled?: boolean;
  /** Sentence shown under the picker. Empty when there is nothing to say. */
  note?: string;
}) {
  const { t } = useI18n();
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // The catalog arrives on its own: if the API doesn't answer the world still
    // opens, and what you can't do is switch models.
    api
      .health()
      .then((h) => setModels(h.narratorModels))
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : String(failure)),
      );
  }, []);

  async function choose(model: string): Promise<void> {
    setBusy(true);
    setProblem(null);
    setSaved(false);
    try {
      onSaved((await api.updateWorld(worldId, { model })).world);
      setSaved(true);
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  // The model in use stays listed even when the server doesn't deem it
  // fit for narrating: dropping it from the menu while in use would show a
  // picker on a value nobody chose.
  const options = models.includes(world.model) ? models : [world.model, ...models];

  return (
    <div style={{ marginTop: 12 }}>
      <div className="row" style={{ gap: 6 }}>
        <select
          className="pick pick-green"
          value={world.model}
          disabled={disabled || busy || models.length === 0}
          aria-label={t("setup.picker.model.label")}
          onChange={(e) => void choose(e.target.value)}
        >
          {options.map((ref) => (
            <option key={ref} value={ref}>
              {ref.replace("opencode/", "")}
            </option>
          ))}
        </select>
        {saved && problem === null && <span className="chip chip-green">{t("setup.saved")}</span>}
      </div>

      {/*
        Nothing is written under the picker any more. There used to be a note
        explaining that the chapter checks keep using a *small* model, with its
        name in it, and that it does not change with this choice. It was a
        paragraph to justify a second model that the player never chose: the
        narrator was one model and the checks were silently another, which is
        the kind of thing a panel should not have to apologise for. One model,
        the one picked here, does the writing and the checks.
      */}
      {note !== undefined && note !== "" && (
        <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
          {children}
          {note}
        </p>
      )}
      {note === undefined && children !== undefined && (
        <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
          {children}
        </p>
      )}

      {problem !== null && (
        <div className="note note-bad" style={{ marginTop: 10 }}>
          {problem}
        </div>
      )}
    </div>
  );
}
