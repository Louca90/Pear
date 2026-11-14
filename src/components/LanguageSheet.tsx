import { reloadApp } from '../../modules/pear-native';
import { LanguageChoice, languageChoice, LANGUAGES, saveLanguageChoice, t } from '../i18n';
import { log } from '../log';
import { showDialog } from './dialog';
import { Sheet, SheetChoice } from './Sheet';

// Choix de la langue : celle du téléphone par défaut, ou l'une des langues de Pear. L'app se recharge
// pour l'appliquer partout.
export function LanguageSheet({ onClose }: { onClose: () => void }) {
  const current = languageChoice();
  const options: { code: LanguageChoice; name: string }[] = [{ code: 'auto', name: t('langue.auto') }, ...LANGUAGES];

  return (
    <Sheet title={t('langue.titre')} onClose={onClose}>
      {(close) =>
        options.map((option, index) => (
          <SheetChoice
            key={option.code}
            index={index}
            label={option.name}
            selected={option.code === current}
            onPress={() => {
              if (option.code === current) return close();
              close(() => {
                saveLanguageChoice(option.code)
                  .then(() => reloadApp())
                  .catch((e) => {
                    log.warn('langue', e);
                    showDialog(t('langue.titre'), t('langue.redemarrer'));
                  });
              });
            }}
          />
        ))
      }
    </Sheet>
  );
}
