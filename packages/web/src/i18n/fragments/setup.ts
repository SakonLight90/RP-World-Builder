/**
 * UI strings for the `setup` area: the settings screen, plus the narrator's three
 * pickers — model, reasoning power, story language — which the settings screen,
 * the world notebook and the chat column all share.
 *
 * The pickers live under this area and not under `create` or `world` because none
 * of those owns them: they are the settings controls, in every place settings are
 * edited, and a screen-only catalog would have put the same sentence in three.
 *
 * Split by area so two people can work on different screens without touching the
 * same file. Every area exports the same five languages, because a key that
 * exists only in English is a key nobody notices is missing.
 *
 * What the machine says is not here: a model name, a binary path, a privacy note
 * and a toolchain consequence arrive already written.
 */
export const setupEn = {
  "setup.page.title": "Settings",
  "setup.page.intro":
    "No accounts, no cloud, no ads, no telemetry. The canon and the campaign live on your computer. The narrator is a model and answers over the network: it is the model talking to its own service, not this application collecting data about you.",

  "setup.checking": "checking…",
  "setup.saved": "saved",

  "setup.narrator.heading": "The narrator",
  "setup.health.unreachable": "not reachable",
  "setup.health.binaryMissing": "binary not found",

  "setup.models.freeHeading": "Free models with no retention",
  "setup.models.colModel": "model",
  "setup.models.colContext": "context",
  "setup.models.colPrivacy": "privacy",
  "setup.models.defaultBadge": "default",
  "setup.models.keepHeading": "They keep your data",

  "setup.preferred.heading": "Your default models",
  "setup.preferred.narrator": "preferred narrator",
  "setup.preferred.small": "preferred small model",
  "setup.preferred.none": "no preference",
  "setup.preferred.note":
    "The preferred one becomes the catalog default and the model of new worlds. It applies immediately, without a restart.",
  "setup.action.save": "save the preferences",
  "setup.action.saving": "saving…",

  "setup.interface.heading": "The interface",
  "setup.interface.languageLabel": "Interface language",
  "setup.interface.languageNote":
    "The language of the buttons and pages, saved on this machine. It is not the language the narrator writes in: each campaign has its own.",
  "setup.interface.compilerNative": "native compiler",
  "setup.interface.compilerWasm": "WASM compiler",
  "setup.interface.reinstall": "If it has to be installed again:",

  "setup.data.heading": "Your data",
  "setup.data.note":
    "Everything you created is in a single folder. Copy it for a backup, delete the folder to leave no trace: there is no copy anywhere else.",

  "setup.worlds.heading": "Worlds",
  "setup.worlds.empty": "No world.",
  "setup.worlds.remove": "delete",

  "setup.picker.model.label": "narrator model",
  "setup.picker.model.note":
    "You change the narrator here. The chapter checks keep using the small model, {{smallModel}}: it doesn't change with this.",

  "setup.picker.reasoning.label": "reasoning power",
  "setup.picker.reasoning.default":
    "The right choice. The narrator remembers the campaign without spending more time.",
  "setup.picker.reasoning.low":
    "The fastest. It writes well, it remembers less of a long conversation.",
  "setup.picker.reasoning.medium":
    "It remembers better at the price of a few more seconds per answer.",
  "setup.picker.reasoning.high":
    "The most careful. It costs time and context: for the scenes that matter.",

  "setup.picker.locale.label": "story language",
  "setup.picker.locale.note":
    "The language the narrator writes the story in, not the one of the buttons.",
};

export const setupIt = {
  "setup.page.title": "Impostazioni",
  "setup.page.intro":
    "Niente account, niente cloud, niente pubblicità, niente telemetria. Il canone e la campagna stanno sul tuo computer. Il narratore è un modello e risponde via rete: è il modello a parlare con il suo servizio, non questa applicazione a raccogliere dati su di te.",

  "setup.checking": "controllo…",
  "setup.saved": "salvato",

  "setup.narrator.heading": "Il narratore",
  "setup.health.unreachable": "non raggiungibile",
  "setup.health.binaryMissing": "binario non trovato",

  "setup.models.freeHeading": "Modelli gratuiti e senza conservazione",
  "setup.models.colModel": "modello",
  "setup.models.colContext": "contesto",
  "setup.models.colPrivacy": "privacy",
  "setup.models.defaultBadge": "predefinito",
  "setup.models.keepHeading": "Conservano i tuoi dati",

  "setup.preferred.heading": "I tuoi modelli predefiniti",
  "setup.preferred.narrator": "narratore preferito",
  "setup.preferred.small": "modello piccolo preferito",
  "setup.preferred.none": "nessuna preferenza",
  "setup.preferred.note":
    "Il preferito diventa il default del catalogo e il modello dei mondi nuovi. Vale subito, senza riavvio.",
  "setup.action.save": "salva le preferenze",
  "setup.action.saving": "salvo…",

  "setup.interface.heading": "L'interfaccia",
  "setup.interface.languageLabel": "Lingua dell'interfaccia",
  "setup.interface.languageNote":
    "La lingua dei pulsanti e delle pagine, salvata su questa macchina. Non è la lingua in cui scrive il narratore: ogni campagna ha la sua.",
  "setup.interface.compilerNative": "compilatore nativo",
  "setup.interface.compilerWasm": "compilatore WASM",
  "setup.interface.reinstall": "Se serve reinstallarlo:",

  "setup.data.heading": "I tuoi dati",
  "setup.data.note":
    "Tutto quello che hai creato è in una cartella sola. Copiala per un backup, cancella la cartella per non lasciare traccia: non esiste copia da qualche altra parte.",

  "setup.worlds.heading": "Mondi",
  "setup.worlds.empty": "Nessun mondo.",
  "setup.worlds.remove": "elimina",

  "setup.picker.model.label": "modello del narratore",
  "setup.picker.model.note":
    "Qui cambi il narratore. Le verifiche dei capitoli continuano a usare il modello piccolo, {{smallModel}}: non cambia con questo.",

  "setup.picker.reasoning.label": "potenza di ragionamento",
  "setup.picker.reasoning.default":
    "La scelta giusta. Il narratore ricorda la campagna senza spendere tempo in più.",
  "setup.picker.reasoning.low":
    "Il più rapido. Scrive bene, ricorda meno di una conversazione lunga.",
  "setup.picker.reasoning.medium":
    "Ricorda meglio a prezzo di qualche secondo in più per risposta.",
  "setup.picker.reasoning.high":
    "Il più attento. Costa tempo e contesto: per le scene che contano.",

  "setup.picker.locale.label": "lingua della storia",
  "setup.picker.locale.note":
    "La lingua in cui il narratore scrive la storia, non quella dei pulsanti.",
};

export const setupEs = {
  "setup.page.title": "Ajustes",
  "setup.page.intro":
    "Sin cuentas, sin nube, sin anuncios, sin telemetría. El canon y la campaña están en tu ordenador. El narrador es un modelo y responde por red: es el modelo quien habla con su servicio, no esta aplicación recogiendo datos sobre ti.",

  "setup.checking": "comprobando…",
  "setup.saved": "guardado",

  "setup.narrator.heading": "El narrador",
  "setup.health.unreachable": "no accesible",
  "setup.health.binaryMissing": "binario no encontrado",

  "setup.models.freeHeading": "Modelos gratuitos y sin conservación",
  "setup.models.colModel": "modelo",
  "setup.models.colContext": "contexto",
  "setup.models.colPrivacy": "privacidad",
  "setup.models.defaultBadge": "predeterminado",
  "setup.models.keepHeading": "Conservan tus datos",

  "setup.preferred.heading": "Tus modelos predeterminados",
  "setup.preferred.narrator": "narrador preferido",
  "setup.preferred.small": "modelo pequeño preferido",
  "setup.preferred.none": "ninguna preferencia",
  "setup.preferred.note":
    "El preferido pasa a ser el valor por defecto del catálogo y el modelo de los mundos nuevos. Vale enseguida, sin reiniciar.",
  "setup.action.save": "guardar las preferencias",
  "setup.action.saving": "guardando…",

  "setup.interface.heading": "La interfaz",
  "setup.interface.languageLabel": "Idioma de la interfaz",
  "setup.interface.languageNote":
    "El idioma de los botones y las páginas, guardado en este equipo. No es el idioma en el que escribe el narrador: cada campaña tiene el suyo.",
  "setup.interface.compilerNative": "compilador nativo",
  "setup.interface.compilerWasm": "compilador WASM",
  "setup.interface.reinstall": "Si hace falta reinstalarlo:",

  "setup.data.heading": "Tus datos",
  "setup.data.note":
    "Todo lo que has creado está en una sola carpeta. Cópiala para una copia de seguridad, borra la carpeta para no dejar rastro: no hay ninguna copia en otro sitio.",

  "setup.worlds.heading": "Mundos",
  "setup.worlds.empty": "Ningún mundo.",
  "setup.worlds.remove": "eliminar",

  "setup.picker.model.label": "modelo del narrador",
  "setup.picker.model.note":
    "Aquí cambias al narrador. Las verificaciones de los capítulos siguen usando el modelo pequeño, {{smallModel}}: no cambia con esto.",

  "setup.picker.reasoning.label": "potencia de razonamiento",
  "setup.picker.reasoning.default":
    "La elección correcta. El narrador recuerda la campaña sin gastar más tiempo.",
  "setup.picker.reasoning.low":
    "El más rápido. Escribe bien, recuerda menos de una conversación larga.",
  "setup.picker.reasoning.medium": "Recuerda mejor a cambio de unos segundos más por respuesta.",
  "setup.picker.reasoning.high":
    "El más atento. Cuesta tiempo y contexto: para las escenas que importan.",

  "setup.picker.locale.label": "lengua de la historia",
  "setup.picker.locale.note":
    "La lengua en que el narrador escribe la historia, no la de los botones.",
};

export const setupFr = {
  "setup.page.title": "Réglages",
  "setup.page.intro":
    "Pas de compte, pas de cloud, pas de publicité, pas de télémétrie. Le canon et la campagne sont sur votre ordinateur. Le narrateur est un modèle et répond par le réseau : c'est le modèle qui parle à son service, pas cette application à collecter des données sur vous.",

  "setup.checking": "vérification…",
  "setup.saved": "enregistré",

  "setup.narrator.heading": "Le narrateur",
  "setup.health.unreachable": "injoignable",
  "setup.health.binaryMissing": "binaire introuvable",

  "setup.models.freeHeading": "Modèles gratuits et sans conservation",
  "setup.models.colModel": "modèle",
  "setup.models.colContext": "contexte",
  "setup.models.colPrivacy": "confidentialité",
  "setup.models.defaultBadge": "par défaut",
  "setup.models.keepHeading": "Conservent vos données",

  "setup.preferred.heading": "Vos modèles par défaut",
  "setup.preferred.narrator": "narrateur préféré",
  "setup.preferred.small": "petit modèle préféré",
  "setup.preferred.none": "aucune préférence",
  "setup.preferred.note":
    "Le modèle préféré devient celui du catalogue par défaut et celui des nouveaux mondes. Il s'applique tout de suite, sans redémarrage.",
  "setup.action.save": "enregistrer les préférences",
  "setup.action.saving": "j'enregistre…",

  "setup.interface.heading": "L'interface",
  "setup.interface.languageLabel": "Langue de l'interface",
  "setup.interface.languageNote":
    "La langue des boutons et des pages, enregistrée sur cette machine. Ce n'est pas la langue du narrateur : chaque campagne a la sienne.",
  "setup.interface.compilerNative": "compilateur natif",
  "setup.interface.compilerWasm": "compilateur WASM",
  "setup.interface.reinstall": "S'il faut l'installer à nouveau :",

  "setup.data.heading": "Vos données",
  "setup.data.note":
    "Tout ce que vous avez créé tient dans un seul dossier. Copiez-le pour une sauvegarde, supprimez le dossier pour ne rien laisser : il n'existe aucune copie ailleurs.",

  "setup.worlds.heading": "Mondes",
  "setup.worlds.empty": "Aucun monde.",
  "setup.worlds.remove": "supprimer",

  "setup.picker.model.label": "modèle du narrateur",
  "setup.picker.model.note":
    "C'est ici qu'on change de narrateur. Les vérifications des chapitres continuent d'utiliser le petit modèle, {{smallModel}} : il ne change pas avec ceci.",

  "setup.picker.reasoning.label": "puissance de raisonnement",
  "setup.picker.reasoning.default":
    "Le bon choix. Le narrateur se souvient de la campagne sans y passer plus de temps.",
  "setup.picker.reasoning.low":
    "Le plus rapide. Il écrit bien, il retient moins d'une longue conversation.",
  "setup.picker.reasoning.medium":
    "Il retient mieux, au prix de quelques secondes de plus par réponse.",
  "setup.picker.reasoning.high":
    "Le plus attentif. Il coûte du temps et du contexte : pour les scènes qui comptent.",

  "setup.picker.locale.label": "langue du récit",
  "setup.picker.locale.note":
    "La langue dans laquelle le narrateur écrit le récit, pas celle des boutons.",
};

export const setupDe = {
  "setup.page.title": "Einstellungen",
  "setup.page.intro":
    "Keine Konten, keine Cloud, keine Werbung, kein Tracking. Kanon und Kampagne liegen auf deinem Rechner. Der Erzähler ist ein Modell und antwortet über das Netz: Es ist das Modell, das mit seinem eigenen Dienst spricht, nicht diese Anwendung, die Daten über dich sammelt.",

  "setup.checking": "prüfe…",
  "setup.saved": "gespeichert",

  "setup.narrator.heading": "Der Erzähler",
  "setup.health.unreachable": "nicht erreichbar",
  "setup.health.binaryMissing": "Programmdatei nicht gefunden",

  "setup.models.freeHeading": "Kostenlose Modelle ohne Speicherung",
  "setup.models.colModel": "Modell",
  "setup.models.colContext": "Kontext",
  "setup.models.colPrivacy": "Datenschutz",
  "setup.models.defaultBadge": "Vorgabe",
  "setup.models.keepHeading": "Sie behalten deine Daten",

  "setup.preferred.heading": "Deine Standardmodelle",
  "setup.preferred.narrator": "bevorzugter Erzähler",
  "setup.preferred.small": "bevorzugtes kleines Modell",
  "setup.preferred.none": "keine Vorgabe",
  "setup.preferred.note":
    "Das bevorzugte Modell wird die Vorgabe im Katalog und das Modell neuer Welten. Gilt sofort, ohne Neustart.",
  "setup.action.save": "Vorgaben speichern",
  "setup.action.saving": "speichere…",

  "setup.interface.heading": "Die Oberfläche",
  "setup.interface.languageLabel": "Sprache der Oberfläche",
  "setup.interface.languageNote":
    "Die Sprache der Schaltflächen und Seiten, auf diesem Rechner gespeichert. Sie ist nicht die Sprache, in der der Erzähler schreibt: jede Kampagne hat ihre eigene.",
  "setup.interface.compilerNative": "nativer Compiler",
  "setup.interface.compilerWasm": "WASM-Compiler",
  "setup.interface.reinstall": "Falls eine Neuinstallation nötig ist:",

  "setup.data.heading": "Deine Daten",
  "setup.data.note":
    "Alles, was du erstellt hast, liegt in einem einzigen Ordner. Kopiere ihn als Sicherung, lösche den Ordner, um nichts zu hinterlassen: eine Kopie gibt es nirgends sonst.",

  "setup.worlds.heading": "Welten",
  "setup.worlds.empty": "Keine Welt.",
  "setup.worlds.remove": "löschen",

  "setup.picker.model.label": "Modell des Erzählers",
  "setup.picker.model.note":
    "Hier wechselst du den Erzähler. Die Kapitelprüfungen nutzen weiter das kleine Modell, {{smallModel}}: Es ändert sich dadurch nicht.",

  "setup.picker.reasoning.label": "Denkleistung",
  "setup.picker.reasoning.default":
    "Die richtige Wahl. Der Erzähler erinnert sich an die Kampagne, ohne mehr Zeit zu verbrauchen.",
  "setup.picker.reasoning.low":
    "Das schnellste. Schreibt gut, erinnert sich an einem langen Gespräch an weniger.",
  "setup.picker.reasoning.medium":
    "Erinnert sich besser und kostet dafür ein paar Sekunden mehr pro Antwort.",
  "setup.picker.reasoning.high":
    "Das aufmerksamste. Kostet Zeit und Kontext: für die Szenen, auf die es ankommt.",

  "setup.picker.locale.label": "Sprache der Geschichte",
  "setup.picker.locale.note":
    "Die Sprache, in der der Erzähler die Geschichte schreibt, nicht die der Schaltflächen.",
};
