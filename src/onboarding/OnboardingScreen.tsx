import { ComponentRef, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, BackHandler, Easing, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { BatteryCharging, Bell, Camera, Check, ChevronRight, Download, LucideIcon } from 'lucide-react-native';

import { chat } from '../chat/manager';
import { LINK_NAME_LENGTH } from '../crypto/pairing';
import { collectDiagnostics, needsManufacturerAdvice, openPowerManagerSettings } from '../diagnostics';
import { SegmentedControl } from '../components/SegmentedControl';
import { Avatar, Button, IconButton, useInsets, useNavigationBarHeight } from '../components/ui';
import { PROFILE_PHOTO_QUALITY } from '../config';
import { t } from '../i18n';
import { log } from '../log';
import { createStyles, radius, setThemePreference, spacing, ThemePreference, useColors, useThemePreference } from '../theme';
import { checkAllPermissions, PermissionId, PermissionState, requestPermission } from './permissions';
import { saveOnboardingStep } from './progress';

export type OnboardingStep = 0 | 1 | 2 | 3;

const PEAR = require('../../assets/android-icon-foreground.png');
const MOVE_MS = 560;
const FADE_MS = 260;
const CHECK_MS = 320;
const INTRO_MS = 700;
// Démarre vite et se pose doucement, sans dépasser : jamais de rebond.
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'auto', label: t('profil.themeAuto') },
  { value: 'light', label: t('profil.themeClair') },
  { value: 'dark', label: t('profil.themeSombre') },
];

const ROWS: { id: PermissionId; icon: LucideIcon }[] = [
  { id: 'notifications', icon: Bell },
  { id: 'camera', icon: Camera },
  { id: 'battery', icon: BatteryCharging },
  { id: 'install', icon: Download },
];

type Props = {
  // full : nouveau téléphone ; permissions : utilisateur existant à qui il manque une autorisation.
  mode: 'full' | 'permissions';
  initialStep: OnboardingStep;
  onDone: () => void;
};

function PermissionRow({ id, icon: Icon, state, onPress }: { id: PermissionId; icon: LucideIcon; state: PermissionState; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const granted = state === 'granted';
  const check = useRef(new Animated.Value(granted ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(check, { toValue: granted ? 1 : 0, duration: CHECK_MS, easing: EASING, useNativeDriver: true }).start();
  }, [granted, check]);

  return (
    <View style={styles.row}>
      <Icon size={22} color={colors.text} strokeWidth={1.75} />
      <View style={styles.flex}>
        <Text style={styles.rowTitle}>{t(`priseEnMain.${id}`)}</Text>
        <Text style={styles.rowText}>{t(`priseEnMain.${id}Aide`)}</Text>
      </View>
      <View style={styles.rowAction}>
        <Animated.View style={[styles.okBadge, { opacity: check, transform: [{ scale: check.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}>
          <Check size={16} color={colors.onAccent} strokeWidth={2.5} />
          <Text style={styles.okLabel}>OK</Text>
        </Animated.View>
        <Animated.View style={{ opacity: check.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }} pointerEvents={granted ? 'none' : 'auto'}>
          <Pressable onPress={onPress} style={({ pressed }) => [styles.allow, pressed && styles.pressed]}>
            <Text style={styles.allowLabel}>{state === 'blocked' ? t('priseEnMain.reglages') : t('priseEnMain.autoriser')}</Text>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

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
  const position = useRef(new Animated.Value(initialStep)).current;
  const content = useRef(new Animated.Value(0)).current;
  const finishing = useRef(new Animated.Value(0)).current;
  // La poire défile avec le contenu : elle ne passe jamais sur le texte.
  const scrollY = useRef(new Animated.Value(0)).current;
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  // Entrée de la poire au premier affichage : elle arrive de la gauche en tournant légèrement.
  const intro = useRef(new Animated.Value(initialStep === 0 ? 0 : 1)).current;
  useEffect(() => {
    Animated.timing(intro, { toValue: 1, duration: INTRO_MS, easing: EASING, useNativeDriver: true }).start();
  }, [intro]);
  const [states, setStates] = useState<Record<PermissionId, PermissionState> | null>(null);
  const [manufacturerAdvice, setManufacturerAdvice] = useState<{ brand: string; settings: boolean } | null>(null);
  const saved = chat.getMyProfile();
  const [name, setName] = useState(saved.name ?? '');
  const [photo, setPhoto] = useState(saved.photo);

  const refresh = useCallback(() => {
    checkAllPermissions()
      .then(setStates)
      .catch((e) => log.warn('autorisations', e));
  }, []);

  useEffect(() => {
    refresh();
    collectDiagnostics()
      .then((data) => (data.powerManager || needsManufacturerAdvice(data.manufacturer) ? setManufacturerAdvice({ brand: data.manufacturer, settings: data.powerManager }) : null))
      .catch((e) => log.warn('diagnostic', e));
    // Batterie et apps inconnues s'accordent dans les réglages d'Android : on relit au retour.
    const subscription = AppState.addEventListener('change', (state) => state === 'active' && refresh());
    return () => subscription.remove();
  }, [refresh]);

  // Chaque étape entre en fondu glissé, pendant que la poire rejoint sa place.
  useEffect(() => {
    content.setValue(0);
    // Chaque étape repart du haut.
    scroll.current?.scrollTo({ y: 0, animated: false });
    scrollY.setValue(0);
    Animated.parallel([
      Animated.timing(position, { toValue: step, duration: MOVE_MS, easing: EASING, useNativeDriver: true }),
      Animated.timing(content, { toValue: 1, duration: FADE_MS, delay: 120, easing: EASING, useNativeDriver: true }),
    ]).start();
    if (mode === 'full') saveOnboardingStep(step);
  }, [step, mode, position, content, scrollY]);

  const goTo = useCallback(
    (next: OnboardingStep) => {
      Animated.timing(content, { toValue: 0, duration: FADE_MS / 2, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => setStep(next));
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

  const allGranted = states !== null && ROWS.every(({ id }) => states[id] === 'granted');

  const ask = async (id: PermissionId) => {
    if (!states) return;
    const next = await requestPermission(id, states[id]);
    setStates({ ...states, [id]: next });
  };

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: PROFILE_PHOTO_QUALITY, allowsEditing: true, aspect: [1, 1] });
    const asset = result.assets?.[0];
    if (!result.canceled && asset) setPhoto(asset.uri);
  };

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
    Animated.parallel([
      Animated.timing(finishing, { toValue: 1, duration: MOVE_MS, easing: EASING, useNativeDriver: true }),
      Animated.timing(content, { toValue: 0, duration: FADE_MS, useNativeDriver: true }),
    ]).start(onDone);
  };

  const afterPermissions = () => (mode === 'full' ? goTo(2) : finish());

  // La poire : une image de `width` de côté, dont le dessin occupe à peu près le centre.
  // Bienvenue : énorme, dans l'angle en haut à gauche, elle déborde de l'écran, un peu tournée.
  // Ensuite : petite en haut au centre, puis au centre de l'écran pour ouvrir l'app.
  const pearTranslateX = position.interpolate({ inputRange: [0, 1, 2, 3], outputRange: [-width * 0.46, 0, 0, 0] });
  const pearTranslateY = position.interpolate({
    inputRange: [0, 1, 2, 3],
    outputRange: [height * 0.17 - width / 2, top - width * 0.33, top - width * 0.33, height / 2 - width / 2 - top],
  });
  const scrolled = Animated.multiply(scrollY, -1);
  const pearScale = position.interpolate({ inputRange: [0, 1, 2, 3], outputRange: [3, 0.36, 0.36, 0.7] });
  const pearRotate = position.interpolate({ inputRange: [0, 1, 2, 3], outputRange: ['-16deg', '0deg', '-10deg', '0deg'] });
  const introX = intro.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.35, 0] });
  const introRotate = intro.interpolate({ inputRange: [0, 1], outputRange: ['-12deg', '0deg'] });
  const finishScale = finishing.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] });
  const contentStyle = {
    opacity: content,
    transform: [{ translateY: content.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
  };

  return (
    <Animated.View style={[styles.screen, { opacity: finishing.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }) }]}>
      <Animated.Image
        source={PEAR}
        resizeMode="contain"
        // Android fait apparaître chaque image en fondu (300 ms) : la poire doit être là tout de suite.
        fadeDuration={0}
        style={[
          styles.pear,
          { width, height: width, tintColor: colors.text },
          {
            opacity: intro,
            transform: [
              { translateY: scrolled },
              { translateX: pearTranslateX },
              { translateX: introX },
              { translateY: pearTranslateY },
              { scale: pearScale },
              { scale: finishScale },
              { rotate: pearRotate },
              { rotate: introRotate },
            ],
          },
        ]}
      />
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <Animated.ScrollView
          ref={scroll}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
          scrollEventThrottle={16}
          contentContainerStyle={[styles.content, { paddingTop: step === 0 ? height * 0.52 : top + width * 0.36, paddingBottom: bottom + spacing.lg }]}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View style={[styles.flex, contentStyle]}>
            {step === 0 && (
              <View style={styles.block}>
                <Text style={styles.title}>{t('priseEnMain.bienvenue')}</Text>
                <Text style={styles.text}>{t('priseEnMain.presentation')}</Text>
                <View style={styles.spacer} />
                <Button label={t('priseEnMain.commencer')} icon={ChevronRight} onPress={() => goTo(1)} />
              </View>
            )}
            {step === 1 && (
              <View style={styles.block}>
                <Text style={styles.title}>{t('priseEnMain.autorisations')}</Text>
                <Text style={styles.text}>{t('priseEnMain.autorisationsAide')}</Text>
                <View style={styles.rows}>
                  {ROWS.map(({ id, icon }) => (
                    <PermissionRow key={id} id={id} icon={icon} state={states?.[id] ?? 'missing'} onPress={() => ask(id)} />
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
                <View style={!allGranted && styles.disabled} pointerEvents={allGranted ? 'auto' : 'none'}>
                  <Button label={t('priseEnMain.suivant')} icon={ChevronRight} onPress={afterPermissions} />
                </View>
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
          </Animated.View>
        </Animated.ScrollView>
      </KeyboardAvoidingView>
    </Animated.View>
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
    top: 0,
    left: 0,
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
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  rowText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  rowAction: {
    minWidth: 92,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  allow: {
    paddingHorizontal: spacing.md,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    justifyContent: 'center',
  },
  allowLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.onAccent,
  },
  okBadge: {
    position: 'absolute',
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  okLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.onAccent,
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
