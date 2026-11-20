import { ComponentRef, useCallback, useEffect, useRef, useState } from 'react';
import Reanimated, { Easing, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { AppState, BackHandler, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { BatteryCharging, Bell, Camera, ChevronRight, Download, ImageIcon, LucideIcon, FileUp, MapPin } from 'lucide-react-native';

import { chat } from '../chat/manager';
import { LINK_NAME_LENGTH } from '../crypto/pairing';
import { collectDiagnostics, needsManufacturerAdvice, openPowerManagerSettings } from '../diagnostics';
import { SegmentedControl } from '../components/SegmentedControl';
import { Avatar, Button, IconButton, useInsets, useNavigationBarHeight } from '../components/ui';
import { t } from '../i18n';
import { log } from '../log';
import { createStyles, radius, setThemePreference, spacing, ThemePreference, useColors, useThemePreference } from '../theme';
import { checkPermissions, ONBOARDING_PERMISSIONS, PermissionId, PermissionState, requestPermission } from './permissions';
import { PermissionCard } from './PermissionCard';
import { enterUp } from '../motion';
import { Pear, PEAR_RATIO } from '../components/Pear';
import { BackupSheet } from '../components/BackupSheet';
import { MediaPicker } from '../components/MediaPicker';
import { ProfilePhotoCropper } from '../components/ProfilePhotoCropper';
import { saveOnboardingStep } from './progress';

export type OnboardingStep = 0 | 1 | 2 | 3;

const MOVE_MS = 560;
const FADE_MS = 260;
const INTRO_MS = 700;
// Hauteur de la poire sur les étapes suivantes (en haut), et à la fin (au centre).
const SMALL_PEAR = 104;
const FINAL_PEAR = 220;
const PEAR_TOP_MARGIN = 12;
// Démarre vite et se pose doucement, sans dépasser : jamais de rebond.
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'auto', label: t('profil.themeAuto') },
  { value: 'light', label: t('profil.themeClair') },
  { value: 'dark', label: t('profil.themeSombre') },
];

const ICONS: Record<PermissionId, LucideIcon> = {
  notifications: Bell,
  battery: BatteryCharging,
  camera: Camera,
  media: ImageIcon,
  location: MapPin,
  install: Download,
  fullScreen: Download,
};
// Les apps inconnues (mises à jour de Pear) : carte en plus, seulement s'il manque l'autorisation.
const CHECKED: PermissionId[] = [...ONBOARDING_PERMISSIONS, 'install'];

type Props = {
  // full : nouveau téléphone ; permissions : utilisateur existant à qui il manque une autorisation.
  mode: 'full' | 'permissions';
  initialStep: OnboardingStep;
  onDone: () => void;
};

// Prise en main : bienvenue, autorisations, profil, fin. Une seule poire traverse toutes les étapes :
// grande et rognée en haut à l'accueil, petite en haut ensuite, puis au centre pour ouvrir l'app.
export function OnboardingScreen({ mode, initialStep, onDone }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const { width, height } = useWindowDimensions();
  const { top } = useInsets();
  const bottom = useNavigationBarHeight();
  const theme = useThemePreference();
  const [step, setStep] = useState<OnboardingStep>(initialStep);
  const position = useSharedValue<number>(initialStep);
  const content = useSharedValue(0);
  const finishing = useSharedValue(0);
  // La poire défile avec le contenu : elle ne passe jamais sur le texte.
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  // Entrée de la poire au premier affichage : elle arrive de la gauche en tournant légèrement.
  const intro = useSharedValue(initialStep === 0 ? 0 : 1);
  useEffect(() => {
    intro.set(withTiming(1, { duration: INTRO_MS, easing: EASING }));
  }, [intro]);
  const [states, setStates] = useState<Partial<Record<PermissionId, PermissionState>> | null>(null);
  // La carte « apps inconnues » reste affichée une fois apparue, même accordée (sa coche se dessine).
  const [showInstall, setShowInstall] = useState(false);
  const [manufacturerAdvice, setManufacturerAdvice] = useState<{ brand: string; settings: boolean } | null>(null);
  const saved = chat.getMyProfile();
  const [name, setName] = useState(saved.name ?? '');
  const [restoring, setRestoring] = useState(false);
  const [photo, setPhoto] = useState(saved.photo);

  const refresh = useCallback(() => {
    checkPermissions(CHECKED)
      .then((next) => {
        setStates(next);
        if (next.install !== 'granted') setShowInstall(true);
      })
      .catch((e) => log.warn('autorisations', e));
  }, []);

  useEffect(() => {
    refresh();
    collectDiagnostics()
      .then((data) => (data.powerManager || needsManufacturerAdvice(data.manufacturer) ? setManufacturerAdvice({ brand: data.manufacturer, settings: data.powerManager }) : null))
      .catch((e) => log.warn('diagnostic', e));
    // Batterie, apps inconnues et accès refusés pour de bon passent par les réglages d'Android : on
    // relit l'état réel de chaque autorisation au retour dans l'app.
    const subscription = AppState.addEventListener('change', (state) => state === 'active' && refresh());
    return () => subscription.remove();
  }, [refresh]);

  // Chaque étape entre en fondu glissé, pendant que la poire rejoint sa place.
  useEffect(() => {
    content.set(0);
    // Chaque étape repart du haut.
    scroll.current?.scrollTo({ y: 0, animated: false });
    scrollY.set(0);
    position.set(withTiming(step, { duration: MOVE_MS, easing: EASING }));
    content.set(withDelay(120, withTiming(1, { duration: FADE_MS, easing: EASING })));
    if (mode === 'full') saveOnboardingStep(step);
  }, [step, mode, position, content, scrollY]);

  const goTo = useCallback(
    (next: OnboardingStep) => {
      const go = () => setStep(next);
      content.set(
        withTiming(0, { duration: FADE_MS / 2, easing: Easing.in(Easing.cubic) }, (finished) => {
          if (finished) scheduleOnRN(go);
        }),
      );
    },
    [content],
  );

  // Retour Android : étape précédente ; à la première étape, Android garde la main (quitter).
  const first: OnboardingStep = mode === 'full' ? 0 : 1;
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step <= first || step === 3) return false;
      goTo((step - 1) as OnboardingStep);
      return true;
    });
    return () => subscription.remove();
  }, [step, first, goTo]);

  const cards = showInstall ? CHECKED : ONBOARDING_PERMISSIONS;
  // Rien n'est obligatoire : le bouton du bas dit seulement « Plus tard » tant qu'il en manque.
  const allGranted = states !== null && cards.every((id) => states[id] === 'granted');

  const ask = async (id: PermissionId) => {
    if (!states) return;
    try {
      const next = await requestPermission(id, states[id] ?? 'missing');
      setStates((current) => ({ ...current, [id]: next }));
    } catch (e) {
      log.warn('autorisation', e);
    }
  };

  // La galerie de Pear, une seule photo : elle est réduite à l'enregistrement (saveProfile).
  const [galleryOpen, setGalleryOpen] = useState(false);
  // La photo choisie passe d'abord par le recadrage en carré, avant d'être gardée.
  const [cropping, setCropping] = useState<string | null>(null);
  const pickPhoto = () => setGalleryOpen(true);

  const saveProfile = async () => {
    try {
      await chat.saveProfile(name.trim(), photo);
      goTo(3);
    } catch (e) {
      log.warn('profil', e);
    }
  };

  // La poire grandit au centre, l'écran s'efface, et l'app s'ouvre.
  const finish = () => {
    content.set(withTiming(0, { duration: FADE_MS }));
    finishing.set(
      withTiming(1, { duration: MOVE_MS, easing: EASING }, (finished) => {
        if (finished) scheduleOnRN(onDone);
      }),
    );
  };

  const afterPermissions = () => (mode === 'full' ? goTo(2) : finish());

  // La poire est dessinée une fois, à sa plus grande taille (l'accueil), puis seulement réduite : le
  // vectoriel reste net. Accueil : énorme, dans l'angle en haut à gauche, elle déborde et penche.
  // Ensuite : petite en haut au centre, puis au centre de l'écran pour ouvrir l'app.
  const pearHeight = height * 0.62;
  const pearWidth = pearHeight * PEAR_RATIO;
  const pearLeft = -pearWidth * 0.38;
  const pearTop = -pearHeight * 0.2;
  const centerX = pearLeft + pearWidth / 2;
  const centerY = pearTop + pearHeight / 2;
  const smallCenterY = top + PEAR_TOP_MARGIN + SMALL_PEAR / 2;
  // Le texte de l'accueil commence sous la poire (bas du dessin, plus la marge due à l'inclinaison).
  const welcomeTextTop = pearTop + pearHeight + pearWidth * Math.sin((16 * Math.PI) / 180) + spacing.md;
  const steps = [0, 1, 2, 3];
  const xs = [0, width / 2 - centerX, width / 2 - centerX, width / 2 - centerX];
  const ys = [0, smallCenterY - centerY, smallCenterY - centerY, height / 2 - centerY];
  const scales = [1, SMALL_PEAR / pearHeight, SMALL_PEAR / pearHeight, FINAL_PEAR / pearHeight];
  const turns = [-16, 0, -10, 0];
  const introShift = -width * 0.35;
  const pearStyle = useAnimatedStyle(() => {
    const p = position.get();
    const i = intro.get();
    return {
      opacity: i,
      transform: [
        { translateY: -scrollY.get() },
        { translateX: interpolate(p, steps, xs) },
        { translateX: introShift * (1 - i) },
        { translateY: interpolate(p, steps, ys) },
        { scale: interpolate(p, steps, scales) },
        { scale: 1 + 0.5 * finishing.get() },
        { rotate: `${interpolate(p, steps, turns)}deg` },
        { rotate: `${-12 * (1 - i)}deg` },
      ],
    };
  });
  const screenStyle = useAnimatedStyle(() => ({ opacity: interpolate(finishing.get(), [0, 0.7, 1], [1, 1, 0]) }));
  const contentStyle = useAnimatedStyle(() => ({ opacity: content.get(), transform: [{ translateY: 16 * (1 - content.get()) }] }));

  return (
    <Reanimated.View style={[styles.screen, screenStyle]}>
      <Reanimated.View pointerEvents="none" style={[styles.pear, { left: pearLeft, top: pearTop }, pearStyle]}>
        <Pear height={pearHeight} color={colors.text} />
      </Reanimated.View>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <Reanimated.ScrollView
          ref={scroll}
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={[styles.content, { paddingTop: step === 0 ? welcomeTextTop : top + PEAR_TOP_MARGIN + SMALL_PEAR + spacing.md, paddingBottom: bottom + spacing.lg }]}
          keyboardShouldPersistTaps="handled"
        >
          <Reanimated.View style={[styles.flex, contentStyle]}>
            {step === 0 && (
              <View style={styles.block}>
                <Text style={styles.title}>{t('priseEnMain.bienvenue')}</Text>
                <Text style={styles.text}>{t('priseEnMain.presentation')}</Text>
                <View style={styles.spacer} />
                <Button label={t('priseEnMain.commencer')} icon={ChevronRight} onPress={() => goTo(1)} />
                <Button label={t('sauvegarde.restaurer')} icon={FileUp} variant="secondary" onPress={() => setRestoring(true)} />
              </View>
            )}
            {step === 1 && (
              <View style={styles.block}>
                <Text style={styles.title}>{t('priseEnMain.autorisations')}</Text>
                <Text style={styles.text}>{t('priseEnMain.autorisationsAide')}</Text>
                <View style={styles.rows}>
                  {states &&
                    cards.map((id, index) => (
                      <PermissionCard
                        key={id}
                        index={index}
                        icon={ICONS[id]}
                        title={t(`priseEnMain.${id}`)}
                        why={t(`priseEnMain.${id}Aide`)}
                        state={states[id] ?? 'missing'}
                        onPress={() => ask(id)}
                        later
                      />
                    ))}
                </View>
                {manufacturerAdvice && (
                  <Pressable
                    onPress={() => (manufacturerAdvice.settings ? openPowerManagerSettings() : null)}
                    style={({ pressed }) => [styles.advice, pressed && manufacturerAdvice.settings && styles.pressed]}
                  >
                    <Text style={styles.adviceTitle}>{t('diag.constructeur', { marque: manufacturerAdvice.brand })}</Text>
                    <Text style={styles.rowText}>{t('diag.constructeurAide')}</Text>
                  </Pressable>
                )}
                <View style={styles.spacer} />
                {/* Le libellé change en fondu quand la dernière autorisation est accordée. */}
                <Reanimated.View key={allGranted ? 'continuer' : 'plusTard'} entering={enterUp(0)}>
                  <Button
                    label={allGranted ? t('priseEnMain.continuer') : t('priseEnMain.plusTard')}
                    icon={ChevronRight}
                    variant={allGranted ? 'primary' : 'secondary'}
                    onPress={afterPermissions}
                  />
                </Reanimated.View>
              </View>
            )}
            {step === 2 && (
              <View style={styles.block}>
                <Text style={styles.title}>{t('priseEnMain.profil')}</Text>
                <IconButton onPress={pickPhoto} label={t('profil.choisirPhoto')} hitSlop={0} style={styles.photo}>
                  <Avatar uri={photo} size={104} />
                  <View style={styles.photoBadge}>
                    <Camera size={18} color={colors.onAccent} strokeWidth={1.75} />
                  </View>
                </IconButton>
                <Text style={styles.label}>{t('profil.votreNom')}</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder={t('profil.commentPresenter')}
                  placeholderTextColor={colors.textMuted}
                  maxLength={LINK_NAME_LENGTH}
                />
                <Text style={styles.label}>{t('profil.apparence')}</Text>
                <SegmentedControl options={THEMES} value={theme} onChange={setThemePreference} />
                <View style={styles.spacer} />
                <View style={!name.trim() && styles.disabled} pointerEvents={name.trim() ? 'auto' : 'none'}>
                  <Button label={t('priseEnMain.suivant')} icon={ChevronRight} onPress={saveProfile} />
                </View>
              </View>
            )}
            {step === 3 && (
              <View style={styles.block}>
                <Text style={styles.title}>{t('priseEnMain.pret')}</Text>
                <Text style={styles.text}>{t('priseEnMain.pretAide')}</Text>
                <View style={styles.spacer} />
                <Button label={t('priseEnMain.ouvrir')} icon={ChevronRight} onPress={finish} />
              </View>
            )}
          </Reanimated.View>
        </Reanimated.ScrollView>
      </KeyboardAvoidingView>
      {restoring && <BackupSheet mode="import" onClose={() => setRestoring(false)} />}
      {galleryOpen && (
        <MediaPicker
          single
          onPick={([picked]) => {
            setGalleryOpen(false);
            if (picked) setCropping(picked.uri);
          }}
          onClose={() => setGalleryOpen(false)}
        />
      )}
      {cropping && (
        <ProfilePhotoCropper
          uri={cropping}
          onDone={(uri) => {
            setPhoto(uri);
          }}
          onClose={() => setCropping(null)}
        />
      )}
    </Reanimated.View>
  );
}

const useStyles = createStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  flex: {
    flex: 1,
  },
  pear: {
    position: 'absolute',
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
  },
  block: {
    flex: 1,
    gap: spacing.md,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: colors.text,
  },
  text: {
    fontSize: 16,
    lineHeight: 22,
    color: colors.textMuted,
  },
  spacer: {
    flex: 1,
    minHeight: spacing.lg,
  },
  rows: {
    gap: 10,
  },
  rowText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  advice: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 2,
  },
  adviceTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  photo: {
    alignSelf: 'center',
  },
  photoBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 34,
    height: 34,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
  },
  input: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.6,
  },
}));
