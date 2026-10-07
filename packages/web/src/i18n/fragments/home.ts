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

  /*
   * The first-run panel.
   *
   * Each step says what it is for and not just what it is. "Connect a narrator"
   * is an instruction that leaves the reader to work out why; "the narrator is what
   * writes the campaign" is the reason to do it, and it is the reason a new user
   * needs before the instruction means anything.
   */
  "onboarding.title": "To get going",
  "onboarding.progress": "{{done}} of {{total}} ready",
  "onboarding.intro":
    "Three things before the first campaign can be played. Each step explains what it is for.",
  "onboarding.step.world.title": "Create a campaign",
  "onboarding.step.world.body":
    "A campaign is the setting plus the canon the narrator uses. Start from a ready world, or from an empty one.",
  "onboarding.step.world.cta": "Load the canon",
  "onboarding.step.narrator.title": "Connect a narrator",
  "onboarding.step.narrator.body":
    "The narrator is what writes the campaign. It runs on your machine through opencode, and no text leaves your computer.",
  "onboarding.step.narrator.cta": "Check it",
  "onboarding.step.model.title": "Choose a narrator model",
  "onboarding.step.model.body":
    "Which model writes is your decision, and it decides both the cost and how long the context can be. A free model is the right start.",
  "onboarding.step.model.cta": "Choose",
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

  "onboarding.title": "Per cominciare",
  "onboarding.progress": "{{done}} di {{total}} pronti",
  "onboarding.intro":
    "Tre cose servono prima di poter giocare la prima campagna. Ogni passo spiega a cosa serve.",
  "onboarding.step.world.title": "Crea una campagna",
  "onboarding.step.world.body":
    "Una campagna è l'ambientazione più il canon che il narratore usa. Parti da un mondo pronto, o da uno vuoto.",
  "onboarding.step.world.cta": "Carica il canon",
  "onboarding.step.narrator.title": "Collega un narratore",
  "onboarding.step.narrator.body":
    "Il narratore è ciò che scrive la campagna. Gira sulla tua macchina tramite opencode, e nessun testo esce dal tuo computer.",
  "onboarding.step.narrator.cta": "Verificalo",
  "onboarding.step.model.title": "Scegli il modello del narratore",
  "onboarding.step.model.body":
    "Quale modello scriva è una decisione tua, e decide sia il costo sia quanto contesto può tenere. Un modello gratuito è un buon inizio.",
  "onboarding.step.model.cta": "Scegli",
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

  "onboarding.title": "Para empezar",
  "onboarding.progress": "{{done}} de {{total}} listos",
  "onboarding.intro":
    "Hacen falta tres cosas antes de poder jugar la primera campaña. Cada paso explica para qué sirve.",
  "onboarding.step.world.title": "Crea una campaña",
  "onboarding.step.world.body":
    "Una campaña es el escenario más el canon que usa el narrador. Empieza por un mundo listo, o por uno vacío.",
  "onboarding.step.world.cta": "Cargar el canon",
  "onboarding.step.narrator.title": "Conecta un narrador",
  "onboarding.step.narrator.body":
    "El narrador es lo que escribe la campaña. Funciona en tu máquina mediante opencode, y ningún texto sale de tu ordenador.",
  "onboarding.step.narrator.cta": "Comprobarlo",
  "onboarding.step.model.title": "Elige el modelo del narrador",
  "onboarding.step.model.body":
    "Qué modelo escribe es tu decisión, y decide tanto el coste como cuánta contexto puede guardar. Un modelo gratuito es un buen comienzo.",
  "onboarding.step.model.cta": "Elegir",
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

  "onboarding.title": "Pour démarrer",
  "onboarding.progress": "{{done}} sur {{total}} prêts",
  "onboarding.intro":
    "Trois choses sont nécessaires avant de pouvoir jouer la première campagne. Chaque étape explique à quoi elle sert.",
  "onboarding.step.world.title": "Créez une campagne",
  "onboarding.step.world.body":
    "Une campagne est le décor plus le canon que le narrateur utilise. Partez d'un monde prêt, ou d'un monde vide.",
  "onboarding.step.world.cta": "Charger le canon",
  "onboarding.step.narrator.title": "Connectez un narrateur",
  "onboarding.step.narrator.body":
    "Le narrateur est ce qui écrit la campagne. Il tourne sur votre machine via opencode, et aucun texte ne quitte votre ordinateur.",
  "onboarding.step.narrator.cta": "Vérifier",
  "onboarding.step.model.title": "Choisissez le modèle du narrateur",
  "onboarding.step.model.body":
    "Le modèle qui écrit est votre décision, et il détermine à la fois le coût et la quantité de contexte possible. Un modèle gratuit est un bon début.",
  "onboarding.step.model.cta": "Choisir",
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

  "onboarding.title": "Für den Einstieg",
  "onboarding.progress": "{{done}} von {{total}} bereit",
  "onboarding.intro":
    "Drei Dinge fehlen, bevor die erste Kampagne gespielt werden kann. Jeder Schritt erklärt, wozu er da ist.",
  "onboarding.step.world.title": "Kampagne erstellen",
  "onboarding.step.world.body":
    "Eine Kampagne ist die Umgebung plus den Kanon, den der Erzähler nutzt. Beginne mit einer fertigen Welt oder mit einer leeren.",
  "onboarding.step.world.cta": "Kanon laden",
  "onboarding.step.narrator.title": "Erzähler verbinden",
  "onboarding.step.narrator.body":
    "Der Erzähler schreibt die Kampagne. Er läuft über opencode auf deinem Rechner, und kein Text verlässt deinen Computer.",
  "onboarding.step.narrator.cta": "Prüfen",
  "onboarding.step.model.title": "Erzählermodell wählen",
  "onboarding.step.model.body":
    "Welches Modell schreibt, entscheidest du: es bestimmt die Kosten und wie viel Kontext möglich ist. Ein kostenloses Modell ist ein guter Anfang.",
  "onboarding.step.model.cta": "Wählen",
};
