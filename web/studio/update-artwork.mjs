import { writeFile, mkdir } from 'node:fs/promises';

// Public catalog metadata only: no AniList token or user data is needed.
const titles = [
  ['demo-frieren', "Sousou no Frieren"],
  ['demo-apothecary', 'Kusuriya no Hitorigoto'],
  ['demo-dandadan', 'Dandadan'],
  ['demo-dungeon', 'Dungeon Meshi'],
  ['demo-onepiece', 'One Piece'],
];
const selections = titles.map(([, title], index) => `anime${index}: Media(search: ${JSON.stringify(title)}, type: ANIME, sort: SEARCH_MATCH) {
  id siteUrl title { english romaji } coverImage { extraLarge large medium color } bannerImage
}`).join('\n');
const response = await fetch('https://graphql.anilist.co', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify({ query: `query StudioArtwork { ${selections} }` }),
  signal: AbortSignal.timeout(20000),
});
if (!response.ok) throw new Error(`AniList request failed: HTTP ${response.status}`);
const payload = await response.json();
if (payload.errors?.length) throw new Error(`AniList query failed: ${payload.errors.map(error => error.message).join('; ')}`);
const artwork = {};
for (const [index, [key]] of titles.entries()) {
  const media = payload.data?.[`anime${index}`];
  if (!media?.id || !media.coverImage?.large) throw new Error(`Missing AniList artwork for ${key}`);
  const image = new URL(media.coverImage.large);
  if (image.protocol !== 'https:' || image.hostname !== 's4.anilist.co') throw new Error(`Unexpected artwork host for ${key}`);
  artwork[key] = { anilistId: media.id, title: media.title.english || media.title.romaji, sourceUrl: media.siteUrl, cover: media.coverImage.large, coverLarge: media.coverImage.extraLarge || media.coverImage.large, coverSmall: media.coverImage.medium || media.coverImage.large, color: media.coverImage.color || '#526764', banner: media.bannerImage || null };
  console.log(`${key}: ${artwork[key].title} (AniList ${media.id})`);
}
await mkdir(new URL('data/', import.meta.url), { recursive: true });
await writeFile(new URL('data/anilist-artwork.json', import.meta.url), JSON.stringify(artwork, null, 2) + '\n');
console.log('Updated five catalog entries. Normal builds use this snapshot without making API requests.');
