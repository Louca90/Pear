const { withAndroidManifest } = require('expo/config-plugins');

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

module.exports = (config) =>
  withAndroidManifest(config, (result) => {
    const application = result.modResults.manifest.application?.[0];
    const activity = application?.activity?.find((item) => item.$['android:name'] === '.MainActivity');
    if (!activity) throw new Error('with-share-intent : MainActivity introuvable');
    const filters = activity['intent-filter'] ?? [];
    // Rejouable sans doublon (prebuild relancé).
    const others = filters.filter((filter) => !filter.action?.some((action) => SHARE_ACTIONS.includes(action.$['android:name'])));
    activity['intent-filter'] = [...others, ...SHARE_ACTIONS.map(shareFilter)];
    return result;
  });
