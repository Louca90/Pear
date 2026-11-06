// Version du protocole, dans chaque message chiffré. Sans champ v : un téléphone d'avant le lot 3, donc
// la version 1. Une version plus récente que celle-ci n'est pas lue : on demande de mettre Pear à jour.
export const PROTOCOL_VERSION = 1;

export function isSupportedVersion(payload: Record<string, unknown>) {
  return payload.v === undefined || (typeof payload.v === 'number' && payload.v <= PROTOCOL_VERSION);
}

// Message système affiché à la place d'un message d'une version plus récente de Pear.
export const UPDATE_REQUIRED = 'update-required';
