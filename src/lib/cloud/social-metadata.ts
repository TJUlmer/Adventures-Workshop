/**
 * The words and artwork a shared-set link presents before somebody opens it.
 *
 * Kept free of Svelte, browser APIs and `$lib` imports so the Vercel Edge
 * middleware can use the exact same decisions as the creator preview. A
 * preview that merely resembles the unfurl is worse than none: it tells an
 * author they checked something the receiving service was never sent.
 */
export interface SocialMetadataSource {
  name: string;
  subtitle: string;
  social_image_url: string;
  thumbnail_url: string;
  character_count: number;
  card_count: number;
  hero_count: number;
  scope: 'full' | 'hero' | 'villain';
  kind: 'adventure' | 'heroes' | null;
}

export interface SocialMetadata {
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  typeLabel: string;
}

const SITE_NAME = 'Unmatched Labs';

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function typeLabel(source: SocialMetadataSource): string {
  if (source.scope === 'hero') return 'Fan-made Unmatched hero';
  if (source.scope === 'villain') return 'Fan-made Unmatched villain side';
  if (source.kind === 'adventure') return 'Fan-made Unmatched Adventures set';
  if (source.kind === 'heroes' && source.hero_count === 1) return 'Fan-made Unmatched hero';
  if (source.kind === 'heroes') return 'Fan-made Unmatched heroes set';
  return 'Fan-made Unmatched set';
}

export function socialMetadata(
  source: SocialMetadataSource | null,
  authorName = ''
): SocialMetadata {
  if (!source) {
    return {
      title: SITE_NAME,
      description: 'A local-first builder for custom Unmatched sets.',
      image: '',
      imageAlt: '',
      typeLabel: 'Unmatched set'
    };
  }

  const title = source.name.trim() || SITE_NAME;
  const kind = typeLabel(source);
  const stats = [
    countLabel(source.character_count, 'character'),
    countLabel(source.card_count, 'card')
  ].join(' · ');
  const description = [
    source.subtitle.trim(),
    kind,
    stats,
    authorName.trim() ? `By ${authorName.trim()}` : ''
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    title,
    description,
    image: source.social_image_url || source.thumbnail_url || '',
    imageAlt: `Preview artwork for ${title}${authorName.trim() ? ` by ${authorName.trim()}` : ''}`,
    typeLabel: kind
  };
}

export { SITE_NAME };
