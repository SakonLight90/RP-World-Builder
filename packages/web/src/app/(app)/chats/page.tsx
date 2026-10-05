"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Art } from "../../../components/Art";
import { useI18n } from "../../../i18n/provider";
import { api, type Chapter, explainError, readIfNonEssential, type World } from "../../../lib/api";

/**
 * The chat list.
 *
 * Each row carries what you need to decide whether to reopen: cover, latest
 * chapter, summary and when it happened. The rest is action — play and clock —
 * because this list exists to enter a story, not to study it.
 */
export default function ChatsPage() {
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
  const [latest, setLatest] = useState<Record<string, Chapter | undefined>>({});
  const [filter, setFilter] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    api
      .worlds()
      .then((data) => {
        setWorlds(data.worlds);
        setProblem(null);
        for (const world of data.worlds) {
          /*
           * Latest chapter and context percentage are per-world accessories: if
           * one of the two never arrives, the other worlds must still show. So
           * failure isn't silenced but confined to that cell.
           *
           * Note the difference from the world read below: a failed one
           * gave `setWorlds([])`, and an empty list with no explanation line is
           * indistinguishable from "you haven't created any campaign yet".
           */
          void readIfNonEssential(async () => {
            const d = await api.chapters(world.id);
            setLatest((prev) => ({ ...prev, [world.id]: d.chapters.at(-1) }));
          });
          /*
           * The context percentage is deliberately NOT read here.
           *
           * It used to be, once per world, and it made this page the slowest
           * screen in the project: the reading goes through opencode, so each
           * row started an opencode server for that campaign's folder and waited
           * for it. Three campaigns meant three processes and about five seconds
           * before the list was usable.
           *
           * The number is decoration on a list, and the world you actually play
           * is opened right after, where the same reading already happens once,
           * for one world, on purpose. A list that has to wake the narrator to
           * draw itself is a list that cannot be long.
           */
        }
      })
      .catch((error: unknown) => {
        setProblem(explainError(error, localeRef.current));
        setWorlds([]);
      });
  }, []);

  const shown = (worlds ?? []).filter((world) =>
    world.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  const categories = [
    { icon: "🔖", label: t("chats.category.saved"), cls: "chip-gold" },
    { icon: "💖", label: t("chats.category.liked"), cls: "chip-pink" },
    { icon: "💬", label: t("chats.category.comments"), cls: "chip-blue" },
    { icon: "👥", label: t("chats.category.ongoing"), cls: "chip-violet" },
  ];

  return (
    <div className="wrap">
      <div className="page-head">
        <span className="ico" aria-hidden="true">
          🗓
        </span>
        {t("chats.page.title")}
      </div>

      <section className="section">
        <div className="catgrid">
          {categories.map((category) => (
            <div className="cat" key={category.label}>
              <span className={`cat-ico ${category.cls}`} aria-hidden="true">
                {category.icon}
              </span>
              {category.label}
            </div>
          ))}
        </div>
      </section>

      <div className="row" style={{ marginTop: 4 }}>
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t("chats.search.placeholder")}
          style={{ flex: 1 }}
        />
      </div>

      <section className="section">
        {worlds === null ? (
          <p className="muted">{t("chats.state.loading")}</p>
        ) : shown.length === 0 ? (
          <div className="panel">
            <p style={{ marginTop: 0 }}>
              {/*
               * `problem` takes precedence over everything. Without this, a failed
               * load said "You have no stories yet" and offered the
               * create button: the user owned six campaigns and was
               * invited to create a seventh.
               */}
              {problem !== null
                ? problem
                : worlds.length === 0
                  ? t("chats.state.empty")
                  : t("chats.state.noResults")}
            </p>
            {worlds.length === 0 && problem === null && (
              <Link href="/create" className="btn btn-primary">
                {t("chats.action.start")}
              </Link>
            )}
          </div>
        ) : (
          <div className="stack">
            {shown.map((world) => {
              const chapter = latest[world.id];
              return (
                <div className="chatrow" key={world.id}>
                  <Link href={`/play/${world.id}`} style={{ display: "block" }}>
                    <Art seed={world.name} style={{ aspectRatio: "3 / 4" }} />
                  </Link>
                  <div style={{ minWidth: 0 }}>
                    <Link href={`/play/${world.id}`} style={{ fontWeight: 700, fontSize: 16 }}>
                      {world.name}
                    </Link>
                    <div style={{ margin: "6px 0 8px" }}>
                      <span className="chip chip-violet">{world.name}</span>
                    </div>
                    <p className="muted clamp2" style={{ margin: 0 }}>
                      {chapter?.summary ?? t("chats.row.notStarted")}
                    </p>
                    <div className="row" style={{ marginTop: 10, gap: 8 }}>
                      <span className="muted">
                        {chapter === undefined
                          ? t("chats.row.firstChapter")
                          : t("chats.row.chapter", { n: chapter.n })}
                      </span>
                    </div>
                  </div>
                  <div className="chat-actions">
                    <Link
                      href={`/play/${world.id}`}
                      className="btn btn-round"
                      aria-label={t("chats.aria.play")}
                    >
                      ▶
                    </Link>
                    <Link
                      href={`/world/${world.id}`}
                      className="btn btn-round"
                      aria-label={t("chats.aria.notebook")}
                    >
                      🕐
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
