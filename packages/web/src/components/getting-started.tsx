"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n/provider";
import { api, type Health, type World } from "../lib/api";

/**
 * What is still missing before the first turn can be played.
 *
 * A panel and not a wizard, and not a modal. A wizard that must be finished before
 * the app can be looked at is a wizard that gets abandoned halfway, and the
 * abandoned half is exactly the part that says what the project is. This shows the
 * state of the three things a first campaign needs, tells what each one is for, and
 * links to the screen that fixes it — and it disappears on its own when all three
 * are done.
 *
 * It is derived and never stored: a flag saying "onboarding done" is a second
 * thing that can disagree with the state it describes, and the only reliable
 * answer to "is this person set up" is the setup itself.
 */
export function GettingStarted({ worlds }: { worlds: World[] }) {
  const { t } = useI18n();
  const [health, setHealth] = useState<Health | null>(null);
  const [preferred, setPreferred] = useState<string | null>(null);

  /*
   * Preferred model and narrator health are two separate reads and they are not
   * joined: the first is a settings row and answers in milliseconds, the second
   * asks opencode and takes over a second. `allSettled` so a narrator that is not
   * running costs the narrator line and not the panel — with `all`, one failure
   * would leave the whole thing blank and the user would see nothing at all,
   * which is worse than seeing one line marked as missing.
   */
  useEffect(() => {
    void Promise.allSettled([
      api.health().then(setHealth),
      api.settings().then((d) => setPreferred(d.settings.preferredModel)),
    ]);
  }, []);

  const steps = useMemo(() => {
    return [
      {
        done: worlds.length > 0,
        title: t("onboarding.step.world.title"),
        body: t("onboarding.step.world.body"),
        // The action is the only one that creates something, and it happens on the
        // home page: linking back here would bounce the user away from the panel
        // that is telling them to do it.
        href: null,
        cta: t("onboarding.step.world.cta"),
      },
      {
        done: health?.healthy === true,
        title: t("onboarding.step.narrator.title"),
        body: t("onboarding.step.narrator.body"),
        href: "/setup",
        cta: t("onboarding.step.narrator.cta"),
      },
      {
        done: preferred !== null && preferred !== "",
        title: t("onboarding.step.model.title"),
        body: t("onboarding.step.model.body"),
        href: "/setup",
        cta: t("onboarding.step.model.cta"),
      },
    ];
  }, [worlds.length, health?.healthy, preferred, t]);

  const pending = steps.filter((step) => !step.done).length;

  // Done means done: no panel, and no "start here again" link either. Someone who
  // wants the explanation has the documentation.
  if (pending === 0) return null;

  return (
    <section className="section">
      <div className="section-head">
        <h2 className="gold">{t("onboarding.title")}</h2>
        <span className="muted">
          {t("onboarding.progress", { done: steps.length - pending, total: steps.length })}
        </span>
      </div>

      <div className="panel">
        <p style={{ marginTop: 0 }}>{t("onboarding.intro")}</p>

        <ol className="onboarding">
          {steps.map((step, index) => (
            <li key={step.title} className={step.done ? "onboarding-done" : undefined}>
              <span className="onboarding-mark" aria-hidden="true">
                {step.done ? "✓" : index + 1}
              </span>
              <div className="onboarding-body">
                <strong>{step.title}</strong>
                <p className="muted" style={{ margin: "2px 0 0" }}>
                  {step.body}
                </p>
              </div>
              {!step.done &&
                (step.href === null ? (
                  <button type="button" className="btn btn-sm btn-primary">
                    {step.cta}
                  </button>
                ) : (
                  <Link href={step.href} className="btn btn-sm">
                    {step.cta}
                  </Link>
                ))}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
