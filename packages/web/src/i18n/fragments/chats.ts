/**
 * UI strings for the `chats` area: the list of your stories, the filter above
 * it and the row that opens one.
 *
 * Split by area so two people can work on different screens without touching
 * the same file. Every area exports the same five languages, because a key that
 * exists only in English is a key nobody notices is missing.
 *
 * The objects are plain literals on purpose: annotating them would widen the key
 * set back to `string` and the four translations would no longer be checked
 * against English.
 *
 * Chapter number and context percentage are `{{placeholders}}` and not
 * concatenation, so each language puts the number where its grammar wants it:
 * French wants a space before the percent sign, Spanish doesn't.
 */
export const chatsEn = {
  "chats.page.title": "Your chats",

  "chats.state.loading": "loading…",
  "chats.state.empty": "You don't have a story yet.",
  "chats.state.noResults": "No chat matches the search.",

  "chats.search.placeholder": "Search your chats",

  "chats.category.saved": "Saved",
  "chats.category.liked": "Liked",
  "chats.category.comments": "Comments",
  "chats.category.ongoing": "In progress",

  "chats.row.notStarted": "The story hasn't begun yet.",
  "chats.row.firstChapter": "first chapter",
  "chats.row.chapter": "chapter {{n}}",

  "chats.action.start": "start",

  "chats.aria.play": "Play",
  "chats.aria.notebook": "Open the notebook",
};

export const chatsIt = {
  "chats.page.title": "Le tue chat",

  "chats.state.loading": "carico…",
  "chats.state.empty": "Non hai ancora nessuna storia.",
  "chats.state.noResults": "Nessuna chat corrisponde alla ricerca.",

  "chats.search.placeholder": "Cerca nelle tue chat",

  "chats.category.saved": "Salvati",
  "chats.category.liked": "Mi piace",
  "chats.category.comments": "Commenti",
  "chats.category.ongoing": "In corso",

  "chats.row.notStarted": "La storia non è ancora cominciata.",
  "chats.row.firstChapter": "primo capitolo",
  "chats.row.chapter": "capitolo {{n}}",

  "chats.action.start": "comincia",

  "chats.aria.play": "Gioca",
  "chats.aria.notebook": "Apri il quaderno",
};

export const chatsEs = {
  "chats.page.title": "Tus conversaciones",

  "chats.state.loading": "cargando…",
  "chats.state.empty": "Todavía no tienes ninguna historia.",
  "chats.state.noResults": "Ninguna conversación coincide con la búsqueda.",

  "chats.search.placeholder": "Busca entre tus conversaciones",

  "chats.category.saved": "Guardados",
  "chats.category.liked": "Me gusta",
  "chats.category.comments": "Comentarios",
  "chats.category.ongoing": "En curso",

  "chats.row.notStarted": "La historia todavía no ha empezado.",
  "chats.row.firstChapter": "primer capítulo",
  "chats.row.chapter": "capítulo {{n}}",

  "chats.action.start": "empezar",

  "chats.aria.play": "Jugar",
  "chats.aria.notebook": "Abrir el cuaderno",
};

export const chatsFr = {
  "chats.page.title": "Vos discussions",

  "chats.state.loading": "chargement…",
  "chats.state.empty": "Vous n'avez pas encore d'histoire.",
  "chats.state.noResults": "Aucune discussion ne correspond à la recherche.",

  "chats.search.placeholder": "Cherchez parmi vos discussions",

  "chats.category.saved": "Enregistrés",
  "chats.category.liked": "J'aime",
  "chats.category.comments": "Commentaires",
  "chats.category.ongoing": "En cours",

  "chats.row.notStarted": "L'histoire n'a pas encore commencé.",
  "chats.row.firstChapter": "premier chapitre",
  "chats.row.chapter": "chapitre {{n}}",

  "chats.action.start": "commencer",

  "chats.aria.play": "Jouer",
  "chats.aria.notebook": "Ouvrir le carnet",
};

export const chatsDe = {
  "chats.page.title": "Deine Chats",

  "chats.state.loading": "lade…",
  "chats.state.empty": "Du hast noch keine Geschichte.",
  "chats.state.noResults": "Keine Unterhaltung passt zur Suche.",

  "chats.search.placeholder": "In deinen Chats suchen",

  "chats.category.saved": "Gespeichert",
  "chats.category.liked": "Gefällt mir",
  "chats.category.comments": "Kommentare",
  "chats.category.ongoing": "Laufend",

  "chats.row.notStarted": "Die Geschichte hat noch nicht begonnen.",
  "chats.row.firstChapter": "erstes Kapitel",
  "chats.row.chapter": "Kapitel {{n}}",

  "chats.action.start": "anfangen",

  "chats.aria.play": "Spielen",
  "chats.aria.notebook": "Notizbuch öffnen",
};
