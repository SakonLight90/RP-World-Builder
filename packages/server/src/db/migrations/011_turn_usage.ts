export const TURN_USAGE_SCHEMA = `
-- Migration 011: what each turn actually cost.
--
-- The turn table kept the prompt, the answer and the state, and none of it said
-- how much the turn had used. So the numbers existed only in the opencode session,
-- they went away when the session was deleted or the campaign moved machine, and
-- there was no way to answer "what has this campaign cost me".
--
-- For an application whose narrator is somebody's paid model, that is the first
-- question after "is it working". A turn that used 90,000 input tokens because the
-- canon slice doubled is a thing the player can act on. A total with no history
-- is not: it tells you what you spent without telling you what to change.
--
-- One row per turn, not an accumulator. An accumulator is smaller and cannot be
-- wrong twice, but it cannot be broken up afterwards: with only a sum, a reader who
-- wants to know why the total moved has nothing to look at, and a turn that failed
-- halfway has no separate figure from one that ran. The turns are already rows, so
-- the numbers belong on them.
--
-- All six are nullable and NULL means "not reported". opencode reports usage when
-- the provider does, and a provider is not obliged to. A missing number must read
-- as missing: a zero would be indistinguishable from a turn that really cost
-- nothing, and the difference matters when someone is looking at a bill.
--
-- input_tokens alone is misleading without the cache split, so all four parts of
-- the usage are here: a provider that reads back its own cache is spending far less
-- than the input figure suggests, and the cost cannot be computed without them.
--
-- The backticks other migrations use to name a column cannot be written here: this
-- whole block is one JS template literal, and a backtick inside it closes the
-- string.
ALTER TABLE turns ADD COLUMN input_tokens INTEGER;
ALTER TABLE turns ADD COLUMN output_tokens INTEGER;
ALTER TABLE turns ADD COLUMN reasoning_tokens INTEGER;
ALTER TABLE turns ADD COLUMN cache_read_tokens INTEGER;
ALTER TABLE turns ADD COLUMN cache_write_tokens INTEGER;

-- What the turn cost, in the provider's currency.
--
-- NULL for a free model and NULL for a provider that did not report one. They are
-- different facts and the table does not tell them apart on purpose: the interface
-- shows "free" for a model whose price is zero and does not invent a price for one
-- it does not know, and the total is a sum over the turns that have a value, which
-- is stated next to the total.
ALTER TABLE turns ADD COLUMN turn_cost REAL;
`;
