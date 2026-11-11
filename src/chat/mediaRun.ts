// Les photos et vidéos reçues à la suite, tout en bas des messages d'une notification : la notification
// les résume en une phrase (« Louca vous a envoyé 3 photos »).

export type RunMessage = { kind: string; mine: number };

const isMedia = (message: RunMessage) => message.mine === 0 && (message.kind === 'image' || message.kind === 'video');

// Le dernier message reçu doit être une photo ou une vidéo ; la série remonte tant que ce sont des
// médias reçus. Renvoie les positions (fin comprise) et le nombre de photos et de vidéos, ou null.
export function trailingMediaRun(messages: RunMessage[], lastReceived: number): { start: number; photos: number; videos: number } | null {
  if (lastReceived < 0 || !isMedia(messages[lastReceived])) return null;
  let start = lastReceived;
  while (start > 0 && isMedia(messages[start - 1])) start -= 1;
  let photos = 0;
  let videos = 0;
  for (let i = start; i <= lastReceived; i += 1) {
    if (messages[i].kind === 'image') photos += 1;
    else videos += 1;
  }
  return { start, photos, videos };
}
