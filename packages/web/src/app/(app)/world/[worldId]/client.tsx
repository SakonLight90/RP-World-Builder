"use client";

import type { Era } from "@rpwb/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CanonEditLog, CanonEditor } from "../../../../components/canon-editor";
import { ModelPicker } from "../../../../components/model-picker";
import { ReasoningPicker } from "../../../../components/reasoning-picker";
import { useI18n } from "../../../../i18n/provider";
import {
  type Arc,
  api,
  type Character,
  type Location,
  type PlayerCharacter,
  type Relationship,
  type World,
} from "../../../../lib/api";

/**
 * The world notebook: arc, chapters, cast, eras, rules, verification.
 *
 * Same page, but tabbed: they're different things and looking at them all together
 * is the best way to look at none of them.
 */
type Tab = "story" | "people" | "world" | "verify";

/**
 * The four notebooks, in reading order.
 *
 * Only the identifiers live here: the label is translated at render time,
 * because a catalog key cannot be resolved outside a component.
 */
const TABS = [
  ["story", "world.tabs.story"],
  ["people", "world.tabs.people"],
  ["world", "world.tabs.world"],
  ["verify", "world.tabs.verify"],
] as const;

export default function WorldClient({ worldId }: { worldId: string }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("story");
  const [world, setWorld] = useState<World | null>(null);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const [arcs, setArcs] = useState<Awaited<ReturnType<typeof api.arcs>>["arcs"]>([]);
  const [chapters, setChapters] = useState<Awaited<ReturnType<typeof api.chapters>>["chapters"]>(
    [],
  );
  const [people, setPeople] = useState<Awaited<ReturnType<typeof api.characters>>["characters"]>(
    [],
  );
  const [places, setPlaces] = useState<Awaited<ReturnType<typeof api.locations>>["locations"]>([]);
  const [relations, setRelations] = useState<
    Awaited<ReturnType<typeof api.relationships>>["relationships"]
  >([]);
  const [eras, setEras] = useState<Era[]>([]);
  const [bible, setBible] = useState<Record<string, string>>({});
  const [health, setHealth] = useState<{
    total: number;
    disputed: number;
  } | null>(null);
  const [report, setReport] = useState<
    | {
        chapterN: number | null;
        claim: string;
        verdict: string;
        canonRef: string;
        suggestion: string;
      }[]
    | null
  >(null);
  const [busy, setBusy] = useState(false);

  /**
   * Re-read the cast from the server instead of patching the list by hand.
   *
   * The database sorts by name, so a rename or addition also shifts
   * neighboring entries: fixing the order here would invent
   * an ordering different from what the narrator sees.
   */
  const refreshPeople = async (): Promise<void> => {
    setPeople((await api.characters(worldId)).characters);
  };

  /*
   * Same reason as the cast: after an edit the truth is the API response,
   * and lists are re-read instead of patched by hand.
   */
  const refreshStory = async (): Promise<void> => {
    const [a, c] = await Promise.all([api.arcs(worldId), api.chapters(worldId)]);
    setArcs(a.arcs);
    setChapters(c.chapters);
  };

  const refreshPlaces = async (): Promise<void> => {
    const [l, r] = await Promise.all([api.locations(worldId), api.relationships(worldId)]);
    setPlaces(l.locations);
    setRelations(r.relationships);
  };

  useEffect(() => {
    // Load everything together: the page is small and showing half an empty page
    // while the other half arrives is worse than waiting a moment.
    const read = async (): Promise<void> => {
      try {
        const w = await api.world(worldId);
        setWorld(w.world);
        setArcs(w.arcs);
        setEras(w.eras);
        setBible(w.bible);
        setHealth(w.canonHealth);
        const [c, p, l, r] = await Promise.all([
          api.chapters(worldId),
          api.characters(worldId),
          api.locations(worldId),
          api.relationships(worldId),
        ]);
        setChapters(c.chapters);
        setPeople(p.characters);
        setPlaces(l.locations);
        setRelations(r.relationships);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    };
    void read();
  }, [worldId]);

  async function verify(): Promise<void> {
    setBusy(true);
    try {
      setReport((await api.verify(worldId, world?.activeLocale ?? "it")).entries);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  /**
   * Export and download.
   *
   * The file is built **in memory** and downloaded via a temporary link
   * instead of asking the server for a path: the campaign already lives on this
   * machine's disk and the user chooses where to keep the copy. Writing first to
   * the server and then telling it where to put it would add a step that can
   * fail with no useful reason.
   */
  async function exportFile(): Promise<void> {
    setExporting(true);
    setExportNote(null);
    setError(null);
    try {
      const payload = await api.exportCampaign(worldId);
      const text = JSON.stringify(payload, null, 2);
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(world?.name ?? t("world.backup.fileName")).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "")}.rpwb.json`;
      link.click();
      // Revoke immediately: leaving the object URL alive pins the file in memory
      // while the tab stays open, and nobody needs it after download.
      URL.revokeObjectURL(url);
      setExportNote(t("world.backup.ready", { size: (new Blob([text]).size / 1024).toFixed(0) }));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  }

  async function importFromFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const text = await file.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        setError(t("world.backup.invalidJson"));
        return;
      }
      const created = await api.importCampaign(payload);
      router.push(`/play/${created.world.id}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  }

  const initial = (world?.name ?? "").slice(0, 2).toUpperCase();

  if (world === null) {
    return (
      <div className="wrap">
        <div className="pad center">{error ?? t("world.page.loading")}</div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="page-head row" style={{ paddingTop: 22 }}>
        <span className="avatar avatar-lg">{initial || "◈"}</span>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 22 }}>{world.name}</h1>
          <p style={{ margin: 0 }}>{world.description || "—"}</p>
        </div>
      </div>
      <PlayerPanel worldId={worldId} player={world.player} onSaved={setWorld} />
      {/*
       * Power used to be a chip showing the value with no way to change it: the only
       * place to change it was chat, and on this page it looked already set. Same
       * component as chat, so the level list can't diverge between the two.
       */}
      <ModelPicker worldId={worldId} world={world} onSaved={setWorld}>
        <span className="chip">{world.activeLocale}</span>
        {health !== null && (
          <span className={`chip ${health.disputed > 0 ? "chip-gold" : "chip-green"}`}>
            {t("world.canon.count", { count: health.total })}
          </span>
        )}
      </ModelPicker>
      <ReasoningPicker worldId={worldId} world={world} onSaved={setWorld} />
      <div className="row" style={{ marginTop: 16, gap: 6 }}>
        <Link href={`/play/${world.id}`} className="btn btn-primary btn-sm">
          {t("world.actions.resume")}
        </Link>
      </div>
      <div className="row" style={{ marginTop: 22, gap: 4 }}>
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`btn btn-sm ${tab === key ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setTab(key)}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <section className="section">
        {tab === "story" && (
          <>
            <div className="section-head">
              <h2>{t("world.arcs.heading")}</h2>
              <span className="muted">{t("world.arcs.summary", { count: chapters.length })}</span>
            </div>

            {arcs.length === 0 ? (
              <div className="panel">
                <p className="muted" style={{ marginTop: 0 }}>
                  {t("world.arcs.empty")}
                </p>
              </div>
            ) : (
              <div className="timeline">
                {arcs.map((arc) => (
                  <ArcRow
                    key={arc.id}
                    worldId={worldId}
                    arc={arc}
                    onChanged={refreshStory}
                    onProblem={setError}
                  />
                ))}
              </div>
            )}

            <ArcCreator
              worldId={worldId}
              nextChapter={chapters.length === 0 ? 1 : Math.max(...chapters.map((c) => c.n)) + 1}
              onCreated={refreshStory}
              onProblem={setError}
            />

            <div className="section-head" style={{ marginTop: 22 }}>
              <h2>{t("world.chapters.heading")}</h2>
            </div>
            {chapters.length === 0 ? (
              <p className="muted">{t("world.chapters.empty")}</p>
            ) : (
              <div className="panel" style={{ padding: 0 }}>
                <table className="t">
                  <tbody>
                    {chapters.map((chapter) => (
                      <ChapterRow
                        key={chapter.id}
                        worldId={worldId}
                        chapter={chapter}
                        onChanged={refreshStory}
                        onProblem={setError}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {tab === "people" && (
          <>
            <CastPanel worldId={worldId} people={people} onRefresh={refreshPeople} />

            <div className="section-head" style={{ marginTop: 22 }}>
              <h2>{t("world.places.heading")}</h2>
              <span className="muted">{places.length}</span>
            </div>
            <PlaceManager
              worldId={worldId}
              places={places}
              onChanged={refreshPlaces}
              onProblem={setError}
            />

            <div className="section-head" style={{ marginTop: 22 }}>
              <h2>{t("world.relations.heading")}</h2>
              <span className="muted">{relations.length}</span>
            </div>
            <RelationManager
              worldId={worldId}
              people={people}
              relations={relations}
              onChanged={refreshPlaces}
              onProblem={setError}
            />
          </>
        )}

        {tab === "world" && (
          <>
            <WorldSettingsPanel worldId={worldId} world={world} onSaved={setWorld} />

            <div className="section-head" style={{ marginTop: 22 }}>
              <h2>{t("world.eras.heading")}</h2>
            </div>
            <EraManager
              worldId={worldId}
              eras={eras}
              onChanged={async () => setEras((await api.world(worldId)).eras)}
              onProblem={setError}
            />

            <div className="section-head" style={{ marginTop: 22 }}>
              <h2>{t("world.bible.heading")}</h2>
            </div>
            <BiblePanel
              worldId={worldId}
              bible={bible}
              onChanged={async (next) => setBible(next)}
              onProblem={setError}
            />

            <div className="section-head" style={{ marginTop: 22 }}>
              <h2>{t("world.canon.heading")}</h2>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              {t("world.canon.intro")}
            </p>
            <CanonEditor worldId={worldId} onChanged={refreshPeople} />
            <CanonEditLog worldId={worldId} />

            <div className="section-head" style={{ marginTop: 22 }}>
              <h2>{t("world.backup.heading")}</h2>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              {t("world.backup.intro")}
            </p>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-primary" onClick={() => void exportFile()}>
                {exporting ? t("world.backup.preparing") : t("world.backup.download")}
              </button>
              <label className="btn btn-outline" style={{ cursor: "pointer" }}>
                {importing ? t("world.backup.importing") : t("world.backup.import")}
                <input
                  type="file"
                  accept="application/json,.json"
                  style={{ display: "none" }}
                  onChange={(e) => void importFromFile(e.target.files?.[0])}
                />
              </label>
              <span className="spacer" />
              {exportNote && <span className="chip chip-green">{exportNote}</span>}
            </div>
          </>
        )}

        {tab === "verify" && (
          <>
            <div className="section-head">
              <h2>{t("world.verify.heading")}</h2>
            </div>
            <div className="panel">
              <p className="muted" style={{ marginTop: 0 }}>
                {t("world.verify.intro")}
              </p>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={verify}
                disabled={busy}
              >
                {busy ? t("world.verify.running") : t("world.verify.run")}
              </button>
              {error !== null && (
                <div className="note note-bad" style={{ marginTop: 10 }}>
                  {error}
                </div>
              )}
            </div>

            {report !== null && report.length === 0 && (
              <div className="note note-good" style={{ marginTop: 12 }}>
                {t("world.verify.clean")}
              </div>
            )}

            {report !== null && report.length > 0 && (
              <div className="panel" style={{ marginTop: 12, padding: 0 }}>
                <table className="t">
                  <thead>
                    <tr>
                      <th>{t("world.verify.colChapter")}</th>
                      <th>{t("world.verify.colClaim")}</th>
                      <th>{t("world.verify.colVerdict")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.map((row) => (
                      <tr key={`${row.chapterN ?? "x"}-${row.claim}`}>
                        <td>
                          <span className="chip">{row.chapterN ?? "—"}</span>
                        </td>
                        <td>
                          {row.claim}
                          <div className="muted">{row.canonRef || "—"}</div>
                        </td>
                        <td>
                          <span
                            className={`chip ${row.verdict === "canon" ? "chip-green" : "chip-red"}`}
                          >
                            {row.verdict}
                          </span>
                          {row.suggestion !== "" && <div className="muted">{row.suggestion}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/**
 * Who you are.
 *
 * Not the character on stage right now: the one holding the turns. It sits on top,
 * not inside a tab, because it's the info the narrator always needs and which,
 * parked on another page, ends up retyped by hand into the prompt
 * game after game.
 */
function PlayerPanel({
  worldId,
  player,
  onSaved,
}: {
  worldId: string;
  player: PlayerCharacter | undefined;
  onSaved: (world: World) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(player?.name ?? "");
  const [role, setRole] = useState(player?.role ?? "");
  const [description, setDescription] = useState(player?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Fields follow the character the server has, not what was
  // typed: after a save the truth is the API response, and without
  // this alignment the boxes would stay ahead of it.
  useEffect(() => {
    setName(player?.name ?? "");
    setRole(player?.role ?? "");
    setDescription(player?.description ?? "");
  }, [player?.name, player?.role, player?.description]);

  async function send(body: PlayerCharacter): Promise<void> {
    setBusy(true);
    setProblem(null);
    setSaved(false);
    try {
      onSaved((await api.updateWorld(worldId, { player: body })).world);
      setSaved(true);
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  const empty = { name: "", role: "", description: "" };
  const exists = (player?.name ?? "") !== "";

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="section-head" style={{ marginBottom: 10 }}>
        <h2>{t("world.player.heading")}</h2>
        <span className="muted">{exists ? player?.name : t("world.player.none")}</span>
      </div>

      <div className="grid">
        <div className="field">
          <label htmlFor="player-name">{t("world.fields.name")}</label>
          <input
            id="player-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("world.player.namePlaceholder")}
          />
        </div>
        <div className="field">
          <label htmlFor="player-role">{t("world.fields.role")}</label>
          <input
            id="player-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder={t("world.player.rolePlaceholder")}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="player-description">{t("world.fields.description")}</label>
        <textarea
          id="player-description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("world.player.descriptionPlaceholder")}
        />
      </div>

      <p className="muted" style={{ marginTop: 0 }}>
        {t("world.player.note")}
      </p>

      <div className="row" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || name.trim() === ""}
          onClick={() => void send({ name: name.trim(), role, description })}
        >
          {busy ? t("world.actions.saving") : t("world.actions.save")}
        </button>
        {exists && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => void send(empty)}
          >
            {t("world.player.remove")}
          </button>
        )}
      </div>

      {problem !== null && (
        <div className="note note-bad" style={{ marginTop: 12 }}>
          {problem}
        </div>
      )}
      {saved && problem === null && (
        <div className="note note-good" style={{ marginTop: 12 }}>
          {t("world.player.saved")}
        </div>
      )}
    </div>
  );
}

/**
 * The model that writes.
 *
 * It sits where the read-only label used to be: a picker changing a
 * world property is one value among others, not a screen.
 */

/**
 * The manageable canonical cast.
 *
 * Adding, correcting and removing stay on the person's own row:
 * opening another page for one wrong line makes you forget the line
 * exists, and the narrator keeps citing it.
 */
function CastPanel({
  worldId,
  people,
  onRefresh,
}: {
  worldId: string;
  people: Character[];
  onRefresh: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function add(): Promise<void> {
    setBusy(true);
    setProblem(null);
    setSaved(false);
    try {
      await api.addCharacter(worldId, { name: name.trim(), role, description });
      await onRefresh();
      setName("");
      setRole("");
      setDescription("");
      setSaved(true);
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="section-head">
        <h2>{t("world.cast.heading")}</h2>
        <span className="muted">{people.length}</span>
      </div>

      {people.length === 0 ? (
        <div className="panel">
          <p className="muted" style={{ marginTop: 0 }}>
            {t("world.cast.empty")}
          </p>
        </div>
      ) : (
        <div className="stack">
          {people.map((person) => (
            <PersonRow
              key={person.id}
              worldId={worldId}
              person={person}
              open={open === person.id}
              onToggle={() => setOpen(open === person.id ? null : person.id)}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}

      <details className="acc" style={{ marginTop: 12 }}>
        <summary>{t("world.cast.addSummary")}</summary>
        <div>
          <div className="field">
            <label htmlFor="new-name">{t("world.fields.name")}</label>
            <input
              id="new-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("world.cast.namePlaceholder")}
            />
          </div>
          <div className="field">
            <label htmlFor="new-role">{t("world.fields.role")}</label>
            <input
              id="new-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder={t("world.cast.rolePlaceholder")}
            />
          </div>
          <div className="field">
            <label htmlFor="new-description">{t("world.fields.description")}</label>
            <textarea
              id="new-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("world.cast.descriptionPlaceholder")}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || name.trim() === ""}
            onClick={() => void add()}
          >
            {busy ? t("world.actions.adding") : t("world.actions.add")}
          </button>
          {problem !== null && (
            <div className="note note-bad" style={{ marginTop: 12 }}>
              {problem}
            </div>
          )}
          {saved && problem === null && (
            <div className="note note-good" style={{ marginTop: 12 }}>
              {t("world.cast.added")}
            </div>
          )}
        </div>
      </details>
    </>
  );
}

/**
 * Settings that are neither model nor language.
 *
 * Name, description, small model and the two thresholds change here and don't
 * stay written only at creation: a long campaign changes needs, and
 * forcing a recreate to raise a threshold would be the priciest way
 * to lack a panel.
 */
function WorldSettingsPanel({
  worldId,
  world,
  onSaved,
}: {
  worldId: string;
  world: World;
  onSaved: (world: World) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(world.name);
  const [description, setDescription] = useState(world.description);
  const [contextLimit, setContextLimit] = useState<number | null>(world.contextLimit);
  /**
   * The window the model in use actually accepts, when the catalog says so.
   *
   * It is here to contradict the player, not to help them. A number above this
   * one cannot be reached, and the campaign would go on closing its chapters
   * against a limit the provider refuses, which from the inside looks like the
   * narrator forgetting what it was told. Zero means the provider declared
   * nothing, and then there is nothing to check against.
   */
  const [modelWindow, setModelWindow] = useState<number | null>(null);
  const [contextLimitSaved, setContextLimitSaved] = useState(false);
  const [chapterThresholdRatio, setChapterThresholdRatio] = useState(world.chapterThresholdRatio);
  const [canonBudgetRatio, setCanonBudgetRatio] = useState(world.canonBudgetRatio);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setName(world.name);
    setDescription(world.description);
    setContextLimit(world.contextLimit);
    setChapterThresholdRatio(world.chapterThresholdRatio);
    setCanonBudgetRatio(world.canonBudgetRatio);
  }, [
    world.name,
    world.description,
    world.contextLimit,
    world.chapterThresholdRatio,
    world.canonBudgetRatio,
  ]);

  // Re-read on every model change: the window belongs to the model, so the same
  // number can be right for one and impossible for the next.
  useEffect(() => {
    let live = true;
    void api
      .models()
      .then((catalog) => {
        if (!live) return;
        const found = catalog.narrator.find((m) => m.ref === world.model);
        setModelWindow(found !== undefined && found.contextLimit > 0 ? found.contextLimit : null);
      })
      .catch(() => {
        if (live) setModelWindow(null);
      });
    return () => {
      live = false;
    };
  }, [world.model]);

  /**
   * Saves only the context window, on its own button.
   *
   * It does not ride on the panel's save because that one commits name,
   * description and both sliders at once: a number typed here would be committed
   * by a press meant for something else. This is the one setting where a stray
   * digit decides where a chapter ends, so it gets its own confirmation and
   * nothing else.
   */
  async function saveContextLimit(): Promise<void> {
    setBusy(true);
    setProblem(null);
    setContextLimitSaved(false);
    try {
      const savedWorld = (await api.updateWorld(worldId, { contextLimit })).world;
      onSaved(savedWorld);
      setContextLimitSaved(true);
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    setBusy(true);
    setProblem(null);
    setSaved(false);
    try {
      onSaved(
        (
          await api.updateWorld(worldId, {
            name: name.trim() === "" ? world.name : name.trim(),
            description,
            contextLimit,
            chapterThresholdRatio,
            canonBudgetRatio,
          })
        ).world,
      );
      setSaved(true);
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="grid">
        <div className="field">
          <label htmlFor="world-name">{t("world.settings.nameLabel")}</label>
          <input id="world-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="world-description">{t("world.fields.description")}</label>
        <textarea
          id="world-description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="world-context-limit">{t("world.settings.contextLimit")}</label>
        <div className="row" style={{ gap: 8 }}>
          <input
            id="world-context-limit"
            type="number"
            min={1000}
            max={10000000}
            step={1000}
            placeholder={t("world.settings.contextLimitAuto")}
            value={contextLimit === null ? "" : Math.round(contextLimit / 1000)}
            onChange={(e) => {
              const raw = e.target.value.trim();
              // Empty means "ask the provider": that is the default and the reason
              // this field exists, not a window of zero.
              if (raw === "") return setContextLimit(null);
              const thousands = Number(raw);
              if (!Number.isFinite(thousands) || thousands < 1) return;
              setContextLimit(Math.round(thousands * 1000));
            }}
          />
          {/*
           * Its own save button, rather than riding on the panel's one.
           *
           * The panel saves name, description and the two sliders together, and
           * it saves the moment you press it. This number is different: it
           * decides when a chapter closes, and mistyping it by a digit or
           * dropping a zero is a change nobody notices until a chapter ends in
           * the wrong place. Typing here must not commit anything, and the
           * button says so by being disabled until the number actually differs
           * from what is stored.
           */}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || contextLimit === world.contextLimit}
            onClick={() => void saveContextLimit()}
          >
            {busy ? t("world.actions.saving") : t("world.actions.save")}
          </button>
        </div>
        {contextLimitSaved && !busy && problem === null ? (
          <span className="chip chip-green">{t("world.actions.saved")}</span>
        ) : null}
        {/*
         * The number is not taken on trust when it is above what the model can
         * actually hold. It is not an error to type it: a plan may be upgraded,
         * and the number may already be right for the model chosen next. But the
         * campaign would go on dividing by a window the provider refuses, so it
         * is said out loud, with both numbers, every time the mismatch is there.
         */}
        {contextLimit !== null && modelWindow !== null && contextLimit > modelWindow ? (
          <div className="note note-bad" style={{ marginTop: 8 }}>
            {t("world.settings.contextLimitTooHigh", {
              entered: Math.round(contextLimit / 1000),
              window: Math.round(modelWindow / 1000),
            })}
          </div>
        ) : null}
        <p className="muted" style={{ marginTop: 4, marginBottom: 0 }}>
          {t("world.settings.contextLimitNote")}
        </p>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="world-chapter-threshold">
            {t("world.settings.chapterThreshold", {
              percent: Math.round(chapterThresholdRatio * 100),
            })}
          </label>
          <input
            id="world-chapter-threshold"
            type="range"
            min={10}
            max={95}
            value={Math.round(chapterThresholdRatio * 100)}
            onChange={(e) => setChapterThresholdRatio(Number(e.target.value) / 100)}
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="world-canon-budget">
            {t("world.settings.canonBudget", { percent: Math.round(canonBudgetRatio * 100) })}
          </label>
          <input
            id="world-canon-budget"
            type="range"
            min={5}
            max={60}
            value={Math.round(canonBudgetRatio * 100)}
            onChange={(e) => setCanonBudgetRatio(Number(e.target.value) / 100)}
          />
        </div>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 4 }}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? t("world.actions.saving") : t("world.settings.save")}
        </button>
        {saved && problem === null && (
          <span className="chip chip-green">{t("world.actions.saved")}</span>
        )}
      </div>
      {problem !== null && (
        <div className="note note-bad" style={{ marginTop: 12 }}>
          {problem}
        </div>
      )}
    </div>
  );
}

/**
 * One person, and their card when a correction is needed.
 *
 * Boxes open and close: the list stays readable when nothing is being
 * edited, which is almost always.
 */
function PersonRow({
  worldId,
  person,
  open,
  onToggle,
  onRefresh,
}: {
  worldId: string;
  person: Character;
  open: boolean;
  onToggle: () => void;
  onRefresh: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(person.name);
  const [role, setRole] = useState(person.role);
  const [description, setDescription] = useState(person.description);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // A freshly updated or renamed row must show the new name
  // even after the card closes: otherwise the list lies about the first
  // name you read.
  useEffect(() => {
    setName(person.name);
    setRole(person.role);
    setDescription(person.description);
  }, [person.name, person.role, person.description]);

  async function save(): Promise<void> {
    setBusy(true);
    setProblem(null);
    setSaved(false);
    try {
      await api.updateCharacter(worldId, person.id, {
        name: name.trim(),
        role,
        description,
      });
      await onRefresh();
      setConfirming(false);
      setSaved(true);
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    // Deletion asks twice with no system dialog: the only
    // way an error never needs manual undo afterwards.
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await api.deleteCharacter(worldId, person.id);
      await onRefresh();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : String(failure));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="person" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
      <span className="avatar g2">{person.name.slice(0, 2).toUpperCase()}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{person.name}</div>
        <div className="muted">
          {[person.role, person.status].filter((x) => x !== "").join(" · ") || "—"}
        </div>
        {person.description !== "" && <div className="muted clamp2">{person.description}</div>}
      </div>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => {
          setConfirming(false);
          onToggle();
        }}
      >
        {open ? t("world.actions.close") : t("world.actions.edit")}
      </button>

      {open && (
        <div style={{ flexBasis: "100%" }}>
          <div className="field" style={{ marginTop: 10, marginBottom: 10 }}>
            <label htmlFor={`name-${person.id}`}>{t("world.fields.name")}</label>
            <input
              id={`name-${person.id}`}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(false);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`role-${person.id}`}>{t("world.fields.role")}</label>
            <input
              id={`role-${person.id}`}
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                setSaved(false);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`description-${person.id}`}>{t("world.fields.description")}</label>
            <textarea
              id={`description-${person.id}`}
              rows={3}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setSaved(false);
              }}
            />
          </div>

          <div className="row">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy || name.trim() === ""}
              onClick={() => void save()}
            >
              {busy ? t("world.actions.saving") : t("world.actions.save")}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${confirming ? "btn-gold" : ""}`}
              disabled={busy}
              onClick={() => void remove()}
            >
              {confirming ? t("world.confirm.deleteCharacter") : t("world.actions.delete")}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => {
                setName(person.name);
                setRole(person.role);
                setDescription(person.description);
                setProblem(null);
                setSaved(false);
                setConfirming(false);
                onToggle();
              }}
            >
              {t("world.actions.cancel")}
            </button>
            {saved && problem === null && (
              <span className="chip chip-green">{t("world.actions.saved")}</span>
            )}
          </div>

          {problem !== null && (
            <div className="note note-bad" style={{ marginTop: 12 }}>
              {problem}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One arc, with what you can do to it.
 *
 * Closing asks for the backbone because that's the point: without
 * a summary the compressed chapters would vanish without a trace. Deleting
 * an arc with chapters asks for double confirmation because chapters stay in the
 * world without an arc, and that must be known before pressing.
 */
function ArcRow({
  worldId,
  arc,
  onChanged,
  onProblem,
}: {
  worldId: string;
  arc: Arc;
  onChanged: () => Promise<void>;
  onProblem: (message: string | null) => void;
}) {
  const { t } = useI18n();
  const [closing, setClosing] = useState(false);
  const [spine, setSpine] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const chapterCount = arc.chapters?.length ?? 0;

  async function close(): Promise<void> {
    if (spine.trim() === "") return;
    setBusy(true);
    try {
      await api.closeArc(worldId, arc.id, { spine: spine.trim() });
      setClosing(false);
      setSpine("");
      onProblem(null);
      await onChanged();
    } catch (failure) {
      onProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function remove(force: boolean): Promise<void> {
    setBusy(true);
    try {
      await api.deleteArc(worldId, arc.id, force);
      setDeleting(false);
      onProblem(null);
      await onChanged();
    } catch (failure) {
      onProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`tl-item ${arc.status === "closed" ? "is-closed" : ""}`}>
      <div className="tl-n">
        {t("world.arcs.badge", {
          n: arc.n,
          status:
            arc.status === "closed" ? t("world.arcs.statusClosed") : t("world.arcs.statusOpen"),
        })}
      </div>
      <h3>{arc.title}</h3>
      <p className="muted" style={{ marginTop: 4 }}>
        {arc.logline}
      </p>
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        <span className="chip">
          {t("world.arcs.chaptersRange", { first: arc.firstChapter, last: arc.lastChapter })}
        </span>
        {arc.remaining !== undefined && arc.remaining > 0 && (
          <span className="chip chip-gold">
            {t("world.arcs.closesIn", { count: arc.remaining })}
          </span>
        )}
      </div>
      {arc.spine !== "" && (
        <details className="acc" style={{ marginTop: 8 }}>
          <summary>{t("world.arcs.spineSummary", { count: arc.spine.length })}</summary>
          <div>{arc.spine}</div>
        </details>
      )}

      {arc.status === "open" && !closing && !deleting && (
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <button type="button" className="btn btn-sm" onClick={() => setClosing(true)}>
            {t("world.actions.close")}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDeleting(true)}>
            {t("world.actions.remove")}
          </button>
        </div>
      )}
      {arc.status === "closed" && !deleting && (
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDeleting(true)}>
            {t("world.actions.remove")}
          </button>
        </div>
      )}

      {closing && (
        <div style={{ marginTop: 8 }}>
          <div className="field">
            <label htmlFor={`spina-${arc.id}`}>{t("world.arcs.spineLabel")}</label>
            <textarea
              id={`spina-${arc.id}`}
              rows={3}
              value={spine}
              onChange={(e) => setSpine(e.target.value)}
              placeholder={t("world.arcs.spinePlaceholder")}
            />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy || spine.trim() === ""}
              onClick={() => void close()}
            >
              {busy ? t("world.arcs.closing") : t("world.arcs.close")}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setClosing(false)}
            >
              {t("world.actions.cancel")}
            </button>
          </div>
        </div>
      )}

      {deleting && (
        <div style={{ marginTop: 8 }}>
          <p className="muted" style={{ margin: "0 0 8px" }}>
            {chapterCount === 0
              ? t("world.confirm.arcEmpty")
              : t("world.confirm.arcHasChapters", { count: chapterCount })}
          </p>
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn-sm btn-gold"
              disabled={busy}
              onClick={() => void remove(chapterCount > 0)}
            >
              {busy
                ? t("world.actions.removing")
                : chapterCount > 0
                  ? t("world.confirm.arcDeleteAnyway")
                  : t("world.confirm.arcDelete")}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setDeleting(false)}
            >
              {t("world.actions.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Open a new arc, from the right chapter. */
function ArcCreator({
  worldId,
  nextChapter,
  onCreated,
  onProblem,
}: {
  worldId: string;
  nextChapter: number;
  onCreated: () => Promise<void>;
  onProblem: (message: string | null) => void;
}) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [logline, setLogline] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(): Promise<void> {
    if (title.trim() === "") return;
    setBusy(true);
    try {
      await api.createArc(worldId, {
        title: title.trim(),
        logline: logline.trim(),
        firstChapter: nextChapter,
      });
      setTitle("");
      setLogline("");
      setIsOpen(false);
      onProblem(null);
      await onCreated();
    } catch (failure) {
      onProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  if (!isOpen) {
    return (
      <div style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-sm btn-outline" onClick={() => setIsOpen(true)}>
          {t("world.arcs.open")}
        </button>
      </div>
    );
  }

  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <div className="field">
        <label htmlFor="arco-titolo">{t("world.fields.title")}</label>
        <input
          id="arco-titolo"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("world.arcs.titlePlaceholder")}
        />
      </div>
      <div className="field">
        <label htmlFor="arco-logline">{t("world.arcs.loglineLabel")}</label>
        <input
          id="arco-logline"
          value={logline}
          onChange={(e) => setLogline(e.target.value)}
          placeholder={t("world.arcs.loglinePlaceholder")}
        />
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        {t("world.arcs.startsAt", { n: nextChapter })}
      </p>
      <div className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || title.trim() === ""}
          onClick={() => void create()}
        >
          {busy ? t("world.arcs.opening") : t("world.arcs.openSubmit")}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIsOpen(false)}>
          {t("world.actions.cancel")}
        </button>
      </div>
    </div>
  );
}

/**
 * One chapter, with text and deletion.
 *
 * Text loads on demand, not with the list: a chapter is long and
 * loading them all together on page open would cost every visit
 * what is needed only once.
 */
function ChapterRow({
  worldId,
  chapter,
  onChanged,
  onProblem,
}: {
  worldId: string;
  chapter: { id: string; n: number; title: string; summary: string };
  onChanged: () => Promise<void>;
  onProblem: (message: string | null) => void;
}) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  async function open(): Promise<void> {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    setBusy(true);
    try {
      const fetched = await api.chapter(worldId, chapter.n);
      setText(fetched.text);
      setIsOpen(true);
      onProblem(null);
    } catch (failure) {
      onProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    try {
      await api.deleteChapter(worldId, chapter.n);
      setDeleting(false);
      onProblem(null);
      await onChanged();
    } catch (failure) {
      onProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <tr>
        <td style={{ width: 46 }}>
          <span className="chip">{chapter.n}</span>
        </td>
        <td>{chapter.title}</td>
        <td className="muted">{chapter.summary}</td>
        <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={busy}
            onClick={() => void open()}
          >
            {isOpen ? t("world.actions.close") : t("world.chapters.read")}
          </button>{" "}
          {!deleting ? (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={busy}
              onClick={() => setDeleting(true)}
            >
              {t("world.actions.remove")}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-sm btn-gold"
              disabled={busy}
              onClick={() => void remove()}
            >
              {busy ? t("world.actions.removing") : t("world.confirm.deleteChapter")}
            </button>
          )}
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={4}>
            {text === null ? (
              <p className="muted" style={{ margin: 0 }}>
                {t("world.chapters.missingText")}
              </p>
            ) : (
              <pre className="muted" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                {text}
              </pre>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * World rules, correctable section by section.
 *
 * The Bible enters every turn's context, so a wrong rule here
 * repeats on every answer until someone corrects it. Before it could only
 * be read: a typo in the rules was permanent.
 */
function BiblePanel({
  worldId,
  bible,
  onChanged,
  onProblem,
}: {
  worldId: string;
  bible: Record<string, string>;
  onChanged: (next: Record<string, string>) => void;
  onProblem: (message: string | null) => void;
}) {
  const { t } = useI18n();
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  // Text follows the open section, not what was typed before: after a
  // save the truth is the API response.
  useEffect(() => {
    setText(openSection === null ? "" : (bible[openSection] ?? ""));
  }, [openSection, bible]);

  async function save(section: string): Promise<void> {
    setBusy(true);
    try {
      const response = await api.bible(worldId, section, text);
      onChanged(response.bible);
      setOpenSection(null);
      onProblem(null);
    } catch (failure) {
      onProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {Object.entries(bible).map(([section, body]) => (
        <details
          className="acc"
          key={section}
          open={openSection === section}
          onToggle={(e) => setOpenSection(e.currentTarget.open ? section : null)}
        >
          <summary>{section}</summary>
          {openSection === section ? (
            <div>
              <div className="field">
                <label htmlFor={`bible-${section}`}>{t("world.bible.ruleLabel")}</label>
                <textarea
                  id={`bible-${section}`}
                  rows={6}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={() => void save(section)}
                >
                  {busy ? t("world.actions.saving") : t("world.bible.save")}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setOpenSection(null)}
                >
                  {t("world.actions.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <div>{body}</div>
          )}
        </details>
      ))}
    </>
  );
}

/**
 * Eras, with add, edit and remove.
 *
 * The sent list **replaces** the existing one: dropping an era just
 * omits it. Same contract as the route, and the button says so, because
 * a silent removal inside a "save" would surprise.
 */
function EraManager({
  worldId,
  eras,
  onChanged,
  onProblem,
}: {
  worldId: string;
  eras: Era[];
  onChanged: () => Promise<void>;
  onProblem: (message: string | null) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Era[]>([]);
  const [modified, setModified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");

  // The draft follows the world until touched: after a save the
  // truth is the API response, and without this the form would stay ahead.
  useEffect(() => {
    if (!modified) setDraft(eras);
  }, [eras, modified]);

  function markModified(next: Era[]): void {
    setDraft(next);
    setModified(true);
  }

  async function save(): Promise<void> {
    setBusy(true);
    try {
      await api.updateEras(worldId, draft);
      setModified(false);
      onProblem(null);
      await onChanged();
    } catch (failure) {
      onProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {draft.map((era, index) => (
        <div className="panel" key={era.key}>
          <div className="field">
            <label htmlFor={`era-label-${era.key}`}>{t("world.fields.label")}</label>
            <input
              id={`era-label-${era.key}`}
              value={era.label}
              onChange={(e) =>
                markModified(
                  draft.map((r, i) => (i === index ? { ...r, label: e.target.value } : r)),
                )
              }
            />
          </div>
          <div className="field">
            <label htmlFor={`era-summary-${era.key}`}>{t("world.fields.summary")}</label>
            <textarea
              id={`era-summary-${era.key}`}
              rows={2}
              value={era.summary}
              onChange={(e) =>
                markModified(
                  draft.map((r, i) => (i === index ? { ...r, summary: e.target.value } : r)),
                )
              }
            />
          </div>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => markModified(draft.filter((_, i) => i !== index))}
          >
            {t("world.eras.remove")}
          </button>
        </div>
      ))}

      <div className="panel" style={{ marginTop: 12 }}>
        <div className="field">
          <label htmlFor="era-key">{t("world.eras.keyLabel")}</label>
          <input
            id="era-key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t("world.eras.keyPlaceholder")}
          />
        </div>
        <div className="field">
          <label htmlFor="era-label-nuova">{t("world.fields.label")}</label>
          <input
            id="era-label-nuova"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("world.eras.labelPlaceholder")}
          />
        </div>
        <button
          type="button"
          className="btn btn-sm btn-outline"
          disabled={key.trim() === "" || label.trim() === ""}
          onClick={() => {
            markModified([...draft, { key: key.trim(), label: label.trim(), summary: "" }]);
            setKey("");
            setLabel("");
          }}
        >
          {t("world.eras.add")}
        </button>
      </div>

      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || !modified}
          onClick={() => void save()}
        >
          {busy ? t("world.actions.saving") : t("world.eras.save")}
        </button>
        <span className="muted">{t("world.eras.note")}</span>
      </div>
    </>
  );
}

/**
 * Places, with add, edit and remove.
 *
 * Removing a place doesn't remove people: characters stay placeless, and
 * children stay parentless. It's written in the confirm message because that's
 * what really happens, and a bare "remove" would suggest a
 * cascade delete that doesn't exist.
 */
function PlaceManager({
  worldId,
  places,
  onChanged,
  onProblem,
}: {
  worldId: string;
  places: Location[];
  onChanged: () => Promise<void>;
  onProblem: (message: string | null) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function add(): Promise<void> {
    if (name.trim() === "") return;
    setBusy(true);
    try {
      await api.addLocation(worldId, { name: name.trim(), description });
      setName("");
      setDescription("");
      onProblem(null);
      await onChanged();
    } catch (failure) {
      onProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setBusy(true);
    try {
      await api.deleteLocation(worldId, id);
      setConfirming(null);
      onProblem(null);
      await onChanged();
    } catch (failure) {
      onProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  if (places.length === 0) {
    return (
      <>
        <p className="muted">{t("world.places.empty")}</p>
        <div className="field">
          <label htmlFor="place-name">{t("world.places.nameLabel")}</label>
          <input
            id="place-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("world.places.namePlaceholder")}
          />
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || name.trim() === ""}
          onClick={() => void add()}
        >
          {busy ? t("world.actions.adding") : t("world.places.add")}
        </button>
      </>
    );
  }

  return (
    <div>
      {places.map((place) => (
        <div className="person" key={place.id}>
          <span className="avatar g1">◈</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{place.name}</div>
            <div className="muted">{place.description}</div>
          </div>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setOpen(open === place.id ? null : place.id)}
          >
            {open === place.id ? t("world.actions.close") : t("world.actions.edit")}
          </button>
          {!confirming || confirming !== place.id ? (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={busy}
              onClick={() => setConfirming(place.id)}
            >
              {t("world.actions.remove")}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-sm btn-gold"
              disabled={busy}
              onClick={() => void remove(place.id)}
            >
              {busy ? t("world.actions.removing") : t("world.confirm.deletePlace")}
            </button>
          )}
          {open === place.id && (
            <PlaceEditor
              worldId={worldId}
              place={place}
              places={places}
              onSaved={onChanged}
              onProblem={onProblem}
            />
          )}
        </div>
      ))}

      <details className="acc" style={{ marginTop: 12 }}>
        <summary>{t("world.places.addSummary")}</summary>
        <div>
          <div className="field">
            <label htmlFor="place-name">{t("world.fields.name")}</label>
            <input
              id="place-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("world.places.namePlaceholder")}
            />
          </div>
          <div className="field">
            <label htmlFor="location-description">{t("world.fields.description")}</label>
            <textarea
              id="location-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || name.trim() === ""}
            onClick={() => void add()}
          >
            {busy ? t("world.actions.adding") : t("world.places.add")}
          </button>
        </div>
      </details>
    </div>
  );
}

function PlaceEditor({
  worldId,
  place,
  places,
  onSaved,
  onProblem,
}: {
  worldId: string;
  place: Location;
  places: Location[];
  onSaved: () => Promise<void>;
  onProblem: (message: string | null) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(place.name);
  const [description, setDescription] = useState(place.description);
  const [parentId, setParentId] = useState(place.parentId ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(place.name);
    setDescription(place.description);
    setParentId(place.parentId ?? "");
  }, [place.name, place.description, place.parentId]);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      await api.updateLocation(worldId, place.id, {
        name: name.trim(),
        description,
        parentId: parentId === "" ? null : parentId,
      });
      onProblem(null);
      await onSaved();
    } catch (failure) {
      onProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ flexBasis: "100%" }}>
      <div className="field" style={{ marginTop: 10 }}>
        <label htmlFor={`place-name-${place.id}`}>{t("world.fields.name")}</label>
        <input
          id={`place-name-${place.id}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`location-description-${place.id}`}>{t("world.fields.description")}</label>
        <textarea
          id={`location-description-${place.id}`}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`place-parent-${place.id}`}>{t("world.places.parentLabel")}</label>
        <select
          id={`place-parent-${place.id}`}
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
        >
          <option value="">{t("world.places.parentNone")}</option>
          {places
            .filter((p) => p.id !== place.id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </div>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={busy || name.trim() === ""}
        onClick={() => void save()}
      >
        {busy ? t("world.actions.saving") : t("world.places.save")}
      </button>
    </div>
  );
}

/**
 * Relationships between characters.
 *
 * The two people are picked from lists, never typed as ids: a hand-typed
 * id from another campaign would land in here, and that's
 * exactly the case the server rejects. Numbers run -100 to 100, and the note
 * says why they know each other.
 */
function RelationManager({
  worldId,
  people,
  relations,
  onChanged,
  onProblem,
}: {
  worldId: string;
  people: Character[];
  relations: Relationship[];
  onChanged: () => Promise<void>;
  onProblem: (message: string | null) => void;
}) {
  const { t } = useI18n();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [affinity, setAffinity] = useState(0);
  const [trust, setTrust] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const nameOf = (id: string): string =>
    people.find((p) => p.id === id)?.name ?? t("world.relations.unknown");

  async function save(): Promise<void> {
    if (from === "" || to === "" || from === to) return;
    setBusy(true);
    try {
      await api.setRelationship(worldId, {
        fromCharacterId: from,
        toCharacterId: to,
        affinity,
        trust,
        note,
      });
      setNote("");
      onProblem(null);
      await onChanged();
    } catch (failure) {
      onProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function remove(from: string, to: string): Promise<void> {
    setBusy(true);
    try {
      await api.deleteRelationship(worldId, { fromCharacterId: from, toCharacterId: to });
      onProblem(null);
      await onChanged();
    } catch (failure) {
      onProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {relations.length === 0 ? (
        <p className="muted">{t("world.relations.empty")}</p>
      ) : (
        <div className="stack">
          {relations.map((rel) => (
            <div className="person" key={`${rel.fromCharacterId}-${rel.toCharacterId}`}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  {nameOf(rel.fromCharacterId)} → {nameOf(rel.toCharacterId)}
                </div>
                <div className="muted">
                  {t("world.relations.scores", { affinity: rel.affinity, trust: rel.trust })}
                  {rel.note !== "" ? ` · ${rel.note}` : ""}
                </div>
              </div>
              <span className="spacer" />
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={busy}
                onClick={() => void remove(rel.fromCharacterId, rel.toCharacterId)}
              >
                {t("world.actions.remove")}
              </button>
            </div>
          ))}
        </div>
      )}

      {people.length >= 2 && (
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="row" style={{ gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="rel-da">{t("world.relations.fromLabel")}</label>
              <select id="rel-da" value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="">{t("world.relations.pick")}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="rel-a">{t("world.relations.toLabel")}</label>
              <select id="rel-a" value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">{t("world.relations.pick")}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="rel-affinita">{t("world.relations.affinityLabel")}</label>
              <input
                id="rel-affinita"
                type="number"
                min={-100}
                max={100}
                value={affinity}
                onChange={(e) => setAffinity(Number(e.target.value))}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="rel-fiducia">{t("world.relations.trustLabel")}</label>
              <input
                id="rel-fiducia"
                type="number"
                min={-100}
                max={100}
                value={trust}
                onChange={(e) => setTrust(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="rel-nota">{t("world.relations.noteLabel")}</label>
            <input
              id="rel-nota"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("world.relations.notePlaceholder")}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || from === "" || to === "" || from === to}
            onClick={() => void save()}
          >
            {busy ? t("world.actions.saving") : t("world.relations.save")}
          </button>
        </div>
      )}
    </div>
  );
}
