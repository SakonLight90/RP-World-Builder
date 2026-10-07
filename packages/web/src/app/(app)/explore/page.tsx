"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Art } from "../../../components/Art";
import { useI18n } from "../../../i18n/provider";
import { api } from "../../../lib/api";

/** A canon entry as search returns it, without inventing fields. */
interface FoundEntry {
  subject: string;
  kind: string;
  summary: string;
  status: string;
}

/** A character, as the global search returns them. */
interface FoundCharacter {
  id: string;
  name: string;
  role: string;
  description: string;
}

/** A place, as the global search returns them. */
interface FoundLocation {
  id: string;
  name: string;
  description: string;
  aliases: string[];
}

/** A campaign, as the global search returns them. */
interface FoundWorld {
  id: string;
  name: string;
}

/**
 * The four answers of a global search, kept apart.
 *
 * They stay apart instead of being merged into one list of links because they are
 * four different kinds of thing: a canon entry is text to read, a character and a
 * place are things that exist, and a campaign is somewhere to go. A merged list
 * would have to invent one line shape for all four, and the canon summaries would
 * be cut to the length of a button label.
 */
interface SearchResults {
  canon: FoundEntry[];
  characters: FoundCharacter[];
  locations: FoundLocation[];
  campaigns: FoundWorld[];
}

/** Whether a search found nothing at all, in any of the four parts. */
function isEmpty(results: SearchResults): boolean {
  return (
    results.canon.length === 0 &&
    results.characters.length === 0 &&
    results.locations.length === 0 &&
    results.campaigns.length === 0
  );
}

/**
 * Explore: ready-made worlds and canonical characters.
 *
 * Worlds are "ready" in that they're already loaded locally: no
 * showcase, no download, no account. What's here is here because you or a
 * corpus put it on disk.
 */
export default function ExplorePage() {
  const { t } = useI18n();
  const [templates, setTemplates] = useState<
    { id: string; name: string; slug: string; description: string; templateAuthor: string | null }[]
  >([]);
  const [search, setSearch] = useState("");
  /** The four answers, or null while nothing has been searched yet. */
  const [results, setResults] = useState<SearchResults | null>(null);
  const [worlds, setWorlds] = useState<{ id: string; name: string }[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    api
      .worlds()
      .then((d) => {
        setTemplates(d.templates);
        setWorlds(d.worlds.map((w) => ({ id: w.id, name: w.name })));
        setProblem(null);
      })
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : String(failure)),
      );
  }, []);

  useEffect(() => {
    const first = worlds[0];
    if (first === undefined || search.trim().length < 2) {
      setResults(null);
      return;
    }
    /*
     * Four answers instead of one list of canon entries.
     *
     * This used to call the canon-only search and read the results as characters,
     * which does not exist: `item.name` on a canon entry is `undefined`, so every
     * row rendered empty and the search looked broken. Then it only searched the
     * canon, so a person who remembered a character or a place got nothing and had
     * no way to know the search was working at all.
     */
    api
      .searchWorld(first.id, search)
      .then((d) => {
        setResults(d);
        setProblem(null);
      })
      .catch((failure: unknown) => {
        setResults(null);
        setProblem(failure instanceof Error ? failure.message : String(failure));
      });
  }, [search, worlds]);

  return (
    <div className="wrap">
      <div className="page-head">
        <span className="ico" aria-hidden="true">
          🪐
        </span>{" "}
        {t("explore.page.title")}
        <p>{t("explore.page.sub")}</p>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>{t("explore.worlds.heading")}</h2>
          <span className="muted">{templates.length}</span>
        </div>
        {templates.length === 0 ? (
          <div className="panel">
            <p className="muted" style={{ marginTop: 0 }}>
              {t("explore.worlds.empty")}
            </p>
            <Link href="/" className="btn btn-sm">
              {t("explore.action.backHome")}
            </Link>
          </div>
        ) : (
          <div className="grid">
            {templates.map((template) => (
              <Link
                key={template.id}
                href={`/create?template=${encodeURIComponent(template.slug)}`}
                className="card"
              >
                <Art seed={template.name} fade style={{ aspectRatio: "16 / 10" }} />
                <div className="card-body">
                  <div style={{ fontWeight: 600 }}>{template.name}</div>
                  <p className="muted clamp2">{template.description}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>{t("explore.canon.heading")}</h2>
        </div>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("explore.canon.placeholder")}
        />
        {problem !== null && (
          <div className="note note-bad" style={{ marginTop: 12 }}>
            {problem}
          </div>
        )}

        {/*
            The four parts, each under its own heading and only when it has
            something.

            A section that says "no characters" under a search that found a
            character is noise, and a reader who sees four empty headings cannot
            tell whether the search ran. So a group appears if it has results, and
            "nothing found" appears once, at the bottom, only when all four are
            empty.

            The first world is the one being searched. It is the same world the old
            search used and for the same reason: a campaign is where its canon
            lives, and a name can only mean something inside one.
          */}
        {results !== null && (
          <div className="stack" style={{ gap: 18, marginTop: 14 }}>
            {results.canon.length > 0 && (
              <div>
                <div className="section-head" style={{ marginBottom: 8 }}>
                  <h3>{t("explore.search.canonGroup")}</h3>
                  <span className="muted">{results.canon.length}</span>
                </div>
                {results.canon.map((item) => (
                  <div className="person" key={`${item.kind}-${item.subject}`}>
                    <span className="chip" style={{ alignSelf: "center" }}>
                      {item.kind}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{item.subject}</div>
                      <div className="muted">{item.summary}</div>
                    </div>
                    <span className="spacer" />
                    <span className="chip">{item.status}</span>
                  </div>
                ))}
              </div>
            )}

            {results.characters.length > 0 && (
              <div>
                <div className="section-head" style={{ marginBottom: 8 }}>
                  <h3>{t("explore.search.charactersGroup")}</h3>
                  <span className="muted">{results.characters.length}</span>
                </div>
                {results.characters.map((person) => (
                  <div className="person" key={person.id}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{person.name}</div>
                      {person.role !== "" && <div className="muted">{person.role}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {results.locations.length > 0 && (
              <div>
                <div className="section-head" style={{ marginBottom: 8 }}>
                  <h3>{t("explore.search.locationsGroup")}</h3>
                  <span className="muted">{results.locations.length}</span>
                </div>
                {results.locations.map((place) => (
                  <div className="person" key={place.id}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{place.name}</div>
                      {place.aliases.length > 0 && (
                        <div className="muted">
                          {t("explore.search.alsoKnownAs", { names: place.aliases.join(" · ") })}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {results.campaigns.length > 0 && (
              <div>
                <div className="section-head" style={{ marginBottom: 8 }}>
                  <h3>{t("explore.search.campaignsGroup")}</h3>
                  <span className="muted">{results.campaigns.length}</span>
                </div>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  {results.campaigns.map((world) => (
                    <Link key={world.id} href={`/play/${world.id}`} className="btn btn-sm">
                      {world.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {isEmpty(results) && (
              <p className="muted" style={{ margin: 0 }}>
                {t("explore.canon.noResults")}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
