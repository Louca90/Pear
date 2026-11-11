// Notes à moi-même (lot 4.6) : une conversation qui ne quitte jamais ce téléphone. Sa « clé » n'est
// pas une clé publique : elle n'est dans aucune liste de contacts, donc aucune connexion, aucun push,
// aucun relais ne peut la viser. Ses messages sont enregistrés directement comme lus.
export const SELF = 'self';

export const isSelf = (contact: string) => contact === SELF;
