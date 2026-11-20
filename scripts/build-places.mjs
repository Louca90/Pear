// Construit src/components/editor/places.ts, la liste de lieux embarquée (aucun serveur interrogé),
// depuis le fichier cities500.txt de GeoNames (https://download.geonames.org/export/dump/cities500.zip,
// licence CC BY 4.0). Usage : node scripts/build-places.mjs <chemin de cities500.txt>
//
// Dense là où vivent les utilisateurs de Pear (France et pays voisins francophones : toutes les
// communes de plus de 500 habitants), plus les villes de plus de 5 000 habitants des autres pays
// voisins. Le reste du monde garde la courte liste de grandes villes de cities.ts.
import fs from 'node:fs';

const DENSE = new Set(['FR', 'CH', 'BE', 'LU', 'MC', 'AD']);
const NEAR = new Set(['IT', 'DE', 'ES', 'PT', 'GB', 'IE', 'NL', 'AT']);
// Lieux habités, sans les quartiers (PPLX) ni les lieux abandonnés, détruits ou historiques.
const KEEP = /^PPL(A\d?|C|F|L|S|G)?$/;

const source = process.argv[2];
if (!source) throw new Error('Chemin de cities500.txt manquant');
const out = [];
for (const line of fs.readFileSync(source, 'utf8').split('\n')) {
  const cols = line.split('\t');
  if (cols.length < 15) continue;
  const [, name, , , lat, lon, , code, country] = cols;
  const population = Number(cols[14]) || 0;
  if (!KEEP.test(code)) continue;
  if (!(DENSE.has(country) || (NEAR.has(country) && population >= 5000))) continue;
  // Au millième de degré (une centaine de mètres) : assez pour trouver la commune la plus proche.
  out.push(`${name.replace(/[|;]/g, ' ')};${Math.round(Number(lat) * 1000)};${Math.round(Number(lon) * 1000)}`);
}
out.sort();
const file = `// Fichier généré par scripts/build-places.mjs : ne pas modifier à la main.
// Noms de lieux © GeoNames (www.geonames.org), licence CC BY 4.0. « nom;latitude×1000;longitude×1000 »,
// séparés par « | ».
export const PLACES = ${JSON.stringify(out.join('|'))};
`;
fs.writeFileSync('src/components/editor/places.ts', file);
console.log(out.length, 'lieux,', Math.round(file.length / 1024), 'Ko');
