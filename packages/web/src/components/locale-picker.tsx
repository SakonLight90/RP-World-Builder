"use client";

import { LOCALE_NAMES, UI_LOCALES, type UiLocale } from "@rpwb/shared";
import { useEffect, useState } from "react";
import { useI18n } from "../i18n/provider";
import type { World } from "../lib/api";
import { api } from "../lib/api";

/**
 * Narrator language picker.
 *
 * The language is chosen here and not in the system panel because it's not a
 * UI preference: it's the language the narrator **writes the
 * story in**. An Italian app narrating in French is a
 * half-translated app, and the worst spelling mistake shows right
 * there: the model gets accents wrong in a language that isn't its own.
 *
 * No lock during the turn, unlike model and power: the
 * language doesn't change the narrator currently writing, it applies from the next turn.
 * Locking here would be a pointless limitation.
 */
export function LocalePicker({
  worldId,
  world,
  onSaved,
}: {
  worldId: string;
  world: World;
  onSaved: (world: World) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Like in the power picker: if the server has a language that isn't one of
  // the five known ones, the value isn't falsely shown as `it`.
  const current = (UI_LOCALES as readonly string[]).includes(world.activeLocale)
    ? (world.activeLocale as UiLocale)
    : "it";

  // The dependency isn't read in the body: it restarts the effect when the
  // language changes elsewhere (another tab saves, this one re-reads the world).
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above.
  useEffect(() => {
    setProblem(null);
  }, [world.activeLocale]);

  async function choose(locale: string): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      onSaved((await api.updateWorld(worldId, { activeLocale: locale })).world);
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
          disabled={busy}
          aria-label={t("setup.picker.locale.label")}
          onChange={(e) => void choose(e.target.value)}
        >
          {UI_LOCALES.map((locale) => (
            <option key={locale} value={locale}>
              {LOCALE_NAMES[locale]}
            </option>
          ))}
        </select>
      </div>

      <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
        {t("setup.picker.locale.note")}
      </p>

      {problem !== null && (
        <div className="note note-bad" style={{ marginTop: 10 }}>
          {problem}
        </div>
      )}
    </div>
  );
}
