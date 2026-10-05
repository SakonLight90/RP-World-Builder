import type {
  CanonEntry,
  Character,
  Location,
  PlayerCharacter,
  Relationship,
  World,
} from "@rpwb/shared";

/**
 * The state card is the "present state" the narrator receives on every turn.
 *
 * It holds canon only: locations, characters, relationships, current chapter,
 * and the protagonist when the player has declared one. It holds no game state
 * the engine does not write, because in this design the narrator owns nothing
 * and must only render what it was given.
 *
 * No language parameter: the card is written in English like the prompt that
 * introduces it, and the narrator is told separately which language to write in.
 * A card whose labels changed with the campaign language would put two languages
 * in the same context block for no gain.
 */
export interface StateCardInput {
  world: World;
  currentLocation: Location | null;
  locationAncestry: Location[];
  presentCharacters: Character[];
  relationships: Relationship[];
  charactersById: Map<string, Character>;
  currentChapter: { n: number; title: string } | null;
  activeEras: string[];
}

export interface StateCard {
  text: string;
  tokens: number;
}

/**
 * State card labels. They exist for the interface and not as loose strings: a
 * missing key must fail the typecheck, not produce `undefined` in the
 * narrator's context.
 *
 * The card is in English for every world: the labels are instructions the
 * narrator reads, not decoration, and one spelling of the same block is one
 * thing to keep working.
 */
interface Labels {
  heading: string;
  protagonist: string;
  where: string;
  ancestry: string;
  present: string;
  player: string;
  relations: string;
  chapter: string;
  era: string;
  noOne: string;
  affinity: string;
  trust: string;
  unknownPlace: string;
}

const LABELS: Labels = {
  heading: "STATE",
  protagonist: "You play",
  where: "You are in",
  ancestry: "Territory",
  present: "With you now",
  player: "Your character",
  relations: "Known ties",
  chapter: "Last chapter",
  era: "Era",
  noOne: "Nobody else is present.",
  affinity: "affinity",
  trust: "trust",
  unknownPlace: "an unidentifiable place",
};

function line(label: string, value: string): string {
  return value.trim() === "" ? "" : `- **${label}:** ${value}`;
}

/**
 * The world's base place: the territory the campaign starts in.
 *
 * It exists because "an unidentifiable place" is not a description, it is an
 * invitation: the narrator, not knowing where it is, picks one. And if it picks
 * one, the example world no longer starts in Appalachia: it starts from an
 * invention nobody decided on and nobody can correct, because the canon does
 * not contain it. Better to state the world's territory, which is known.
 *
 * Derived from the world and not from an input. The year trailing the name is
 * the era, not a place ("Appalachia 2287" is Appalachia), so it does not end up
 * here. It is not a world field nor a parameter of any request: the base is a
 * property of the world, not one choice among others, and the player does not
 * change it.
 */
export function worldBasePlace(world: World): string {
  const name = world.name.trim();
  if (name === "") return "";
  // "Appalachia 2287" stays "Appalachia": the year is the era, not a place.
  const base = name.replace(/[\s,:-]*\b\d{3,4}\b\s*$/u, "").trim();
  return base === "" ? name : base;
}

export function buildStateCard(input: StateCardInput): StateCard {
  const blocks: string[] = [`## ${LABELS.heading}`];

  // The protagonist comes before everything else, and only if there is one: it
  // is the most stable datum the narrator receives and the one it must never
  // deduce, so when it is missing it is better to have no line at all than one
  // saying "nobody". Empty was already the behaviour before, and stays so.
  if (input.world.player !== undefined) {
    blocks.push(line(LABELS.protagonist, describeProtagonist(input.world.player)));
  }

  blocks.push(line(LABELS.era, input.activeEras.join(", ")));
  // The current place if there is one, otherwise the world's base place: the
  // campaign starts from a known territory, not from "an unidentifiable place".
  blocks.push(
    line(LABELS.where, describeLocation(input.currentLocation, worldBasePlace(input.world))),
  );
  blocks.push(
    line(
      LABELS.ancestry,
      input.locationAncestry
        .map((location) => location.name)
        .filter((name) => name !== input.currentLocation?.name)
        .join(" > "),
    ),
  );

  const others = input.presentCharacters.filter((character) => !character.isPlayer);
  const player = input.presentCharacters.find((character) => character.isPlayer);

  if (player) blocks.push(line(LABELS.player, describeCharacter(player)));
  blocks.push(
    line(
      LABELS.present,
      others.length === 0 ? LABELS.noOne : others.map(describeCharacter).join("; "),
    ),
  );

  if (input.relationships.length > 0) {
    blocks.push(line(LABELS.relations, input.relationships.map(describeRelationship).join("; ")));
  }

  if (input.currentChapter) {
    blocks.push(line(LABELS.chapter, `${input.currentChapter.n} — ${input.currentChapter.title}`));
  }

  const text = blocks.filter((block) => block !== "").join("\n");
  return { text, tokens: Math.ceil(text.length / 4) };
}

/**
 * The current place, or the world's base place if the player has not pointed at
 * one. `unknownPlace` stays only for a world with no name: it is the one case
 * where the territory really is unknown, and then saying so is right.
 */
function describeLocation(location: Location | null, basePlace: string): string {
  if (!location) return basePlace === "" ? LABELS.unknownPlace : basePlace;
  return location.description.trim() === ""
    ? location.name
    : `${location.name} (${location.description})`;
}

function describeCharacter(character: Character): string {
  const parts = [character.name];
  if (character.role.trim() !== "") parts.push(character.role);
  if (character.status.trim() !== "") parts.push(`— ${character.status}`);
  if (character.personality.trim() !== "") parts.push(`(${character.personality})`);
  return parts.join(" ");
}

/**
 * The protagonist enters as a player declaration: name and role in parentheses,
 * description after the dash. The description is the part the narrator cannot
 * work out on its own, so it is given in full and not summarised: a
 * protagonist the player described in three words is already everything the
 * narrator has to know.
 */
function describeProtagonist(player: PlayerCharacter): string {
  const parts = [player.name];
  if (player.role.trim() !== "") parts.push(`(${player.role})`);
  if (player.description.trim() !== "") parts.push(`— ${player.description}`);
  return parts.join(" ");
}

function describeRelationship(relationship: Relationship): string {
  // The relationship is canon, not mood: it is declared as a starting datum,
  // because the narrator must not deduce a feeling that is not recorded.
  const parts = [
    `${LABELS.affinity} ${relationship.affinity}`,
    `${LABELS.trust} ${relationship.trust}`,
  ];
  if (relationship.note.trim() !== "") parts.push(relationship.note);
  return parts.join(", ");
}

/**
 * The narrator must never see a canon entry that is not valid for the active
 * era: this filter is the last line of defence, for the case where the caller
 * passes an unfiltered list.
 */
export function filterByEra(entries: CanonEntry[], activeEras: string[]): CanonEntry[] {
  if (activeEras.length === 0) return [];
  return entries.filter((entry) => entry.era === "any" || activeEras.includes(entry.era));
}
