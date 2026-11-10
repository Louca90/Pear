// Ce qui a déjà été chiffré et envoyé dans une connexion directe ne repart qu'à la connexion suivante :
// chaque renvoi consomme une clé du ratchet et refait passer tout le message. `epoch` change à chaque
// nouveau canal (PeerLink.epoch).
export class SentOnce {
  private byContact = new Map<string, { epoch: number; ids: Set<string> }>();

  has(contact: string, epoch: number, id: string) {
    const sent = this.byContact.get(contact);
    return sent?.epoch === epoch && sent.ids.has(id);
  }

  add(contact: string, epoch: number, id: string) {
    let sent = this.byContact.get(contact);
    if (sent?.epoch !== epoch) {
      sent = { epoch, ids: new Set() };
      this.byContact.set(contact, sent);
    }
    sent.ids.add(id);
  }

  // Session réparée : ce qui attend repart tout de suite, chiffré avec la nouvelle session.
  forget(contact: string) {
    this.byContact.delete(contact);
  }
}
