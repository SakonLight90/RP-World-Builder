"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LOCALE_NAMES, UI_LOCALES, type UiLocale } from "../../../i18n";
import { useI18n } from "../../../i18n/provider";
import {
  api,
  explainError,
  type Health,
  type Model,
  type Toolchain,
  type World,
} from "../../../lib/api";

/**
 * Settings: what's connected, what it costs, and how to leave.
 *
 * The uncomfortable truth lands here too — which model it uses, whether it keeps
 * data, and which compiler runs the UI. A local project that won't say what it's
 * doing is just a project you haven't understood.
 */
export default function SetupPage() {
  const { t, locale, setLocale } = useI18n();
  // The error text is resolved here, not in the component that catches it: an
  // effect that reads the language would have to list it as a dependency, and then
  // changing the interface language would refetch everything it had loaded.
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const [health, setHealth] = useState<Health | null>(null);
  const [toolchain, setToolchain] = useState<Toolchain | null>(null);
  const [status, setStatus] = useState<{ dataDir: string } | null>(null);
  const [narrator, setNarrator] = useState<Model[]>([]);
  const [restricted, setRestricted] = useState<Model[]>([]);
  const [worlds, setWorlds] = useState<World[]>([]);
  const [preferred, setPreferred] = useState("");
  const [savedSettings, setSavedSettings] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [narratorProblem, setNarratorProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * Two loads, not one.
   *
   * They were a single `Promise.all`, which meant the page drew nothing until
   * the slowest of them answered — and the slowest two are `health` and
   * `models`, because both ask opencode whether the narrator is there. Measured
   * on this machine: `status`, `worlds` and `settings` answer in 12-15 ms,
   * `health` in 1302 ms and `models` in 1169. So the page waited about a second
   * and a half to show a folder path it already had.
   *
   * Worse, it was one `catch`: with the narrator down, `health` failed and the
   * whole page — including the campaigns list and the delete button — was
   * replaced by an error. A narrator that is not running should cost you the
   * narrator section, not the page.
   */
  useEffect(() => {
    Promise.all([api.status(), api.worlds(), api.settings()])
      .then(([s, w, settings]) => {
        setToolchain(s.toolchain);
        setStatus(s);
        setWorlds(w.worlds);
        setPreferred(settings.settings.preferredModel ?? "");
      })
      .catch((error: unknown) => {
        setProblem(explainError(error, localeRef.current));
      });
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([api.health(), api.models()])
      .then(([h, m]) => {
        if (!alive) return;
        setHealth(h);
        setNarrator(m.narrator);
        setRestricted(m.restricted);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        // Not the page's problem, so not the page's error: the narrator section
        // says what happened and everything else keeps working.
        setNarratorProblem(explainError(error, localeRef.current));
      });
    return () => {
      alive = false;
    };
  }, []);

  async function remove(id: string): Promise<void> {
    setBusy(true);
    try {
      await api.deleteWorld(id);
      setWorlds((prev) => prev.filter((world) => world.id !== id));
    } catch (error) {
      setProblem(explainError(error, localeRef.current));
    } finally {
      setBusy(false);
    }
  }

  /*
   * Preferred models are chosen here and apply to new worlds and the
   * catalog default. `null` means "no preference", not the string "null":
   * the server treats it as absence, and the list falls back to its default.
   */
  async function savePreferred(): Promise<void> {
    setBusy(true);
    setSavedSettings(false);
    try {
      await api.updateSettings({
        preferredModel: preferred === "" ? null : preferred,
        // Reaching this point means the narrator was chosen and the page was
        // read to the end, which is the whole of the wizard. The flag was in the
        // settings contract and in the status route since the beginning with
        // nothing to set it, so "has the setup been done" always answered no.
        setupCompleted: true,
      });
      setSavedSettings(true);
      setProblem(null);
    } catch (error) {
      setProblem(explainError(error, localeRef.current));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <div className="page-head">
        <h1>{t("setup.page.title")}</h1>
        <p>{t("setup.page.intro")}</p>
      </div>

      {problem !== null && (
        <div className="note note-bad" style={{ marginTop: 14 }}>
          {problem}
        </div>
      )}

      <section className="section">
        <div className="section-head">
          <h2>{t("setup.narrator.heading")}</h2>
        </div>
        <div className="panel">
          {narratorProblem !== null ? (
            <p className="muted" style={{ margin: 0 }}>
              {narratorProblem}
            </p>
          ) : health === null ? (
            <p className="muted" style={{ margin: 0 }}>
              {t("setup.checking")}
            </p>
          ) : (
            <>
              <div className="row">
                <span className={`chip ${health.healthy ? "chip-green" : "chip-red"}`}>
                  opencode {health.version ?? t("setup.health.unreachable")}
                </span>
                <span className="chip chip-green">
                  {health.binary.path ?? t("setup.health.binaryMissing")}
                </span>
              </div>
              {!health.healthy && (
                <div className="note note-bad" style={{ marginTop: 12 }}>
                  {health.problem}
                </div>
              )}

              <div className="section-head" style={{ marginTop: 20, marginBottom: 8 }}>
                <h3>{t("setup.models.freeHeading")}</h3>
                <span className="muted">{narrator.length}</span>
              </div>
              <table className="t">
                <thead>
                  <tr>
                    <th>{t("setup.models.colModel")}</th>
                    <th>{t("setup.models.colContext")}</th>
                    <th>{t("setup.models.colPrivacy")}</th>
                  </tr>
                </thead>
                <tbody>
                  {narrator.map((model) => (
                    <tr key={model.ref}>
                      <td>
                        {model.name}
                        {health.defaultModel === model.ref && (
                          <span className="chip chip-green" style={{ marginLeft: 6 }}>
                            {t("setup.models.defaultBadge")}
                          </span>
                        )}
                      </td>
                      <td>{Math.round(model.contextLimit / 1000)}k</td>
                      <td className="muted">{model.privacyNote}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {restricted.length > 0 && (
                <>
                  <div className="section-head" style={{ marginTop: 20, marginBottom: 8 }}>
                    <h3>{t("setup.models.keepHeading")}</h3>
                    <span className="muted">{restricted.length}</span>
                  </div>
                  <table className="t">
                    <tbody>
                      {restricted.map((model) => (
                        <tr key={model.ref}>
                          <td>{model.name}</td>
                          <td className="muted">{model.privacyNote}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              <div className="section-head" style={{ marginTop: 20, marginBottom: 8 }}>
                <h3>{t("setup.preferred.heading")}</h3>
              </div>
              <div className="field">
                <label htmlFor="preferred-model">{t("setup.preferred.narrator")}</label>
                <select
                  id="preferred-model"
                  value={preferred}
                  onChange={(e) => setPreferred(e.target.value)}
                >
                  <option value="">{t("setup.preferred.none")}</option>
                  {narrator.map((model) => (
                    <option key={model.ref} value={model.ref}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </div>
              <p className="muted">{t("setup.preferred.note")}</p>
              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={() => void savePreferred()}
                >
                  {busy ? t("setup.action.saving") : t("setup.action.save")}
                </button>
                {savedSettings && <span className="chip chip-green">{t("setup.saved")}</span>}
              </div>
            </>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>{t("setup.interface.heading")}</h2>
        </div>
        <div className="panel">
          <label className="field" htmlFor="ui-language">
            {t("setup.interface.languageLabel")}
          </label>
          <select
            id="ui-language"
            className="pick"
            value={locale}
            onChange={(event) => setLocale(event.target.value as UiLocale)}
          >
            {UI_LOCALES.map((language) => (
              <option key={language} value={language}>
                {LOCALE_NAMES[language]}
              </option>
            ))}
          </select>
          <p className="muted" style={{ marginTop: 8 }}>
            {t("setup.interface.languageNote")}
          </p>
          <hr style={{ margin: "20px 0", border: 0, borderTop: "1px solid var(--line-soft)" }} />
          {toolchain === null ? (
            <p className="muted" style={{ margin: 0 }}>
              {t("setup.checking")}
            </p>
          ) : (
            <>
              <div className="row">
                <span className="chip chip-green">Next {toolchain.next}</span>
                <span className="chip chip-green">TypeScript {toolchain.typescript}</span>
                <span
                  className={`chip ${toolchain.compiler === "native" ? "chip-green" : "chip-gold"}`}
                >
                  {toolchain.compiler === "native"
                    ? t("setup.interface.compilerNative")
                    : t("setup.interface.compilerWasm")}
                </span>
              </div>
              {toolchain.compiler === "wasm" && (
                <div className="note note-warn" style={{ marginTop: 12 }}>
                  {toolchain.consequence}
                  <div style={{ marginTop: 8 }}>{t("setup.interface.reinstall")}</div>
                  <code style={{ display: "block", marginTop: 6 }}>{toolchain.fix}</code>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>{t("setup.data.heading")}</h2>
        </div>
        <div className="panel">
          <p className="muted" style={{ marginTop: 0 }}>
            {t("setup.data.note")}
          </p>
          {status !== null && <div className="chip chip-green">{status.dataDir}</div>}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>{t("setup.worlds.heading")}</h2>
          <span className="muted">{worlds.length}</span>
        </div>
        {worlds.length === 0 ? (
          <p className="muted">{t("setup.worlds.empty")}</p>
        ) : (
          <div className="panel" style={{ padding: 0 }}>
            <table className="t">
              <tbody>
                {worlds.map((world) => (
                  <tr key={world.id}>
                    <td>
                      <Link href={`/world/${world.id}`}>{world.name}</Link>
                    </td>
                    <td className="muted">{world.model.replace("opencode/", "")}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => remove(world.id)}
                        disabled={busy}
                      >
                        {t("setup.worlds.remove")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
