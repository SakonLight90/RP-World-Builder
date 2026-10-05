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
  const [found, setFound] = useState<FoundEntry[] | null>(null);
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
      setFound(null);
      return;
    }
    /*
     * Results are canon entries and read as such: this code used to force them
     * into `Character[]` and read `item.name`, which doesn't exist,
     * so search showed empty rows and looked broken.
     */
    api
      .canonSearch(first.id, search)
      .then((d) => {
        setFound(d.results);
        setProblem(null);
      })
      .catch((failure: unknown) => {
        setFound(null);
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
        {found !== null && found.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {found.map((item) => (
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
        {found !== null && found.length === 0 && (
          <p className="muted" style={{ marginTop: 12 }}>
            {t("explore.canon.noResults")}
          </p>
        )}
      </section>
    </div>
  );
}
