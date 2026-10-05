"use client";

import { LOCALE_NAMES, REASONING_EFFORTS, UI_LOCALES, type UiLocale } from "@rpwb/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Art } from "../../../components/Art";
import { useI18n } from "../../../i18n/provider";
import { api, type Model, type Toolchain } from "../../../lib/api";

/**
 * Create a world.
 *
 * Four steps in real dependency order: first verify something can
 * narrate for you, then choose who, and only at the end name it. If
 * the first step fails, the rest make no sense.
 */
export default function CreatePage() {
  const { t } = useI18n();
  // `useSearchParams` needs a boundary: without it, Next can't pre-render
  // the page and the build stops.
  return (
    <Suspense fallback={<div className="wrap pad center muted">{t("create.page.loading")}</div>}>
      <Creator />
    </Suspense>
  );
}

function Creator() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const template = params.get("template") ?? "";

  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.health>> | null>(null);
  const [toolchain, setToolchain] = useState<Toolchain | null>(null);
  const [narrator, setNarrator] = useState<Model[]>([]);
  const [restricted, setRestricted] = useState<Model[]>([]);
  const [templates, setTemplates] = useState<{ slug: string; name: string }[]>([]);

  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState<(typeof REASONING_EFFORTS)[number]>("default");
  const [locale, setLocale] = useState<UiLocale>("it");
  const [fromTemplate, setFromTemplate] = useState(template);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.health(), api.models(), api.worlds(), api.status()])
      .then(([h, m, w, s]) => {
        setHealth(h);
        setToolchain(s.toolchain);
        setNarrator(m.narrator);
        setRestricted(m.restricted);
        setTemplates(w.templates.map((t) => ({ slug: t.slug, name: t.name })));
        if (m.default) setModel(m.default);
      })
      .catch((error: unknown) =>
        setProblem(error instanceof Error ? error.message : String(error)),
      );
  }, []);

  const ready = health?.healthy === true && model !== "";

  async function create(): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      const { world } = await api.createWorld({
        name: name.trim() === "" ? t("create.defaultName") : name.trim(),
        model,
        smallModel: model,
        reasoningEffort: effort,
        baseLocale: locale,
        ...(fromTemplate === "" ? {} : { fromTemplate }),
      });
      router.push(`/play/${world.id}`);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <div className="page-head">
        <span className="ico" aria-hidden="true">
          🎭
        </span>
        {t("create.page.title")}
      </div>

      {/* preview: show the world exists right away, even before creating it */}
      <div
        style={{
          borderRadius: "var(--r-l)",
          overflow: "hidden",
          marginTop: 14,
          border: "1px solid var(--line-soft)",
        }}
      >
        <Art
          seed={name === "" ? "new" : name}
          title={name.trim() === "" ? t("create.defaultName") : name}
          fade
          style={{ aspectRatio: "21 / 9" }}
        />
      </div>

      <p className="muted center" style={{ marginTop: 10 }}>
        {t("create.page.tagline")}
      </p>

      <section className="section">
        <div className="section-head">
          <h2>{t("create.step.requirements")}</h2>
        </div>
        <div className="panel">
          {health === null ? (
            <p className="muted" style={{ margin: 0 }}>
              {t("create.health.checking")}
            </p>
          ) : health.healthy ? (
            <div className="row">
              <span className="chip chip-green">opencode {health.version}</span>
              <span className="chip chip-green">
                {t("create.health.freeModels", { count: health.freeModels.length })}
              </span>
              <span className="chip chip-green">{health.providers.join(", ")}</span>
            </div>
          ) : (
            <div className="note note-bad">
              <strong>{t("create.health.cannotNarrate")}</strong>
              <div style={{ marginTop: 6 }}>{health.problem}</div>
            </div>
          )}

          {toolchain !== null && toolchain.compiler === "wasm" && (
            <div className="note note-warn" style={{ marginTop: 12 }}>
              <strong>{t("create.toolchain.heading")}</strong>
              <div style={{ marginTop: 6 }}>{toolchain.consequence}</div>
              <div style={{ marginTop: 8 }}>{t("create.toolchain.note")}</div>
              <code style={{ display: "block", marginTop: 6 }}>{toolchain.fix}</code>
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>{t("create.step.narrator")}</h2>
        </div>
        <div className="panel">
          <div className="field">
            <label htmlFor="model">{t("create.model.label")}</label>
            <select id="model" value={model} onChange={(e) => setModel(e.target.value)}>
              {narrator.map((m) => (
                <option key={m.ref} value={m.ref}>
                  {t("create.model.option", {
                    name: m.name,
                    context: Math.round(m.contextLimit / 1000),
                  })}
                </option>
              ))}
            </select>
            <p className="muted">{t("create.model.note")}</p>
          </div>

          <div className="field">
            <label htmlFor="effort">{t("create.reasoning.label")}</label>
            <select
              id="effort"
              value={effort}
              onChange={(e) => setEffort(e.target.value as typeof effort)}
            >
              {/*
                The same four values the server accepts, from the same
                constant: a hand-written list here and one there diverge at the
                first addition, and the picker would offer a choice that
                saving rejects.
              */}
              {REASONING_EFFORTS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
            <p className="muted">{t("create.reasoning.note")}</p>
          </div>

          <div className="field">
            <label htmlFor="locale">{t("create.locale.label")}</label>
            <select
              id="locale"
              value={locale}
              onChange={(e) => setLocale(e.target.value as UiLocale)}
            >
              {UI_LOCALES.map((code) => (
                <option key={code} value={code}>
                  {LOCALE_NAMES[code]}
                </option>
              ))}
            </select>
            <p className="muted">{t("create.locale.note")}</p>
          </div>

          {restricted.length > 0 && (
            <details className="acc">
              <summary>{t("create.restricted.summary", { count: restricted.length })}</summary>
              <div className="stack">
                {restricted.map((m) => (
                  <div key={m.ref} className="row">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{m.name}</div>
                      <div className="muted">{m.privacyNote}</div>
                    </div>
                    <span className="spacer" />
                    <button type="button" className="btn btn-sm" onClick={() => setModel(m.ref)}>
                      {t("create.restricted.use")}
                    </button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>{t("create.step.world")}</h2>
        </div>
        <div className="panel">
          <div className="field">
            <label htmlFor="name">{t("create.name.label")}</label>
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("create.name.placeholder", { name: t("create.defaultName") })}
            />
          </div>

          <div className="field">
            <label htmlFor="template">{t("create.template.label")}</label>
            <select
              id="template"
              value={fromTemplate}
              onChange={(e) => setFromTemplate(e.target.value)}
            >
              <option value="">{t("create.template.empty")}</option>
              {templates.map((preset) => (
                <option key={preset.slug} value={preset.slug}>
                  {preset.name}
                </option>
              ))}
            </select>
            <p className="muted">{t("create.template.note")}</p>
          </div>

          {problem !== null && (
            <div className="note note-bad" style={{ marginTop: 10 }}>
              {problem}
            </div>
          )}

          <div className="row" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={create}
              disabled={!ready || busy}
            >
              {busy ? t("create.action.creating") : t("create.action.start")}
            </button>
            <Link href="/" className="btn btn-ghost btn-sm">
              {t("create.action.cancel")}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
