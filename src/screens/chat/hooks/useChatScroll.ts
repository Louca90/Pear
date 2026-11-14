import { RefObject, useEffect, useRef, useState } from 'react';
import { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { Message } from '../../../chat/database';
import { chat } from '../../../chat/manager';

import { AT_BOTTOM_PX, MEDIA_SETTLE_MS } from '../constants';

const EDGE_PX = 2;
// Remonté de plus que ça (environ un écran) : le bouton « revenir en bas » apparaît.
const FAR_PX = 700;

// La liste est inversée : le bas de la conversation est l'offset 0.
// preview : la page affichée sous le geste de retour ne doit rien marquer comme lu.
export function useChatScroll(list: RefObject<FlatList<Message> | null>, messages: Message[], preview?: boolean) {
  const atBottom = useRef(true);
  const [newCount, setNewCount] = useState(0);
  const [far, setFar] = useState(false);
  const newest = useRef(messages[0]?.id);

  // Messages reçus pendant qu'on est remonté : on les compte pour le bouton, la vue ne bouge pas.
  useEffect(() => {
    const previous = newest.current;
    newest.current = messages[0]?.id;
    if (!previous || messages[0]?.id === previous || atBottom.current) return;
    const index = messages.findIndex((message) => message.id === previous);
    const arrived = (index < 0 ? [] : messages.slice(0, index)).filter((message) => message.mine === 0 && message.kind !== 'system');
    if (arrived.length > 0) setNewCount((count) => count + arrived.length);
  }, [messages]);

  // Tout en bas, au point près : seul endroit où le geste des éphémères peut partir.
  const atEdge = useRef(true);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    atEdge.current = event.nativeEvent.contentOffset.y <= EDGE_PX;
    atBottom.current = event.nativeEvent.contentOffset.y < AT_BOTTOM_PX;
    // Seulement quand ça change : pas de rendu à chaque événement de défilement.
    const isFar = event.nativeEvent.contentOffset.y > FAR_PX;
    setFar((current) => (current === isFar ? current : isFar));
    if (atBottom.current) setNewCount(0);
    if (!preview) chat.setAtBottom(atBottom.current);
  };

  const scrollToBottom = () => {
    atBottom.current = true;
    setNewCount(0);
    list.current?.scrollToOffset({ offset: 0, animated: true });
  };

  // Après un envoi : tout de suite, puis une fois le média affiché à sa hauteur finale.
  const followSent = () => {
    scrollToBottom();
    setTimeout(scrollToBottom, MEDIA_SETTLE_MS);
  };

  return {
    newCount,
    far,
    isAtEdge: () => atEdge.current,
    scrollToBottom,
    followSent,
    listProps: {
      onScroll,
      scrollEventThrottle: 32,
      // En bas, la vue suit les nouveaux messages ; plus haut, elle reste sur ce qu'on lit.
      maintainVisibleContentPosition: { minIndexForVisible: 0, autoscrollToTopThreshold: AT_BOTTOM_PX },
    },
  };
}
