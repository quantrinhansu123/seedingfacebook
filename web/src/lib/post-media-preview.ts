export type MediaPreviewKind = 'none' | 'image' | 'video' | 'youtube' | 'link';

export type MediaPreview = {
  kind: MediaPreviewKind;
  src?: string;
  embedUrl?: string;
};

function youtubeId(url: string): string {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/i,
  );
  return match?.[1] || '';
}

export function resolveMediaPreview(url: string): MediaPreview {
  const candidate = String(url || '').trim();
  if (!candidate) return { kind: 'none' };

  const yt = youtubeId(candidate);
  if (yt) {
    return {
      kind: 'youtube',
      src: candidate,
      embedUrl: `https://www.youtube.com/embed/${yt}`,
    };
  }

  if (/\.(mp4|mov|m4v|webm)(\?|$)/i.test(candidate)) {
    return { kind: 'video', src: candidate };
  }

  if (
    /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i.test(candidate)
    || /^blob:/i.test(candidate)
    || /supabase|comment-images|uploads|storage/i.test(candidate)
  ) {
    return { kind: 'image', src: candidate };
  }

  if (/youtube|youtu\.be|tiktok|facebook|fb\.|instagram/i.test(candidate)) {
    return { kind: 'link', src: candidate };
  }

  return { kind: 'image', src: candidate };
}
