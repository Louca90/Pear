import { t } from '../i18n';

// Lignes d'appel dans la conversation (vague 5), enregistrées comme messages système :
// `call:<issue>:<a|v>[:<secondes>]`, chaque téléphone écrivant la sienne.

export type CallRecord = { outcome: 'done' | 'missed' | 'declined' | 'network' | 'cancelled' | 'noanswer'; video: boolean; seconds: number | null };

const RECORD = /^call:(done|missed|declined|network|cancelled|noanswer):([av])(?::(\d{1,6}))?$/;

export function parseCallRecord(text: string): CallRecord | null {
  const match = RECORD.exec(text);
  if (!match) return null;
  return { outcome: match[1] as CallRecord['outcome'], video: match[2] === 'v', seconds: match[3] ? Number(match[3]) : null };
}

// 0:42, 3:07, 1:02:09.
export function formatCallDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function callRecordText(record: CallRecord) {
  if (record.outcome === 'done') return t(record.video ? 'appel.sysVideo' : 'appel.sysAudio', { duree: formatCallDuration(record.seconds ?? 0) });
  if (record.outcome === 'missed') return t('appel.sysManque');
  if (record.outcome === 'declined') return t('appel.sysRefuse');
  if (record.outcome === 'network') return t('appel.sysReseau');
  if (record.outcome === 'cancelled') return t('appel.sysAnnule');
  return t('appel.sysSansReponse');
}
