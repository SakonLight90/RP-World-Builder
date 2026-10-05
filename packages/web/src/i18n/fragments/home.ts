/**
 * UI strings for the `home` area: the landing screen with the hero, the
 * carousel of your stories and the shelf of ready-made worlds.
 *
 * Split by area so two people can work on different screens without touching
 * the same file. Every area exports the same five languages, because a key that
 * exists only in English is a key nobody notices is missing.
 *
 * The objects are plain literals on purpose: annotating them would widen the key
 * set back to `string` and the four translations would no longer be checked
 * against English.
 *
 * The cast tiles at the top come from `Art.tsx`, and their three words belong to
 * `play.adapt.*`: a component shared by several pages can't own the copy of one
 * of them, so nothing is duplicated here.
 *
 * The stat row keeps its `<b>` around the raw model name and context count, so
 * those two keys are the single words that follow the number instead of an
 * interpolated phrase.
 */
export const homeEn = {
  "home.hero.title": "Live the story, feel the emotion",
  "home.hero.sub":
    "A world that remembers what you did, a narrator that never contradicts the canon. The canon and the campaign stay on your computer.",

  "home.state.loading": "loading…",
  "home.state.empty":
    "There is no story yet. Start from a world that is already written, or open an empty one and decide as you play.",

  "home.stories.heading": "🔥 Your stories",
  "home.stories.allChats": "all the chats",
  "home.stories.previous": "Previous story",
  "home.stories.next": "Next story",
  "home.stories.goto": "Go to {{name}}",
  "home.stories.continue": "▶ Continue",
  "home.stories.world": "World",
  "home.stories.noDescription": "A story just begun.",

  "home.worlds.characters": "characters",
  "home.worlds.power": "power",

  "home.action.loadCorpus": "load the ready worlds",
  "home.action.loadingCorpus": "loading…",
  "home.action.emptyWorld": "empty world",

  "home.templates.heading": "Ready worlds",
  "home.templates.explore": "explore",
  "home.templates.tagCanon": "canon already written",
  "home.templates.tagEras": "eras",
  "home.templates.tagCharacters": "characters",
  "home.templates.play": "Play",
};

export const homeIt = {
  "home.hero.title": "Vivi la storia, senti l'emozione",
  "home.hero.sub":
    "Un mondo che si ricorda di quello che hai fatto, un narratore che non contraddice il canone. Il canone e la campagna restano sul tuo computer.",

  "home.state.loading": "carico…",
  "home.state.empty":
    "Non c'è ancora nessuna storia. Comincia da un mondo già scritto, o aprine uno vuoto e decidi mentre giochi.",

  "home.stories.heading": "🔥 Le tue storie",
  "home.stories.allChats": "tutte le chat",
  "home.stories.previous": "Storia precedente",
  "home.stories.next": "Storia successiva",
  "home.stories.goto": "Vai a {{name}}",
  "home.stories.continue": "▶ Continua",
  "home.stories.world": "Mondo",
  "home.stories.noDescription": "Una storia appena iniziata.",

  "home.worlds.characters": "personaggi",
  "home.worlds.power": "potenza",

  "home.action.loadCorpus": "carica i mondi pronti",
  "home.action.loadingCorpus": "carico…",
  "home.action.emptyWorld": "mondo vuoto",

  "home.templates.heading": "Mondi pronti",
  "home.templates.explore": "esplora",
  "home.templates.tagCanon": "canone già scritto",
  "home.templates.tagEras": "epoche",
  "home.templates.tagCharacters": "personaggi",
  "home.templates.play": "Gioca",
};

export const homeEs = {
  "home.hero.title": "Vive la historia, siente la emoción",
  "home.hero.sub":
    "Un mundo que recuerda lo que hiciste, un narrador que nunca contradice el canon. El canon y la campaña se quedan en tu ordenador.",

  "home.state.loading": "cargando…",
  "home.state.empty":
    "Todavía no hay ninguna historia. Empieza por un mundo ya escrito, o abre uno vacío y decide mientras juegas.",

  "home.stories.heading": "🔥 Tus historias",
  "home.stories.allChats": "todas las conversaciones",
  "home.stories.previous": "Historia anterior",
  "home.stories.next": "Historia siguiente",
  "home.stories.goto": "Ir a {{name}}",
  "home.stories.continue": "▶ Continuar",
  "home.stories.world": "Mundo",
  "home.stories.noDescription": "Una historia recién empezada.",

  "home.worlds.characters": "personajes",
  "home.worlds.power": "potencia",

  "home.action.loadCorpus": "cargar los mundos listos",
  "home.action.loadingCorpus": "cargando…",
  "home.action.emptyWorld": "mundo vacío",

  "home.templates.heading": "Mundos listos",
  "home.templates.explore": "explorar",
  "home.templates.tagCanon": "canón ya escrito",
  "home.templates.tagEras": "épocas",
  "home.templates.tagCharacters": "personajes",
  "home.templates.play": "Jugar",
};

export const homeFr = {
  "home.hero.title": "Vivez l'histoire, ressentez l'émotion",
  "home.hero.sub":
    "Un monde qui se souvient de ce que vous avez fait, un narrateur qui ne contredit jamais le canon. Le canon et la campagne restent sur votre ordinateur.",

  "home.state.loading": "chargement…",
  "home.state.empty":
    "Il n'y a pas encore d'histoire. Commencez par un monde déjà écrit, ou ouvrez-en un vide et décidez en jouant.",

  "home.stories.heading": "🔥 Vos histoires",
  "home.stories.allChats": "toutes les discussions",
  "home.stories.previous": "Histoire précédente",
  "home.stories.next": "Histoire suivante",
  "home.stories.goto": "Aller à {{name}}",
  "home.stories.continue": "▶ Continuer",
  "home.stories.world": "Monde",
  "home.stories.noDescription": "Une histoire à peine commencée.",

  "home.worlds.characters": "personnages",
  "home.worlds.power": "puissance",

  "home.action.loadCorpus": "charger les mondes prêts",
  "home.action.loadingCorpus": "chargement…",
  "home.action.emptyWorld": "monde vide",

  "home.templates.heading": "Mondes prêts",
  "home.templates.explore": "explorer",
  "home.templates.tagCanon": "canon déjà écrit",
  "home.templates.tagEras": "ères",
  "home.templates.tagCharacters": "personnages",
  "home.templates.play": "Jouer",
};

export const homeDe = {
  "home.hero.title": "Erlebe die Geschichte, spüre die Emotion",
  "home.hero.sub":
    "Eine Welt, die sich daran erinnert, was du getan hast, ein Erzähler, der dem Kanon nie widerspricht. Kanon und Kampagne bleiben auf deinem Rechner.",

  "home.state.loading": "lade…",
  "home.state.empty":
    "Es gibt noch keine Geschichte. Fang mit einer Welt an, die schon geschrieben ist, oder öffne eine leere und entscheide beim Spielen.",

  "home.stories.heading": "🔥 Deine Geschichten",
  "home.stories.allChats": "alle Chats",
  "home.stories.previous": "Vorherige Geschichte",
  "home.stories.next": "Nächste Geschichte",
  "home.stories.goto": "Zu {{name}} gehen",
  "home.stories.continue": "▶ Weiter",
  "home.stories.world": "Welt",
  "home.stories.noDescription": "Eine gerade erst begonnene Geschichte.",

  "home.worlds.characters": "Figuren",
  "home.worlds.power": "Stärke",

  "home.action.loadCorpus": "die fertigen Welten laden",
  "home.action.loadingCorpus": "lade…",
  "home.action.emptyWorld": "leere Welt",

  "home.templates.heading": "Fertige Welten",
  "home.templates.explore": "entdecken",
  "home.templates.tagCanon": "Kanon bereits geschrieben",
  "home.templates.tagEras": "Epochen",
  "home.templates.tagCharacters": "Figuren",
  "home.templates.play": "Spielen",
};
