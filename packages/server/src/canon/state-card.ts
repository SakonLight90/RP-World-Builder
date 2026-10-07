import type {
  CanonEntry,
  Character,
  Location,
  PlayerCharacter,
  Relationship,
  World,
} from "@rpwb/shared";

/*
 * The state card is the "present state" the narrator receives on every turn.
 *
 * Canon only: locations, characters, relationships, current chapter, and the protagonist when
 * the player declared one. No game state the engine does not write: the narrator owns nothing
 * and renders only what it was given.
 *
 * No language parameter: the card is in English like the prompt introducing it, and the
 * narrator is told separately which language to write in.
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
 * State card labels. Typed and not loose strings: a missing key must fail the typecheck rather
 * than produce `undefined` in the narrator's context.
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
 * It exists because "an unidentifiable place" is an invitation: a narrator not knowing where it
 * is picks one, and then the campaign starts from an invention nobody decided on and nobody
 * can correct. Better to state the world's territory, which is known.
 *
 * Derived from the world and not from an input: a year trailing the name is the era, not a
 * place. It is not a world field nor a request parameter — the base is a property of the world,
 * not a choice, and the player does not change it.
 */
export function worldBasePlace(world: World): string {
  const name = world.name.trim();
  if (name === "") return "";
  // A trailing year is the era, not a place.
  const base = name.replace(/[\s,:-]*\b\d{3,4}\b\s*$/u, "").trim();
  return base === "" ? name : base;
}

export function buildStateCard(input: StateCardInput): StateCard {
  const blocks: string[] = [`## ${LABELS.heading}`];

  // The protagonist comes before everything else, and only if there is one: it is the most
  // stable datum the narrator receives and the one it must never deduce, so a missing
  // protagonist is better as no line at all than one saying "nobody".
  if (input.world.player !== undefined) {
    blocks.push(line(LABELS.protagonist, describeProtagonist(input.world.player)));
  }

  blocks.push(line(LABELS.era, input.activeEras.join(", ")));
  // The current place if there is one, otherwise the world's base: the campaign starts from a
  // known territory, not from "an unidentifiable place".
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
 * The current place, or the world's base place when the player has not pointed at one.
 * `unknownPlace` stays only for a world with no name: the one case where the territory really
 * is unknown.
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
 * The protagonist enters as a player declaration: name, role in parentheses, description after
 * the dash. The description is the part the narrator cannot work out on its own, so it is given
 * in full.
 */
function describeProtagonist(player: PlayerCharacter): string {
  const parts = [player.name];
  if (player.role.trim() !== "") parts.push(`(${player.role})`);
  if (player.description.trim() !== "") parts.push(`— ${player.description}`);
  return parts.join(" ");
}

function describeRelationship(relationship: Relationship): string {
  // Canon, not mood: declared as a starting datum, because the narrator must not deduce a
  // feeling that is not recorded.
  const parts = [
    `${LABELS.affinity} ${relationship.affinity}`,
    `${LABELS.trust} ${relationship.trust}`,
  ];
  if (relationship.note.trim() !== "") parts.push(relationship.note);
  return parts.join(", ");
}

/**
 * The narrator must never see a canon entry invalid for the active era: the last line of
 * defence, for a caller passing an unfiltered list.
 */
export function filterByEra(entries: CanonEntry[], activeEras: string[]): CanonEntry[] {
  if (activeEras.length === 0) return [];
  return entries.filter((entry) => entry.era === "any" || activeEras.includes(entry.era));
}
