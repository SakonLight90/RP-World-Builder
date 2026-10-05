/**
 * UI strings for the API error codes.
 *
 * One key per code in `ERROR_CATALOG`, named `error.<the code verbatim>`, so
 * the catalog and the server table can be read side by side: a code added on
 * the server without a key here fails the build, because `it`, `es`, `fr` and
 * `de` are typed against English.
 *
 * The placeholder names are the ones the shared table uses. A renamed
 * placeholder does not error, it leaves `{{detail}}` on a screen, which is why
 * `packages/web/test/i18n.test.ts` compares placeholder sets across languages.
 *
 * `detail` and `reason` are English text arriving from a validator or from
 * opencode. In every language but English the sentence puts them last, so the
 * value reads as the quoted cause instead of interrupting the sentence.
 */

export const errorsEn = {
  "error.body.invalid": "Invalid request: {{detail}}",
  "error.body.expectedList": "Expected a list",

  "error.world.notFound": "World not found",
  "error.world.templateNotFound": "Template not found",
  "error.start.notFound": "This world has no start called {{detail}}",
  "error.start.loreOnly": "This start is lore only: it cannot be played",
  "error.world.deleteBlocked":
    "Could not delete the campaign folder, so nothing was deleted: {{path}}. Close whatever is using it, for example an opencode server still running for this campaign, and try again.",

  "error.canon.entryNotFound": "Canon entry not found",

  "error.cast.characterNotFound": "Character not found",
  "error.cast.locationNotFound": "Location not found",
  "error.cast.relationshipNotFound": "Relationship not found",
  "error.cast.kindNotCreatable":
    'This route only creates characters and locations. An entry of kind "{{kind}}" has to be written by hand.',
  "error.cast.characterOtherWorld": "The character {{role}} does not belong to this campaign.",
  "error.cast.locationSelfParent": "A place cannot be inside itself.",
  "error.cast.locationParentOtherWorld": "The parent location does not belong to this campaign.",
  "error.cast.locationParentNested": "The parent location is inside the place being moved.",

  "error.arc.notFound": "Arc not found",
  "error.arc.alreadyClosed": "Arc already closed",
  "error.arc.hasChapters":
    "The arc contains {{count}} chapters. Deleting it would leave them without an arc.",

  "error.chapter.notFound": "Chapter not found",
  "error.chapter.invalidNumber": "Invalid chapter number",

  "error.turn.notFound": "Turn not found",
  "error.turn.failed": "The turn failed: {{reason}}",
  "error.turn.notFinished": "The narrator did not finish the turn.",
  "error.turn.timeout":
    "The narrator did not answer within {{seconds}} seconds. The request was interrupted: try again, and if it happens again change model.",
  "error.turn.emptyOutput":
    "The narrator wrote nothing. The model may be unavailable or it may have interrupted the answer: change model and try again.",
  "error.turn.aborted": "The turn was stopped: {{reason}}",

  "error.narrator.unavailable": "The narrator is not available: {{reason}}",
  "error.opencode.unavailable": "opencode is not available",
  "error.models.unavailable": "The model list could not be read: {{reason}}",

  "error.conversation.notStarted": "The campaign has not started yet.",
  "error.conversation.prologueProtected":
    "The world prologue cannot be deleted: it is the first message.",

  "error.settings.nothingToSave": "Nothing to save",

  "error.import.unrecognizedFile": "Unrecognized campaign file",
  "error.import.noWorld": "The file contains no world",

  "error.server.unexpected": "Something went wrong: {{reason}}",
};

export const errorsIt = {
  "error.body.invalid": "Richiesta non valida: {{detail}}",
  "error.body.expectedList": "Era attesa una lista",

  "error.world.notFound": "Mondo non trovato",
  "error.world.templateNotFound": "Template non trovato",
  "error.start.notFound": "Questo mondo non ha un inizio chiamato {{detail}}",
  "error.start.loreOnly": "Questo inizio è solo lore: non è giocabile",
  "error.world.deleteBlocked":
    "Non è stato possibile cancellare la cartella della campagna, quindi non è stato eliminato nulla: {{path}}. Chiudi ciò che la sta usando, per esempio un server opencode ancora attivo per questa campagna, e riprova.",

  "error.canon.entryNotFound": "Voce di canone non trovata",

  "error.cast.characterNotFound": "Personaggio non trovato",
  "error.cast.locationNotFound": "Luogo non trovato",
  "error.cast.relationshipNotFound": "Relazione non trovata",
  "error.cast.kindNotCreatable":
    'Questa rotta crea solo personaggi e luoghi. Una voce di tipo "{{kind}}" va scritta a mano.',
  "error.cast.characterOtherWorld": "Il personaggio {{role}} non appartiene a questa campagna.",
  "error.cast.locationSelfParent": "Un luogo non può stare dentro se stesso.",
  "error.cast.locationParentOtherWorld": "Il luogo padre non appartiene a questa campagna.",
  "error.cast.locationParentNested": "Il luogo padre è dentro il luogo che si sta spostando.",

  "error.arc.notFound": "Arco non trovato",
  "error.arc.alreadyClosed": "Arco già chiuso",
  "error.arc.hasChapters":
    "L'arco contiene {{count}} capitoli. Eliminandolo resterebbero senza arco.",

  "error.chapter.notFound": "Capitolo non trovato",
  "error.chapter.invalidNumber": "Numero di capitolo non valido",

  "error.turn.notFound": "Turno non trovato",
  "error.turn.failed": "Il turno è fallito: {{reason}}",
  "error.turn.notFinished": "Il narratore non ha finito il turno.",
  "error.turn.timeout":
    "Il narratore non ha risposto entro {{seconds}} secondi. La richiesta è stata interrotta: riprova, e se succede ancora cambia modello.",
  "error.turn.emptyOutput":
    "Il narratore non ha scritto niente. Il modello potrebbe non essere disponibile o aver interrotto la risposta: cambia modello e riprova.",
  "error.turn.aborted": "Il turno è stato fermato: {{reason}}",

  "error.narrator.unavailable": "Il narratore non è disponibile: {{reason}}",
  "error.opencode.unavailable": "opencode non è disponibile",
  "error.models.unavailable": "Non è stato possibile leggere l'elenco dei modelli: {{reason}}",

  "error.conversation.notStarted": "La campagna non è ancora cominciata.",
  "error.conversation.prologueProtected":
    "Il prologo del mondo non si cancella: è il primo messaggio.",

  "error.settings.nothingToSave": "Non c'è niente da salvare",

  "error.import.unrecognizedFile": "File di campagna non riconosciuto",
  "error.import.noWorld": "Il file non contiene nessun mondo",

  "error.server.unexpected": "Qualcosa è andato storto: {{reason}}",
};

export const errorsEs = {
  "error.body.invalid": "Solicitud no válida: {{detail}}",
  "error.body.expectedList": "Se esperaba una lista",

  "error.world.notFound": "Mundo no encontrado",
  "error.world.templateNotFound": "Plantilla no encontrada",
  "error.start.notFound": "Este mundo no tiene un inicio llamado {{detail}}",
  "error.start.loreOnly": "Este inicio es solo lore: no se puede jugar",
  "error.world.deleteBlocked":
    "No se pudo borrar la carpeta de la campaña, así que no se eliminó nada: {{path}}. Cierra lo que la esté usando, por ejemplo un servidor de opencode todavía en marcha para esta campaña, e inténtalo otra vez.",

  "error.canon.entryNotFound": "Entrada de canon no encontrada",

  "error.cast.characterNotFound": "Personaje no encontrado",
  "error.cast.locationNotFound": "Lugar no encontrado",
  "error.cast.relationshipNotFound": "Relación no encontrada",
  "error.cast.kindNotCreatable":
    'Esta ruta solo crea personajes y lugares. Una entrada de tipo "{{kind}}" hay que escribirla a mano.',
  "error.cast.characterOtherWorld": "El personaje {{role}} no pertenece a esta campaña.",
  "error.cast.locationSelfParent": "Un lugar no puede estar dentro de sí mismo.",
  "error.cast.locationParentOtherWorld": "El lugar padre no pertenece a esta campaña.",
  "error.cast.locationParentNested": "El lugar padre está dentro del lugar que se está moviendo.",

  "error.arc.notFound": "Arco no encontrado",
  "error.arc.alreadyClosed": "El arco ya está cerrado",
  "error.arc.hasChapters": "El arco contiene {{count}} capítulos. Al borrarlo quedarían sin arco.",

  "error.chapter.notFound": "Capítulo no encontrado",
  "error.chapter.invalidNumber": "Número de capítulo no válido",

  "error.turn.notFound": "Turno no encontrado",
  "error.turn.failed": "El turno falló: {{reason}}",
  "error.turn.notFinished": "El narrador no terminó el turno.",
  "error.turn.timeout":
    "El narrador no respondió en {{seconds}} segundos. La solicitud se interrumpió: inténtalo otra vez y, si se repite, cambia de modelo.",
  "error.turn.emptyOutput":
    "El narrador no escribió nada. Puede que el modelo no esté disponible o que haya interrumpido la respuesta: cambia de modelo e inténtalo otra vez.",
  "error.turn.aborted": "El turno se detuvo: {{reason}}",

  "error.narrator.unavailable": "El narrador no está disponible: {{reason}}",
  "error.opencode.unavailable": "opencode no está disponible",
  "error.models.unavailable": "No se pudo leer la lista de modelos: {{reason}}",

  "error.conversation.notStarted": "La campaña todavía no ha empezado.",
  "error.conversation.prologueProtected":
    "El prólogo del mundo no se puede borrar: es el primer mensaje.",

  "error.settings.nothingToSave": "No hay nada que guardar",

  "error.import.unrecognizedFile": "Archivo de campaña no reconocido",
  "error.import.noWorld": "El archivo no contiene ningún mundo",

  "error.server.unexpected": "Algo salió mal: {{reason}}",
};

export const errorsFr = {
  "error.body.invalid": "Requête invalide : {{detail}}",
  "error.body.expectedList": "Une liste était attendue",

  "error.world.notFound": "Monde introuvable",
  "error.world.templateNotFound": "Modèle introuvable",
  "error.start.notFound": "Ce monde n'a pas de début nommé {{detail}}",
  "error.start.loreOnly": "Ce début est réservé au lore : il ne peut pas être joué",
  "error.world.deleteBlocked":
    "Impossible de supprimer le dossier de la campagne, donc rien n'a été supprimé : {{path}}. Fermez ce qui l'utilise, par exemple un serveur opencode encore actif pour cette campagne, puis réessayez.",

  "error.canon.entryNotFound": "Fiche de canon introuvable",

  "error.cast.characterNotFound": "Personnage introuvable",
  "error.cast.locationNotFound": "Lieu introuvable",
  "error.cast.relationshipNotFound": "Relation introuvable",
  "error.cast.kindNotCreatable":
    "Cette route ne crée que des personnages et des lieux. Une fiche de type « {{kind}} » doit être écrite à la main.",
  "error.cast.characterOtherWorld": "Le personnage {{role}} n'appartient pas à cette campagne.",
  "error.cast.locationSelfParent": "Un lieu ne peut pas être en lui-même.",
  "error.cast.locationParentOtherWorld": "Le lieu parent n'appartient pas à cette campagne.",
  "error.cast.locationParentNested": "Le lieu parent est à l'intérieur du lieu déplacé.",

  "error.arc.notFound": "Arc introuvable",
  "error.arc.alreadyClosed": "L'arc est déjà clos",
  "error.arc.hasChapters":
    "L'arc contient {{count}} chapitres. Le supprimer les laisserait sans arc.",

  "error.chapter.notFound": "Chapitre introuvable",
  "error.chapter.invalidNumber": "Numéro de chapitre invalide",

  "error.turn.notFound": "Tour introuvable",
  "error.turn.failed": "Le tour a échoué : {{reason}}",
  "error.turn.notFinished": "Le narrateur n'a pas terminé le tour.",
  "error.turn.timeout":
    "Le narrateur n'a pas répondu en {{seconds}} secondes. La requête a été interrompue : réessayez, et si cela recommence changez de modèle.",
  "error.turn.emptyOutput":
    "Le narrateur n'a rien écrit. Le modèle est peut-être indisponible ou il a interrompu la réponse : changez de modèle et réessayez.",
  "error.turn.aborted": "Le tour a été arrêté : {{reason}}",

  "error.narrator.unavailable": "Le narrateur n'est pas disponible : {{reason}}",
  "error.opencode.unavailable": "opencode n'est pas disponible",
  "error.models.unavailable": "La liste des modèles n'a pas pu être lue : {{reason}}",

  "error.conversation.notStarted": "La campagne n'a pas encore commencé.",
  "error.conversation.prologueProtected":
    "Le prologue du monde ne peut pas être supprimé : c'est le premier message.",

  "error.settings.nothingToSave": "Rien à enregistrer",

  "error.import.unrecognizedFile": "Fichier de campagne non reconnu",
  "error.import.noWorld": "Le fichier ne contient aucun monde",

  "error.server.unexpected": "Quelque chose s'est mal passé : {{reason}}",
};

export const errorsDe = {
  "error.body.invalid": "Ungültige Anfrage: {{detail}}",
  "error.body.expectedList": "Es wurde eine Liste erwartet",

  "error.world.notFound": "Welt nicht gefunden",
  "error.world.templateNotFound": "Vorlage nicht gefunden",
  "error.start.notFound": "Diese Welt hat keinen Start namens {{detail}}",
  "error.start.loreOnly": "Dieser Start ist nur Lore: er ist nicht spielbar",
  "error.world.deleteBlocked":
    "Der Kampagnenordner konnte nicht gelöscht werden, es wurde also nichts entfernt: {{path}}. Schließe, was ihn noch belegt, etwa einen opencode-Server für diese Kampagne, und versuche es erneut.",

  "error.canon.entryNotFound": "Canon-Eintrag nicht gefunden",

  "error.cast.characterNotFound": "Figur nicht gefunden",
  "error.cast.locationNotFound": "Ort nicht gefunden",
  "error.cast.relationshipNotFound": "Beziehung nicht gefunden",
  "error.cast.kindNotCreatable":
    'Diese Route legt nur Figuren und Orte an. Ein Eintrag der Art „{{kind}}" muss von Hand geschrieben werden.',
  "error.cast.characterOtherWorld": "Die Figur {{role}} gehört nicht zu dieser Kampagne.",
  "error.cast.locationSelfParent": "Ein Ort kann nicht in sich selbst liegen.",
  "error.cast.locationParentOtherWorld": "Der übergeordnete Ort gehört nicht zu dieser Kampagne.",
  "error.cast.locationParentNested": "Der übergeordnete Ort liegt im Ort, der verschoben wird.",

  "error.arc.notFound": "Bogen nicht gefunden",
  "error.arc.alreadyClosed": "Der Bogen ist bereits abgeschlossen",
  "error.arc.hasChapters":
    "Der Bogen enthält {{count}} Kapitel. Würde er gelöscht, blieben sie ohne Bogen.",

  "error.chapter.notFound": "Kapitel nicht gefunden",
  "error.chapter.invalidNumber": "Ungültige Kapitelnummer",

  "error.turn.notFound": "Zug nicht gefunden",
  "error.turn.failed": "Der Zug ist fehlgeschlagen: {{reason}}",
  "error.turn.notFinished": "Der Erzähler hat den Zug nicht beendet.",
  "error.turn.timeout":
    "Der Erzähler hat innerhalb von {{seconds}} Sekunden nicht geantwortet. Die Anfrage wurde unterbrochen: versuche es erneut, und wenn es wieder passiert, wechsle das Modell.",
  "error.turn.emptyOutput":
    "Der Erzähler hat nichts geschrieben. Vielleicht ist das Modell nicht verfügbar oder es hat die Antwort abgebrochen: wechsle das Modell und versuche es erneut.",
  "error.turn.aborted": "Der Zug wurde gestoppt: {{reason}}",

  "error.narrator.unavailable": "Der Erzähler ist nicht verfügbar: {{reason}}",
  "error.opencode.unavailable": "opencode ist nicht verfügbar",
  "error.models.unavailable": "Die Modelliste konnte nicht gelesen werden: {{reason}}",

  "error.conversation.notStarted": "Die Kampagne hat noch nicht begonnen.",
  "error.conversation.prologueProtected":
    "Der Prolog der Welt kann nicht gelöscht werden: er ist die erste Nachricht.",

  "error.settings.nothingToSave": "Nichts zu speichern",

  "error.import.unrecognizedFile": "Unbekannte Kampagnendatei",
  "error.import.noWorld": "Die Datei enthält keine Welt",

  "error.server.unexpected": "Etwas ist schiefgelaufen: {{reason}}",
};
