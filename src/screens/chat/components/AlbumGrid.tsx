import { useRef } from 'react';
import { Pressable, View } from 'react-native';

import { Message } from '../../../chat/database';
import { chat } from '../../../chat/manager';
import { parseMeta } from '../../../chat/meta';
import { createStyles, radius } from '../../../theme';
import { TransferPear } from '../../../components/TransferPear';
import { useTransferAnimation } from '../hooks/useTransferAnimation';

import { LONG_PRESS_MS, MEDIA_WIDTH } from '../constants';
import { useChatStyles } from '../styles';
import { Rect, ViewRef } from '../types';
import { BlurThumb, ImagePreview, VideoPreview } from './FileContent';
import { useTransferProgress } from '../hooks/useTransferProgress';

// Album (lot 4.5) : plusieurs photos ou vidéos envoyées ensemble, en grille de deux colonnes. Un
// nombre impair commence par une grande image sur toute la largeur.
const WIDTH = MEDIA_WIDTH;
const GAP = 2;
const CELL = (WIDTH - GAP) / 2;
const WIDE_HEIGHT = 146;

export function albumHeight(count: number) {
  const wide = count % 2 === 1;
  const rows = Math.floor(count / 2);
  return (wide ? WIDE_HEIGHT + (rows > 0 ? GAP : 0) : 0) + rows * CELL + Math.max(0, rows - 1) * GAP;
}

type CellProps = {
  message: Message;
  width: number;
  height: number;
  hidden: boolean;
  onOpen: (message: Message, rect: Rect) => void;
  onLongPress: (message: Message) => void;
  onPrepare?: (message: Message) => void;
};

function Cell({ message, width, height, hidden, onOpen, onLongPress, onPrepare }: CellProps) {
  const styles = useStyles();
  const view = useRef<ViewRef>(null);
  // L'avancement du transfert est lu ici : la bulle, elle, ne se redessine que si son message change.
  const progress = useTransferProgress(message.id);
  const transfer = useTransferAnimation(message, progress);
  const receiving = message.status === 'receiving';
  const thumb = parseMeta(message.meta).thumb;
  const size = { width, height, borderRadius: 6 };

  return (
    <Pressable
      ref={view}
      onPress={() => view.current?.measureInWindow((x, y, w, h) => onOpen(message, { x, y, width: w, height: h }))}
      onPressIn={() => onPrepare?.(message)}
      onLongPress={() => onLongPress(message)}
      delayLongPress={LONG_PRESS_MS}
      disabled={receiving}
      style={[size, styles.cell, hidden && styles.hidden]}
    >
      {receiving ? (
        thumb ? <BlurThumb thumb={thumb} style={size} /> : <View style={[size, styles.waiting]} />
      ) : message.kind === 'image' ? (
        <ImagePreview message={message} style={size} />
      ) : (
        <View pointerEvents="none">
          <VideoPreview message={message} style={size} />
        </View>
      )}
      <TransferPear transfer={transfer} small />
    </Pressable>
  );
}

type Props = {
  // Du plus ancien au plus récent : l'ordre d'envoi.
  members: Message[];
  // Le média ouvert dans la visionneuse : sa case s'efface le temps de l'ouverture.
  viewingId?: string;
  onOpen: (message: Message, rect: Rect) => void;
  onLongPress: (message: Message) => void;
  onPrepare?: (message: Message) => void;
};

export function AlbumGrid({ members, viewingId, onOpen, onLongPress, onPrepare }: Props) {
  const styles = useStyles();
  const wide = members.length % 2 === 1;
  return (
    <View style={styles.grid}>
      {members.map((message, index) => (
        <Cell
          key={message.id}
          message={message}
          width={wide && index === 0 ? WIDTH : CELL}
          height={wide && index === 0 ? WIDE_HEIGHT : CELL}
          hidden={viewingId === message.id}
          onOpen={onOpen}
          onLongPress={onLongPress}
          onPrepare={onPrepare}
        />
      ))}
    </View>
  );
}

const useLocalStyles = createStyles((colors) => ({
  grid: {
    width: WIDTH,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  cell: {
    overflow: 'hidden',
  },
  waiting: {
    backgroundColor: colors.surface,
  },
  progressTrack: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    height: 3,
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
    overflow: 'hidden',
  },
  progressBar: {
    height: 3,
  },
}));

const useStyles = () => useChatStyles(useLocalStyles());
