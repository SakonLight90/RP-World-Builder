/**
 * UI strings for the `nav` area: the sidebar that follows you around every
 * screen, its entries and the three promises printed at the bottom.
 *
 * Split by area so two people can work on different screens without touching
 * the same file. Every area exports the same five languages, because a key that
 * exists only in English is a key nobody notices is missing.
 *
 * The objects are plain literals on purpose: annotating them would widen the key
 * set back to `string` and the four translations would no longer be checked
 * against English.
 *
 * `NAV` in `components/Nav.tsx` stores these keys instead of the words, so the
 * list stays a module constant and the language still decides what it says.
 * The product name in the logo is not here: it is a name, not a sentence.
 */
export const navEn = {
  "nav.item.home": "Home",
  "nav.item.explore": "Explore",
  "nav.item.create": "Create",
  "nav.item.chats": "Chats",
  "nav.item.setup": "Profile",

  "nav.aria.primary": "Main navigation",

  "nav.pill.localTitle": "Data on your PC",
  "nav.pill.localBody": "canon and story",
  "nav.pill.freeTitle": "Free",
  "nav.pill.freeBody": "no account",
  "nav.pill.noTelemetryTitle": "No telemetry",
  "nav.pill.noTelemetryBody": "no usage analysis",
};

export const navIt = {
  "nav.item.home": "Home",
  "nav.item.explore": "Esplora",
  "nav.item.create": "Creazione",
  "nav.item.chats": "Chat",
  "nav.item.setup": "Profilo",

  "nav.aria.primary": "Principale",

  "nav.pill.localTitle": "Dati sul tuo PC",
  "nav.pill.localBody": "canone e storia",
  "nav.pill.freeTitle": "Gratis",
  "nav.pill.freeBody": "senza account",
  "nav.pill.noTelemetryTitle": "Niente telemetria",
  "nav.pill.noTelemetryBody": "nessuna analisi d'uso",
};

export const navEs = {
  "nav.item.home": "Inicio",
  "nav.item.explore": "Explorar",
  "nav.item.create": "Creación",
  "nav.item.chats": "Chats",
  "nav.item.setup": "Perfil",

  "nav.aria.primary": "Navegación principal",

  "nav.pill.localTitle": "Datos en tu PC",
  "nav.pill.localBody": "canon y relato",
  "nav.pill.freeTitle": "Gratis",
  "nav.pill.freeBody": "sin cuenta",
  "nav.pill.noTelemetryTitle": "Sin telemetría",
  "nav.pill.noTelemetryBody": "sin análisis de uso",
};

export const navFr = {
  "nav.item.home": "Accueil",
  "nav.item.explore": "Explorer",
  "nav.item.create": "Création",
  "nav.item.chats": "Discussions",
  "nav.item.setup": "Profil",

  "nav.aria.primary": "Navigation principale",

  "nav.pill.localTitle": "Données sur votre PC",
  "nav.pill.localBody": "canon et récit",
  "nav.pill.freeTitle": "Gratuit",
  "nav.pill.freeBody": "sans compte",
  "nav.pill.noTelemetryTitle": "Aucune télémétrie",
  "nav.pill.noTelemetryBody": "aucune analyse d'usage",
};

export const navDe = {
  "nav.item.home": "Startseite",
  "nav.item.explore": "Entdecken",
  "nav.item.create": "Erstellen",
  "nav.item.chats": "Chats",
  "nav.item.setup": "Profil",

  "nav.aria.primary": "Hauptnavigation",

  "nav.pill.localTitle": "Daten auf deinem PC",
  "nav.pill.localBody": "Kanon und Geschichte",
  "nav.pill.freeTitle": "Kostenlos",
  "nav.pill.freeBody": "ohne Konto",
  "nav.pill.noTelemetryTitle": "Keine Telemetrie",
  "nav.pill.noTelemetryBody": "keine Nutzungsanalyse",
};
