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

  "explore.canon.heading": "Search everything",
  "explore.canon.placeholder": "Vera, Morganthown, radiation.",
  "explore.canon.noResults": "Nothing matches, in the canon or in the cast.",
  "explore.search.canonGroup": "Canon",
  "explore.search.charactersGroup": "Characters",
  "explore.search.locationsGroup": "Places",
  "explore.search.campaignsGroup": "Campaigns",
  "explore.search.alsoKnownAs": "Also: {{names}}",
};

export const exploreIt = {
  "explore.page.title": "Esplora",
  "explore.page.sub": "Tutto quello che è già sulla tua macchina. Niente da scaricare.",

  "explore.worlds.heading": "Mondi pronti",
  "explore.worlds.empty":
    "Nessun modello pregenerato caricato. Puoi crearne uno tuo, oppure caricare il corpus dalla home.",

  "explore.action.backHome": "torna alla home",

  "explore.canon.heading": "Cerca ovunque",
  "explore.canon.placeholder": "Vera, Morganthown, radiazioni.",
  "explore.canon.noResults": "Nessuna corrispondenza, né nel canone né nel cast.",
  "explore.search.canonGroup": "Canon",
  "explore.search.charactersGroup": "Personaggi",
  "explore.search.locationsGroup": "Località",
  "explore.search.campaignsGroup": "Campagne",
  "explore.search.alsoKnownAs": "Anche: {{names}}",
};

export const exploreEs = {
  "explore.page.title": "Explorar",
  "explore.page.sub": "Todo lo que ya está en tu ordenador. Nada que descargar.",

  "explore.worlds.heading": "Mundos listos",
  "explore.worlds.empty":
    "No hay ningún mundo prefabricado cargado. Puedes crear uno tú, o cargar el corpus desde el inicio.",

  "explore.action.backHome": "volver al inicio",

  "explore.canon.heading": "Buscar en todo",
  "explore.canon.placeholder": "Vera, Morganthown, radiaci�n.",
  "explore.canon.noResults": "Nada coincide, ni en el canon ni en el reparto.",
  "explore.search.canonGroup": "Canon",
  "explore.search.charactersGroup": "Personajes",
  "explore.search.locationsGroup": "Lugares",
  "explore.search.campaignsGroup": "Campañas",
  "explore.search.alsoKnownAs": "También: {{names}}",
};

export const exploreFr = {
  "explore.page.title": "Explorer",
  "explore.page.sub": "Tout ce qui est déjà sur votre machine. Rien à télécharger.",

  "explore.worlds.heading": "Mondes prêts",
  "explore.worlds.empty":
    "Aucun monde pré-généré n'est chargé. Vous pouvez en créer un vous-même, ou charger le corpus depuis l'accueil.",

  "explore.action.backHome": "retour à l'accueil",

  "explore.canon.heading": "Chercher partout",
  "explore.canon.placeholder": "Vera, Morganthown, radiation.",
  "explore.canon.noResults": "Rien ne correspond, ni dans le canon ni dans la distribution.",
  "explore.search.canonGroup": "Canon",
  "explore.search.charactersGroup": "Personnages",
  "explore.search.locationsGroup": "Lieux",
  "explore.search.campaignsGroup": "Campagnes",
  "explore.search.alsoKnownAs": "Également : {{names}}",
};

export const exploreDe = {
  "explore.page.title": "Entdecken",
  "explore.page.sub": "Alles, was schon auf deinem Rechner ist. Nichts herunterzuladen.",

  "explore.worlds.heading": "Fertige Welten",
  "explore.worlds.empty":
    "Keine vorgefertigte Welt geladen. Du kannst selbst eine anlegen oder den Korpus von der Startseite laden.",

  "explore.action.backHome": "zurück zur Startseite",

  "explore.canon.heading": "Alles durchsuchen",
  "explore.canon.placeholder": "Vera, Morganthown, Strahlung.",
  "explore.canon.noResults": "Nichts passt, weder im Kanon noch in der Besetzung.",
  "explore.search.canonGroup": "Kanon",
  "explore.search.charactersGroup": "Figuren",
  "explore.search.locationsGroup": "Orte",
  "explore.search.campaignsGroup": "Kampagnen",
  "explore.search.alsoKnownAs": "Auch: {{names}}",
};
