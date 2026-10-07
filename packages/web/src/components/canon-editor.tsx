"use client";

import { CANON_KINDS, CANON_STATUSES, type CanonEntry } from "@rpwb/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MessageKey } from "../i18n";
import { useI18n } from "../i18n/provider";
import { api, explainError } from "../lib/api";

/**
 * The world's canon, correctable entry by entry.
 *
 * It lives in its own file because its host client is already long and the logic
 * in here is self-contained: list, search, correct, remove, history. With a
 * search showing results without letting you correct them, a wrong
 * fact could only be noticed, never fixed, leaving the campaign with
 * a canon nobody could believe.
 *
 * The **reason** field isn't decoration: without it, six months from now a correction
 * is indistinguishable from a fact that was wrong from the start.
 */

/**
 * How a status reads in the interface: the values in the database are English.
 *
 * Only the catalog keys live here, and the label is resolved at render time,
 * because a catalog key cannot be looked up outside a component.
 */
const STATUS_KEYS: Record<string, MessageKey | undefined> = {
  active: "world.canon.statusActive",
  retconned: "world.canon.statusRetconned",
  disputed: "world.canon.statusDisputed",
  non_canon: "world.canon.statusNonCanon",
};

/**
 * The status as the reader sees it, falling back to the stored value.
 *
 * The fallback is not defensive noise: the database may hold a status this build
 * doesn't know yet, and showing it raw beats showing an empty chip.
 */
function statusLabel(status: string, t: (key: MessageKey) => string): string {
  const key = STATUS_KEYS[status];
  return key === undefined ? status : t(key);
}

export function CanonEditor({ worldId, onChanged }: { worldId: string; onChanged?: () => void }) {
  const { t, locale } = useI18n();
  const [entries, setEntries] = useState<CanonEntry[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      setEntries((await api.canon(worldId)).entries);
      setProblem(null);
    } catch (error) {
      setProblem(explainError(error, locale));
    } finally {
      setLoaded(true);
    }
  }, [locale, worldId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /*
   * Filtering happens on the client, not the server, because a world holds a few hundred
   * entries, not millions: a request per keystroke would be slower
   * and add a way for the list to drift out of sync with the truth.
   */
  const filter = query.trim().toLowerCase();
  const visible =
    filter === ""
      ? entries
      : entries.filter(
          (entry) =>
            entry.subject.toLowerCase().includes(filter) ||
            entry.summary.toLowerCase().includes(filter) ||
            entry.aliases.some((a) => a.toLowerCase().includes(filter)),
        );

  return (
    <div className="stack">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("world.canon.searchPlaceholder")}
        aria-label={t("world.canon.searchLabel")}
      />

      {problem !== null && (
        <div className="note note-bad">
          {problem}
          <div style={{ marginTop: 6 }}>
            <button type="button" className="btn btn-sm" onClick={() => void reload()}>
              {t("world.canon.retry")}
            </button>
          </div>
        </div>
      )}

      {!loaded && <p className="muted">{t("world.canon.loading")}</p>}

      {loaded && visible.length === 0 && (
        <p className="muted">
          {filter === "" ? t("world.canon.empty") : t("world.canon.noResults")}
        </p>
      )}

      {visible.map((entry) => (
        <div className="person" key={entry.id}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>
              {entry.subject}{" "}
              {entry.status !== "active" && (
                <span className="chip chip-gold">{statusLabel(entry.status, t)}</span>
              )}
            </div>
            <div className="muted clamp2">{entry.summary}</div>
          </div>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => setOpenId(openId === entry.id ? null : entry.id)}
            aria-expanded={openId === entry.id}
          >
            {openId === entry.id ? t("world.actions.close") : t("world.canon.correct")}
          </button>
          {openId === entry.id && (
            <EntryEditor
              worldId={worldId}
              entry={entry}
              onSaved={() => {
                setOpenId(null);
                void reload();
                onChanged?.();
              }}
              onProblem={setProblem}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function EntryEditor({
  worldId,
  entry,
  onSaved,
  onProblem,
}: {
  worldId: string;
  entry: CanonEntry;
  onSaved: () => void;
  onProblem: (message: string | null) => void;
}) {
  const { t, locale } = useI18n();
  const [subject, setSubject] = useState(entry.subject);
  const [kind, setKind] = useState(entry.kind);
  const [status, setStatus] = useState(entry.status);
  const [summary, setSummary] = useState(entry.summary);
  const [aliases, setAliases] = useState(entry.aliases.join(", "));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  /*
   * The button stays disabled until something changes. Saving without
   * changes still creates a history row, and a history full of
   * empty corrections makes the one that matters unusable.
   */
  const dirty =
    subject !== entry.subject ||
    kind !== entry.kind ||
    status !== entry.status ||
    summary !== entry.summary ||
    aliases !== entry.aliases.join(", ");

  async function save(): Promise<void> {
    setBusy(true);
    onProblem(null);
    try {
      await api.editCanon(
        worldId,
        entry.id,
        {
          subject: subject.trim(),
          kind,
          status,
          summary,
          // Aliases live in a text field and split on commas: it's
          // how they're written and re-read without building a list
          // piece by piece with the UI.
          aliases: aliases
            .split(",")
            .map((a) => a.trim())
            .filter((a) => a !== ""),
        },
        reason.trim(),
      );
      onSaved();
    } catch (error) {
      onProblem(explainError(error, locale));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    onProblem(null);
    try {
      await api.deleteCanon(worldId, entry.id, reason.trim());
      onSaved();
    } catch (error) {
      onProblem(explainError(error, locale));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ width: "100%", marginTop: 10 }}>
      <div className="field">
        <label htmlFor={`soggetto-${entry.id}`}>{t("world.fields.name")}</label>
        <input
          id={`soggetto-${entry.id}`}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
      </div>

      <div className="row" style={{ gap: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor={`tipo-${entry.id}`}>{t("world.canon.kindLabel")}</label>
          <select
            id={`tipo-${entry.id}`}
            value={kind}
            onChange={(e) => setKind(e.target.value as CanonEntry["kind"])}
          >
            {CANON_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor={`status-${entry.id}`}>{t("world.canon.statusLabel")}</label>
          <select
            id={`status-${entry.id}`}
            value={status}
            onChange={(e) => setStatus(e.target.value as CanonEntry["status"])}
          >
            {CANON_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s, t)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor={`sin-${entry.id}`}>{t("world.canon.summaryLabel")}</label>
        <textarea
          id={`sin-${entry.id}`}
          value={summary}
          rows={4}
          onChange={(e) => setSummary(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor={`alias-${entry.id}`}>{t("world.canon.aliasesLabel")}</label>
        <input
          id={`alias-${entry.id}`}
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
          placeholder={t("world.canon.aliasesPlaceholder")}
        />
      </div>

      <div className="field">
        <label htmlFor={`reason-${entry.id}`}>{t("world.canon.reasonLabel")}</label>
        <input
          id={`reason-${entry.id}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("world.canon.reasonPlaceholder")}
        />
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !dirty}
          onClick={() => void save()}
        >
          {t("world.canon.save")}
        </button>
        <button
          type="button"
          className="btn btn-outline"
          disabled={busy}
          onClick={() => void remove()}
        >
          {t("world.canon.remove")}
        </button>
        <span className="spacer" />
        <button type="button" className="btn btn-ghost" onClick={onSaved}>
          {t("world.actions.cancel")}
        </button>
      </div>

      <p className="muted" style={{ marginBottom: 0 }}>
        {t("world.canon.help")}
      </p>
    </div>
  );
}

/**
 * Correction history, with a way back.
 *
 * The undo is here and not in the entry's own editor for one reason: a correction
 * you regret is usually noticed here, where the whole trail is, and not while
 * editing the entry again. And it has to work on an entry whose editor you cannot
 * reach — an entry that was removed has no editor left to open.
 *
 * It appears only where it can do something. Undo reads the most recent record for
 * that entry and writes back what it held, so an entry that was never corrected has
 * nothing to reverse and the button would be decoration. "Most recent" is the
 * server's decision: the list comes back newest first and the button is offered on
 * the first row that names this entry, which is the one undo would reverse.
 */
export function CanonEditLog({ worldId }: { worldId: string }) {
  const { t, locale } = useI18n();
  const [edits, setEdits] = useState<Awaited<ReturnType<typeof api.canonEdits>>["edits"]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const read = useCallback(() => {
    api
      .canonEdits(worldId)
      .then((d) => setEdits(d.edits))
      .catch(() => setEdits([]));
  }, [worldId]);

  useEffect(read, [read]);

  /**
   * The first record for each entry, which is the one an undo reverses.
   *
   * A map keyed by entry id, not a filter: an entry corrected five times has five
   * rows and only the newest is reversible. Without taking the first per key, every
   * row would offer an undo that restores a version two corrections out of date.
   */
  const undoable = useMemo(() => {
    const seen = new Set<string>();
    const map = new Map<string, (typeof edits)[number]>();
    for (const edit of edits) {
      // A removal records `afterValue: "null"`: there is nothing left on disk to
      // write back into, so it is not offered as reversible.
      if (edit.afterValue === "null" || seen.has(edit.entryId)) continue;
      seen.add(edit.entryId);
      map.set(edit.entryId, edit);
    }
    return map;
  }, [edits]);

  async function undo(entryId: string): Promise<void> {
    setBusyId(entryId);
    setProblem(null);
    try {
      await api.undoCanon(worldId, entryId);
      // Read the trail again rather than guessing what the server wrote: the undo is
      // itself a recorded correction, so the list on screen would be one row short of
      // what happened.
      read();
    } catch (error) {
      setProblem(explainError(error, locale));
    } finally {
      setBusyId(null);
    }
  }

  if (edits.length === 0) return null;

  return (
    <div className="stack" style={{ marginTop: 18 }}>
      <h2>{t("world.canon.logHeading")}</h2>
      {problem !== null && <div className="note note-bad">{problem}</div>}
      {edits.map((e) => (
        <div className="muted" key={e.id} style={{ display: "flex", gap: 10 }}>
          <span style={{ minWidth: 0 }}>
            <b>{e.subject}</b>, {e.fields}
            {e.reason ? `: ${e.reason}` : ""}
          </span>
          {undoable.has(e.entryId) && (
            <>
              <span className="spacer" />
              <button
                type="button"
                className="btn btn-sm btn-outline"
                disabled={busyId !== null}
                onClick={() => void undo(e.entryId)}
              >
                {t("world.canon.undo")}
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
