const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

// Pear dans le menu « Partager » d'Android, pour les photos et vidéos (une ou plusieurs) : la galerie,
// Google Photos ou une autre app peuvent les envoyer directement à un contact (lot 12).
const SHARE_ACTIONS = ['android.intent.action.SEND', 'android.intent.action.SEND_MULTIPLE'];
const SHARE_TYPES = ['image/*', 'video/*'];

function shareFilter(action) {
  return {
    action: [{ $: { 'android:name': action } }],
    category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
    data: SHARE_TYPES.map((type) => ({ $: { 'android:mimeType': type } })),
  };
}

// Partage direct (lot 2.6) : les contacts récents, publiés comme raccourcis par PearNative.setShareShortcuts,
// apparaissent dans le menu Partager. La catégorie relie le raccourci à la cible de partage.
const SHARE_CATEGORY = 'com.louca.pear.category.SHARE_TARGET';
const SHORTCUTS_XML = `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
  <share-target android:targetClass="com.louca.pear.MainActivity">
    <data android:mimeType="image/*" />
    <data android:mimeType="video/*" />
    <category android:name="${SHARE_CATEGORY}" />
  </share-target>
</shortcuts>
`;

const withShortcutsFile = (config) =>
  withDangerousMod(config, [
    'android',
    (result) => {
      const dir = path.join(result.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'shortcuts.xml'), SHORTCUTS_XML);
      return result;
    },
  ]);

const withShareIntent = (config) =>
  withAndroidManifest(config, (result) => {
    const application = result.modResults.manifest.application?.[0];
    const activity = application?.activity?.find((item) => item.$['android:name'] === '.MainActivity');
    if (!activity) throw new Error('with-share-intent : MainActivity introuvable');
    const filters = activity['intent-filter'] ?? [];
    // Rejouable sans doublon (prebuild relancé).
    const others = filters.filter((filter) => !filter.action?.some((action) => SHARE_ACTIONS.includes(action.$['android:name'])));
    activity['intent-filter'] = [...others, ...SHARE_ACTIONS.map(shareFilter)];
    const meta = (activity['meta-data'] ?? []).filter((item) => item.$['android:name'] !== 'android.app.shortcuts');
    meta.push({ $: { 'android:name': 'android.app.shortcuts', 'android:resource': '@xml/shortcuts' } });
    activity['meta-data'] = meta;
    return result;
  });

module.exports = (config) => withShortcutsFile(withShareIntent(config));
