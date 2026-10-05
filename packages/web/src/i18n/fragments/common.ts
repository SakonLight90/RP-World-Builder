/**
 * UI strings shared by more than one area.
 *
 * A common catalog is where copy goes to be duplicated, so it stays nearly empty
 * on purpose: only the sentences two screens need verbatim belong here. The error
 * sentences are the case that earns it — `explainError` formats failures for every
 * screen in the application, so there is no single area to put them in.
 *
 * Everything an area alone shows stays in that area's catalog, even when the same
 * words appear elsewhere: "delete" in the world notebook and "delete" in the
 * settings list are two decisions, and a shared key would let one of them be
 * reworded for the other.
 *
 * The objects are plain literals on purpose: annotating them would widen the key
 * set back to `string` and the four translations would no longer be checked
 * against English.
 */
export const commonEn = {
  "common.error.narratorOffline":
    "The narrator isn't listening: opencode doesn't seem to be running. The campaign is intact, start it and reload.",
  "common.error.campaignGone":
    "This campaign no longer exists. Maybe it was deleted from another tab.",
  "common.error.networkUnreachable":
    "Cannot reach the API at {{url}}. Is the server running and is the address right? ({{cause}})",
  "common.error.httpStatus": "Request failed with status {{status}}.",
};

export const commonIt = {
  "common.error.narratorOffline":
    "Il narratore non è in ascolto: opencode non risulta avviato. La campagna è intatta, avvialo e ricarica.",
  "common.error.campaignGone":
    "Questa campagna non esiste più. Forse è stata cancellata da un'altra scheda.",
  "common.error.networkUnreachable":
    "Non riesco a raggiungere la API su {{url}}. Il server è avviato e l'indirizzo è giusto? ({{cause}})",
  "common.error.httpStatus": "Richiesta fallita con stato {{status}}.",
};

export const commonEs = {
  "common.error.narratorOffline":
    "El narrador no está escuchando: opencode no parece estar en marcha. La campaña está intacta, inícialo y recarga.",
  "common.error.campaignGone": "Esta campaña ya no existe. Quizá se borró desde otra pestaña.",
  "common.error.networkUnreachable":
    "No se puede alcanzar la API en {{url}}. ¿El servidor está en marcha y la dirección es correcta? ({{cause}})",
  "common.error.httpStatus": "La solicitud falló con el estado {{status}}.",
};

export const commonFr = {
  "common.error.narratorOffline":
    "Le narrateur n'écoute pas : opencode ne semble pas être démarré. La campagne est intacte, lancez-le et rechargez.",
  "common.error.campaignGone":
    "Cette campagne n'existe plus. Elle a peut-être été supprimée depuis un autre onglet.",
  "common.error.networkUnreachable":
    "Impossible de joindre l'API sur {{url}}. Le serveur est-il démarré et l'adresse correcte ? ({{cause}})",
  "common.error.httpStatus": "La requête a échoué avec le statut {{status}}.",
};

export const commonDe = {
  "common.error.narratorOffline":
    "Der Erzähler hört nicht zu: opencode läuft offenbar nicht. Die Kampagne ist intakt, starte sie und lade neu.",
  "common.error.campaignGone":
    "Diese Kampagne gibt es nicht mehr. Vielleicht wurde sie in einem anderen Tab gelöscht.",
  "common.error.networkUnreachable":
    "Die API unter {{url}} ist nicht erreichbar. Läuft der Server und ist die Adresse richtig? ({{cause}})",
  "common.error.httpStatus": "Anfrage fehlgeschlagen mit Status {{status}}.",
};
