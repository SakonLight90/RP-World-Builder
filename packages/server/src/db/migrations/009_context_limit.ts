export const CONTEXT_LIMIT_SCHEMA = `
-- Migration 009: a per-campaign context window.
--
-- The window used to come from the provider alone: the server asked opencode
-- what model X allows and used the answer, with a fixed fallback when the
-- provider said nothing. That is right when the provider always knows and the
-- player always has the same plan. Neither holds.
--
-- A free model and a paid one on the same account can differ by an order of
-- magnitude, plans change what a model allows, and a provider that does not
-- declare a window leaves the campaign on the fallback with no way to say
-- otherwise. The player knows which model they pay for and how large its window
-- is, so they set it.
--
-- NULL means "ask the provider", which keeps the old behaviour as the default:
-- a campaign that has never been touched still follows whatever the model
-- actually accepts, and nobody has to maintain a number that the provider
-- already knows.
--
-- Adding a column rather than a settings row: it belongs to the campaign, not to
-- the machine. Two campaigns on the same computer run on different models with
-- different plans.
ALTER TABLE worlds ADD COLUMN context_limit INTEGER;
`;
