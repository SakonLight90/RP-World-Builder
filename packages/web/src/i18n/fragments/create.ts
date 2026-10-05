/**
 * UI strings for the `create` area: the screen that creates a world, in the same
 * order as the screen itself — requirements, narrator, world.
 *
 * Split by area so two people can work on different screens without touching the
 * same file. Every area exports the same five languages, because a key that
 * exists only in English is a key nobody notices is missing.
 *
 * What the server sends is not here: a model name, a provider, a toolchain
 * message and a privacy note are the narrator's and the machine's words, not the
 * interface's, and they arrive already written.
 */
export const createEn = {
  "create.page.loading": "loading…",
  "create.page.title": "Create a world",
  "create.page.tagline": "One world, one narrator, and everything that happens in between.",
  "create.defaultName": "My campaign",

  "create.step.requirements": "1 · Requirements",
  "create.step.narrator": "2 · The narrator",
  "create.step.world": "3 · The world",

  "create.health.checking": "checking…",
  "create.health.freeModels": "{{count}} free models",
  "create.health.cannotNarrate": "I can't narrate for you yet.",

  "create.toolchain.heading": "Your processor can't handle Next's native compiler.",
  "create.toolchain.note":
    "It's already solved: the interface uses the WebAssembly compiler, which runs everywhere. Only needed if something breaks:",

  "create.model.label": "model",
  "create.model.option": "{{name}} · {{context}}k context",
  "create.model.note": "Free, and it doesn't keep what you write.",

  "create.reasoning.label": "reasoning power",
  "create.reasoning.note":
    "More power isn't more remembered story: it's time spent and context wasted. The default is the right choice.",

  "create.locale.label": "story language",
  "create.locale.note": "The language the narrator will write in, from the first turn.",

  "create.restricted.summary": "{{count}} models that keep your data",
  "create.restricted.use": "use this one",

  "create.name.label": "what you call it",
  "create.name.placeholder": "Left empty: {{name}}",

  "create.template.label": "where you start from",
  "create.template.empty": "empty world, you define it",
  "create.template.note":
    "A ready-made world arrives with the canon already inside: characters, places, eras and the world's rules already written.",

  "create.action.start": "begin",
  "create.action.creating": "creating…",
  "create.action.cancel": "cancel",
};

export const createIt = {
  "create.page.loading": "carico…",
  "create.page.title": "Crea un mondo",
  "create.page.tagline": "Un mondo, un narratore, e tutto quello che succede in mezzo.",
  "create.defaultName": "La mia campagna",

  "create.step.requirements": "1 · Requisiti",
  "create.step.narrator": "2 · Il narratore",
  "create.step.world": "3 · Il mondo",

  "create.health.checking": "controllo…",
  "create.health.freeModels": "{{count}} modelli gratuiti",
  "create.health.cannotNarrate": "Non posso ancora narrarti.",

  "create.toolchain.heading": "Il tuo processore non regge il compilatore nativo di Next.",
  "create.toolchain.note":
    "È già risolto: l'interfaccia usa il compilatore in WebAssembly, che gira ovunque. Serve solo se qualcosa si rompe:",

  "create.model.label": "modello",
  "create.model.option": "{{name}} · {{context}}k contesto",
  "create.model.note": "Gratuito e non conserva quello che scrivi.",

  "create.reasoning.label": "potenza di ragionamento",
  "create.reasoning.note":
    "Più potenza non è più storia ricordata: è tempo speso e contesto sprecato. Il default è la scelta giusta.",

  "create.locale.label": "lingua della storia",
  "create.locale.note": "La lingua in cui il narratore scriverà, fin dal primo turno.",

  "create.restricted.summary": "{{count}} modelli che conservano i tuoi dati",
  "create.restricted.use": "usa questo",

  "create.name.label": "come lo chiami",
  "create.name.placeholder": "Lasciato vuoto: {{name}}",

  "create.template.label": "da dove si parte",
  "create.template.empty": "mondo vuoto, lo definisci tu",
  "create.template.note":
    "Un mondo pronto arriva con il canone già dentro: personaggi, luoghi, epoche e le regole del mondo già scritte.",

  "create.action.start": "inizia",
  "create.action.creating": "creo…",
  "create.action.cancel": "annulla",
};

export const createEs = {
  "create.page.loading": "cargando…",
  "create.page.title": "Crea un mundo",
  "create.page.tagline": "Un mundo, un narrador y todo lo que pasa en medio.",
  "create.defaultName": "Mi campaña",

  "create.step.requirements": "1 · Requisitos",
  "create.step.narrator": "2 · El narrador",
  "create.step.world": "3 · El mundo",

  "create.health.checking": "comprobando…",
  "create.health.freeModels": "{{count}} modelos gratuitos",
  "create.health.cannotNarrate": "Todavía no puedo narrarte.",

  "create.toolchain.heading": "Tu procesador no aguanta el compilador nativo de Next.",
  "create.toolchain.note":
    "Ya está resuelto: la interfaz usa el compilador en WebAssembly, que funciona en todas partes. Solo hace falta si algo se rompe:",

  "create.model.label": "modelo",
  "create.model.option": "{{name}} · {{context}}k de contexto",
  "create.model.note": "Gratuito y no guarda lo que escribes.",

  "create.reasoning.label": "potencia de razonamiento",
  "create.reasoning.note":
    "Más potencia no es más historia recordada: es tiempo gastado y contexto desperdiciado. El valor por defecto es la elección correcta.",

  "create.locale.label": "lengua de la historia",
  "create.locale.note": "La lengua en que el narrador escribirá, desde el primer turno.",

  "create.restricted.summary": "{{count}} modelos que guardan tus datos",
  "create.restricted.use": "usar este",

  "create.name.label": "cómo lo llamas",
  "create.name.placeholder": "Si se deja vacío: {{name}}",

  "create.template.label": "de dónde se parte",
  "create.template.empty": "mundo vacío, lo defines tú",
  "create.template.note":
    "Un mundo listo llega con el canon ya dentro: personajes, lugares, eras y las reglas del mundo ya escritas.",

  "create.action.start": "empezar",
  "create.action.creating": "creo…",
  "create.action.cancel": "cancelar",
};

export const createFr = {
  "create.page.loading": "chargement…",
  "create.page.title": "Créer un monde",
  "create.page.tagline": "Un monde, un narrateur, et tout ce qui se passe entre les deux.",
  "create.defaultName": "Ma campagne",

  "create.step.requirements": "1 · Prérequis",
  "create.step.narrator": "2 · Le narrateur",
  "create.step.world": "3 · Le monde",

  "create.health.checking": "vérification…",
  "create.health.freeModels": "{{count}} modèles gratuits",
  "create.health.cannotNarrate": "Je ne peux pas encore vous narrer.",

  "create.toolchain.heading": "Votre processeur ne supporte pas le compilateur natif de Next.",
  "create.toolchain.note":
    "C'est déjà réglé : l'interface utilise le compilateur WebAssembly, qui tourne partout. Utile seulement si quelque chose casse :",

  "create.model.label": "modèle",
  "create.model.option": "{{name}} · {{context}}k de contexte",
  "create.model.note": "Gratuit, et il ne garde pas ce que vous écrivez.",

  "create.reasoning.label": "puissance de raisonnement",
  "create.reasoning.note":
    "Plus de puissance ne fait pas plus d'histoire mémorisée : c'est du temps dépensé et du contexte gaspillé. Le choix par défaut est le bon.",

  "create.locale.label": "langue du récit",
  "create.locale.note": "La langue dans laquelle le narrateur écrira, dès le premier tour.",

  "create.restricted.summary": "{{count}} modèles qui conservent vos données",
  "create.restricted.use": "utiliser celui-ci",

  "create.name.label": "comment vous l'appelez",
  "create.name.placeholder": "Laissé vide : {{name}}",

  "create.template.label": "d'où l'on part",
  "create.template.empty": "monde vide, à vous de le définir",
  "create.template.note":
    "Un monde prêt arrive avec le canon déjà dedans : personnages, lieux, ères et les règles du monde déjà écrites.",

  "create.action.start": "commencer",
  "create.action.creating": "je crée…",
  "create.action.cancel": "annuler",
};

export const createDe = {
  "create.page.loading": "lade…",
  "create.page.title": "Eine Welt erstellen",
  "create.page.tagline": "Eine Welt, ein Erzähler und alles, was dazwischen passiert.",
  "create.defaultName": "Meine Kampagne",

  "create.step.requirements": "1 · Voraussetzungen",
  "create.step.narrator": "2 · Der Erzähler",
  "create.step.world": "3 · Die Welt",

  "create.health.checking": "prüfe…",
  "create.health.freeModels": "{{count}} kostenlose Modelle",
  "create.health.cannotNarrate": "Ich kann dir noch nicht erzählen.",

  "create.toolchain.heading": "Dein Prozessor schafft den nativen Compiler von Next nicht.",
  "create.toolchain.note":
    "Das ist bereits gelöst: Die Oberfläche nutzt den WebAssembly-Compiler, der überall läuft. Nur nötig, wenn etwas kaputtgeht:",

  "create.model.label": "Modell",
  "create.model.option": "{{name}} · {{context}}k Kontext",
  "create.model.note": "Kostenlos und behält nicht, was du schreibst.",

  "create.reasoning.label": "Denkleistung",
  "create.reasoning.note":
    "Mehr Denkleistung ist nicht mehr erinnerte Geschichte: Sie ist verbrannte Zeit und verschenkter Kontext. Die Voreinstellung ist die richtige Wahl.",

  "create.locale.label": "Sprache der Geschichte",
  "create.locale.note": "Die Sprache, in der der Erzähler schreiben wird, vom ersten Zug an.",

  "create.restricted.summary": "{{count}} Modelle, die deine Daten behalten",
  "create.restricted.use": "dieses nehmen",

  "create.name.label": "wie es heißt",
  "create.name.placeholder": "Leer gelassen: {{name}}",

  "create.template.label": "wovon du startest",
  "create.template.empty": "leere Welt, du bestimmst sie",
  "create.template.note":
    "Eine fertige Welt kommt mit dem Kanon schon gefüllt: Figuren, Orte, Epochen und die Weltregeln bereits geschrieben.",

  "create.action.start": "loslegen",
  "create.action.creating": "ich erstelle…",
  "create.action.cancel": "abbrechen",
};
