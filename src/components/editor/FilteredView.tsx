import { ReactNode } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { Step, tintsOf, viewFiltersOf } from './filters';

// Applique un filtre à ce qu'elle contient (photo, vidéo, aperçu de la caméra) par les filtres de vue
// d'Android, calculés par la carte graphique : assez rapide pour suivre le doigt et l'image en direct.
// Les formules sont celles de la matrice du fichier final. Le fané et la température se posent en
// voile par-dessus (exact pour le fané, approché pour la température).
export function FilteredView({ steps, style, children }: { steps: Step[]; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const filters = viewFiltersOf(steps);
  return (
    <View pointerEvents="box-none" style={style}>
      <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, filters.length > 0 && { filter: filters }]}>
        {children}
      </View>
      {tintsOf(steps).map((tint, index) => (
        <View key={index} pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tint.color, opacity: tint.opacity }]} />
      ))}
    </View>
  );
}
