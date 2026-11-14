import type { StyleSpecification } from '@maplibre/maplibre-react-native';

// Le style de carte de Pear, en deux versions qui suivent le thème. Sombre (planche « Carte ») : un fond
// vert très sombre, des routes à peine plus claires, l'eau en bleu nuit, les parcs en vert profond.
// Clair : un fond crème à peine vert, des routes blanches, l'eau bleu pâle, les parcs vert tendre.
// Les noms restent discrets dans les deux. Il réutilise
// la source et la police des styles d'OpenFreeMap téléchargés avec la zone : tout vient du téléphone,
// rien n'est demandé au réseau.

export type MapColors = typeof MAP_COLORS;

export const MAP_COLORS = {
  background: '#121613',
  park: '#18241A',
  wood: '#162117',
  residential: '#141A15',
  water: '#22303A',
  waterway: '#22303A',
  building: '#171D18',
  minor: '#1C221D',
  major: '#20261F',
  motorway: '#1F2720',
  rail: '#1A201B',
  label: '#6E7A70',
  labelStrong: '#8E998F',
  halo: '#121613',
};

export const MAP_COLORS_LIGHT: MapColors = {
  background: '#F3F4EE',
  park: '#DCE8CF',
  wood: '#E1EBD6',
  residential: '#EEEFE8',
  water: '#CFE0EA',
  waterway: '#C3D7E3',
  building: '#E6E7E0',
  minor: '#FFFFFF',
  major: '#FFFFFF',
  motorway: '#FBF6E6',
  rail: '#DCDDD6',
  label: '#7A8479',
  labelStrong: '#4F5A50',
  halo: '#F3F4EE',
};

const ROAD_WIDTH = (base: number) => ['interpolate', ['exponential', 1.5], ['zoom'], 10, base * 0.4, 14, base, 18, base * 4] as unknown as number;

function styleFor(MAP_COLORS: MapColors, name: string): StyleSpecification {
  return {
  version: 8,
  name,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': MAP_COLORS.background } },
    { id: 'residential', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse', filter: ['==', ['get', 'class'], 'residential'], paint: { 'fill-color': MAP_COLORS.residential } },
    { id: 'wood', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass', 'farmland']]], paint: { 'fill-color': MAP_COLORS.wood } },
    { id: 'park', type: 'fill', source: 'openmaptiles', 'source-layer': 'park', paint: { 'fill-color': MAP_COLORS.park } },
    { id: 'landuse-park', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['park', 'cemetery', 'pitch', 'garden']]], paint: { 'fill-color': MAP_COLORS.park } },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': MAP_COLORS.water } },
    { id: 'waterway', type: 'line', source: 'openmaptiles', 'source-layer': 'waterway', paint: { 'line-color': MAP_COLORS.waterway, 'line-width': ROAD_WIDTH(2) } },
    { id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': MAP_COLORS.building } },
    { id: 'rail', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', filter: ['==', ['get', 'class'], 'rail'], paint: { 'line-color': MAP_COLORS.rail, 'line-width': ROAD_WIDTH(1.5) } },
    {
      id: 'road-minor',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'track', 'path']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': MAP_COLORS.minor, 'line-width': ROAD_WIDTH(4) },
    },
    {
      id: 'road-major',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary', 'tertiary', 'trunk']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': MAP_COLORS.major, 'line-width': ROAD_WIDTH(8) },
    },
    {
      id: 'road-motorway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['==', ['get', 'class'], 'motorway'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': MAP_COLORS.motorway, 'line-width': ROAD_WIDTH(11) },
    },
    {
      id: 'road-name',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
      minzoom: 14,
      layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11 },
      paint: { 'text-color': MAP_COLORS.label, 'text-halo-color': MAP_COLORS.halo, 'text-halo-width': 1.2 },
    },
    {
      id: 'place',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'village', 'suburb', 'neighbourhood']]],
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': ['match', ['get', 'class'], 'city', 15, 'town', 13, 12] },
      paint: { 'text-color': MAP_COLORS.labelStrong, 'text-halo-color': MAP_COLORS.halo, 'text-halo-width': 1.4 },
    },
  ],
  };
}

export const PEAR_MAP_STYLE = styleFor(MAP_COLORS, 'Pear');
export const PEAR_MAP_STYLE_LIGHT = styleFor(MAP_COLORS_LIGHT, 'Pear clair');

export const mapStyleOf = (dark: boolean) => (dark ? PEAR_MAP_STYLE : PEAR_MAP_STYLE_LIGHT);
export const mapColorsOf = (dark: boolean) => (dark ? MAP_COLORS : MAP_COLORS_LIGHT);
