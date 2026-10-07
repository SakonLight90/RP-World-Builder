"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Art, CastTile } from "../../components/Art";
import { GettingStarted } from "../../components/getting-started";
import { useI18n } from "../../i18n/provider";
import { api, type Character, explainError, readIfNonEssential, type World } from "../../lib/api";

interface Template {
  id: string;
  name: string;
  slug: string;
  description: string;
  templateAuthor: string | null;
}

/**
 * The home page.
 *
 * Like the original: a title saying what this place is, a carousel of
 * featured characters and your stories below. The difference that matters is that
 * here the characters are your world's **canonical** ones: on the original they're
 * illustrated covers, and this project can't download images. A generated
 * tile is less pretty than an illustration, but doesn't lie about what it is.
 */
export default function HomePage() {
  const { locale, t } = useI18n();
  /**
   * The effect below runs once, on mount, and only needs the language to explain
   * a failure that happened just now. Putting `locale` in its dependency list
   * would refetch the same worlds on every language switch to translate one
   * message, so it travels in a ref instead: always current, never a dependency.
   */
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const [worlds, setWorlds] = useState<World[] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [cast, setCast] = useState<Character[]>([]);
  const [active, setActive] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .worlds()
      .then((data) => {
        setWorlds(data.worlds);
        setTemplates(data.templates);
        const first = data.worlds[0];
        if (first) {
          /*
           * The featured cast is accessory: without it, home stays
           * usable. But it's not silenced: `readIfNonEssential` returns
           * `null` and the cast simply stays empty, instead of leaving a
           * failed request with no trace.
           */
          void readIfNonEssential(async () => {
            setCast((await api.characters(first.id)).characters);
          });
        }
      })
      .catch((error: unknown) => setProblem(explainError(error, localeRef.current)));
  }, []);

  async function loadCorpus(): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      await api.loadCorpus();
      const data = await api.worlds();
      setWorlds(data.worlds);
      setTemplates(data.templates);
    } catch (error) {
      setProblem(explainError(error, localeRef.current));
    } finally {
      setBusy(false);
    }
  }

  const list = worlds ?? [];
  const featured = list[active];

  return (
    <div className="wrap">
      <section className="section" style={{ paddingTop: 26 }}>
        <h1 className="hero-title">{t("home.hero.title")}</h1>
        <p className="hero-sub">{t("home.hero.sub")}</p>
      </section>

      {problem !== null && (
        <div className="note note-bad" style={{ marginBottom: 14 }}>
          {problem}
        </div>
      )}

      {worlds !== null && worlds.length === 0 && <GettingStarted worlds={worlds} />}

      {cast.length > 0 && (
        <section className="section" style={{ paddingTop: 8 }}>
          <div className="castrow">
            {cast.map((person) => (
              <CastTile key={person.id} name={person.name} />
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2 className="gold">{t("home.stories.heading")}</h2>
          <Link href="/chats" className="muted">
            {t("home.stories.allChats")}
          </Link>
        </div>

        {/* Nothing yet: say what is needed instead of only offering two buttons. */}
        {list.length === 0 ? (
          <div className="panel">
            <p style={{ margin: "0 0 14px" }}>
              {worlds === null ? t("home.state.loading") : t("home.state.empty")}
            </p>
            {worlds !== null && (
              <div className="row">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={loadCorpus}
                  disabled={busy}
                >
                  {busy ? t("home.action.loadingCorpus") : t("home.action.loadCorpus")}
                </button>
                <Link href="/create" className="btn">
                  {t("home.action.emptyWorld")}
                </Link>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* the selected story: large cover left, text right */}
            {featured !== undefined && (
              <div className="story">
                <Link href={`/play/${featured.id}`} style={{ display: "block" }}>
                  <Art seed={featured.name} fade style={{ aspectRatio: "16 / 10" }} />
                </Link>
                <div className="story-info">
                  <span className="chip chip-violet" style={{ alignSelf: "flex-start" }}>
                    {featured.model.replace("opencode/", "")}
                  </span>
                  <Link href={`/play/${featured.id}`} className="story-title">
                    {featured.name}
                  </Link>
                  <p className="story-desc">
                    {featured.description || t("home.stories.noDescription")}
                  </p>
                  <div className="stats">
                    <span>
                      📖 <b>{cast.length}</b> {t("home.worlds.characters")}
                    </span>
                    <span>
                      🎭 <b>{featured.reasoningEffort}</b> {t("home.worlds.power")}
                    </span>
                    <span>
                      🌐 <b>{featured.activeLocale}</b>
                    </span>
                  </div>
                  <div className="row" style={{ marginTop: 2 }}>
                    <Link href={`/play/${featured.id}`} className="btn btn-sm btn-primary">
                      {t("home.stories.continue")}
                    </Link>
                    <Link href={`/world/${featured.id}`} className="btn btn-sm btn-outline">
                      {t("home.stories.world")}
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {list.length > 1 && (
              <>
                <div className="row" style={{ marginTop: 14, gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={() => setActive((n) => (n - 1 + list.length) % list.length)}
                    aria-label={t("home.stories.previous")}
                  >
                    ‹
                  </button>
                  {list.map((world, index) => (
                    <button
                      key={world.id}
                      type="button"
                      className={`tagpill ${index === active ? "tagpill-on" : ""}`}
                      onClick={() => setActive(index)}
                      aria-label={t("home.stories.goto", { name: world.name })}
                      style={{ width: 26, height: 8, padding: 0 }}
                    />
                  ))}
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={() => setActive((n) => (n + 1) % list.length)}
                    aria-label={t("home.stories.next")}
                  >
                    ›
                  </button>
                </div>

                <div className="grid grid-wide" style={{ marginTop: 16 }}>
                  {list.map((world) => (
                    <Link key={world.id} href={`/play/${world.id}`} className="card">
                      <Art seed={world.name} style={{ aspectRatio: "4 / 3" }} />
                      <div className="card-body">
                        <div style={{ fontWeight: 600 }}>{world.name}</div>
                        <p className="muted">{world.description || "—"}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </section>

      {templates.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="gold">{t("home.templates.heading")}</h2>
            <Link href="/explore" className="muted">
              {t("home.templates.explore")}
            </Link>
          </div>
          <div className="grid grid-wide">
            {templates.map((template) => (
              <div key={template.id} className="card">
                <Art seed={template.name} style={{ aspectRatio: "4 / 3" }} />
                <div className="card-body">
                  <div style={{ fontWeight: 600 }}>{template.name}</div>
                  <p className="muted clamp2">{template.description}</p>
                  <div className="tagrow" style={{ marginTop: 10 }}>
                    <span className="tagpill">{t("home.templates.tagCanon")}</span>
                    <span className="tagpill">{t("home.templates.tagEras")}</span>
                    <span className="tagpill">{t("home.templates.tagCharacters")}</span>
                  </div>
                  <div className="row" style={{ marginTop: 12 }}>
                    <Link
                      href={`/create?template=${encodeURIComponent(template.slug)}`}
                      className="btn btn-sm btn-primary"
                    >
                      {t("home.templates.play")}
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
