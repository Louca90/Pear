// Une zone qui défile horizontalement sur l'onglet caméra (la bande des filtres) garde le doigt :
// tant qu'elle est touchée, le glissé entre onglets d'App.tsx ne se déclenche pas.
let locked = false;

export function lockTabSwipe(value: boolean) {
  locked = value;
}

export function isTabSwipeLocked() {
  return locked;
}
