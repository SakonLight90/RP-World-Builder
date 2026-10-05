/**
 * Migration 006: narrator turns, one row per turn.
 *
 * Until now a turn was an HTTP request held open for minutes, with the
 * answer streaming inside it. Closing the tab was not a network
 * matter: it also closed the narrator, and nothing was left saying whether it was
 * working or had stopped. The symptom was a UI showing the context
 * used and no text, identical to a hang.
 *
 * Here the turn becomes a row: born `running` when Send is pressed and closed
 * `completed` with the text, or `failed` with the reason. The truth of a turn is this
 * row, so reopening the tab mid-generation deletes nothing and
 * the UI does not depend on the connection to know where things stand.
 *
 * `stato` has three values, and the constraint keeps a fourth from being written by
 * mistake: an invented state makes a turn look ongoing when it is not, and that is
 * the same old bug in disguise. The `interrotto` state is not a fourth
 * value: it is a `running` gone old, computed on read, because
 * a backend restarted halfway never passes anywhere to write it. See
 * `db/repo/turns.ts`.
 *
 * `testo` and `errore` are both optional and NULL when absent, not NULL and
 * empty: a newborn turn has neither, and saying "it answered with
 * nothing" differs from saying "it has not answered yet".
 */
export const TURNS_SCHEMA = `
CREATE TABLE turns (
  id        TEXT PRIMARY KEY,
  world_id  TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  prompt    TEXT NOT NULL,
  testo     TEXT,
  errore    TEXT,
  stato     TEXT NOT NULL DEFAULT 'running' CHECK (stato IN ('running', 'completed', 'failed')),
  creato_il TEXT NOT NULL,
  finito_il TEXT,
  locale    TEXT NOT NULL DEFAULT 'it'
);

CREATE INDEX turns_mondo ON turns(world_id, creato_il);
`;
