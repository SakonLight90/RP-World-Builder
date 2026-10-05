/**
 * UI strings for the `explore` area: the ready-made worlds and the search over
 * the canon.
 *
 * Split by area so two people can work on different screens without touching
 * the same file. Every area exports the same five languages, because a key that
 * exists only in English is a key nobody notices is missing.
 *
 * The objects are plain literals on purpose: annotating them would widen the key
 * set back to `string` and the four translations would no longer be checked
 * against English.
 *
 * Place names inside the search placeholder stay as they are: Morganthown is
 * the place's name in every language, and the placeholder is an example of what
 * to type, not something the reader has to translate before typing it.
 */
export const exploreEn = {
  "explore.page.title": "Explore",
  "explore.page.sub": "Everything that's already on your machine. Nothing to download.",

  "explore.worlds.heading": "Ready worlds",
  "explore.worlds.empty":
    "No pre-made world is loaded. You can create one yourself, or load the corpus from the home.",

  "explore.action.backHome": "back to the home",

  "explore.canon.heading": "Search the canon",
  "explore.canon.placeholder": "Vera, Morganthown, radiation…",
  "explore.canon.noResults": "No canon entry matches.",
};

export const exploreIt = {
  "explore.page.title": "Esplora",
  "explore.page.sub": "Tutto quello che è già sulla tua macchina. Niente da scaricare.",

  "explore.worlds.heading": "Mondi pronti",
  "explore.worlds.empty":
    "Nessun modello pregenerato caricato. Puoi crearne uno tuo, oppure caricare il corpus dalla home.",

  "explore.action.backHome": "torna alla home",

  "explore.canon.heading": "Cerca nel canone",
  "explore.canon.placeholder": "Vera, Morganthown, radiazioni…",
  "explore.canon.noResults": "Nessuna voce canonica corrisponde.",
};

export const exploreEs = {
  "explore.page.title": "Explorar",
  "explore.page.sub": "Todo lo que ya está en tu ordenador. Nada que descargar.",

  "explore.worlds.heading": "Mundos listos",
  "explore.worlds.empty":
    "No hay ningún mundo prefabricado cargado. Puedes crear uno tú, o cargar el corpus desde el inicio.",

  "explore.action.backHome": "volver al inicio",

  "explore.canon.heading": "Buscar en el canon",
  "explore.canon.placeholder": "Vera, Morganthown, radiación…",
  "explore.canon.noResults": "Ninguna entrada del canon coincide.",
};

export const exploreFr = {
  "explore.page.title": "Explorer",
  "explore.page.sub": "Tout ce qui est déjà sur votre machine. Rien à télécharger.",

  "explore.worlds.heading": "Mondes prêts",
  "explore.worlds.empty":
    "Aucun monde pré-généré n'est chargé. Vous pouvez en créer un vous-même, ou charger le corpus depuis l'accueil.",

  "explore.action.backHome": "retour à l'accueil",

  "explore.canon.heading": "Chercher dans le canon",
  "explore.canon.placeholder": "Vera, Morganthown, radiation…",
  "explore.canon.noResults": "Aucune fiche canonique ne correspond.",
};

export const exploreDe = {
  "explore.page.title": "Entdecken",
  "explore.page.sub": "Alles, was schon auf deinem Rechner ist. Nichts herunterzuladen.",

  "explore.worlds.heading": "Fertige Welten",
  "explore.worlds.empty":
    "Keine vorgefertigte Welt geladen. Du kannst selbst eine anlegen oder den Korpus von der Startseite laden.",

  "explore.action.backHome": "zurück zur Startseite",

  "explore.canon.heading": "Im Kanon suchen",
  "explore.canon.placeholder": "Vera, Morganthown, Strahlung…",
  "explore.canon.noResults": "Kein Kanoneintrag passt.",
};
