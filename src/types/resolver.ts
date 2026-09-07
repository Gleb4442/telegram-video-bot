export type SupportedPlatform =
  | 'tiktok'
  | 'instagram'
  | 'youtube'
  | 'twitter'
  | 'reddit'
  | 'threads'
  | 'pinterest';

export interface MediaItem {
  type: 'video' | 'photo';
  url: string;
}

export interface ResolvedVideo {
  directUrl: string;
  title?: string;
  platform: SupportedPlatform;
  audioUrl?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  author?: string;
  isAlbum?: boolean;
  albumItems?: MediaItem[];
}

export interface VideoResolver {
  readonly name: string;
  readonly platform: SupportedPlatform;
  supports(url: string): boolean;
  resolve(url: string): Promise<ResolvedVideo>;
}

export class ResolverError extends Error {
  constructor(
    message: string,
    public readonly platform: SupportedPlatform,
    public readonly code:
      | 'NOT_FOUND'
      | 'PRIVATE_OR_DELETED'
      | 'RATE_LIMITED'
      | 'TIMEOUT'
      | 'SCRAPER_DOWN'
      | 'UNSUPPORTED'
      | 'UNKNOWN',
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ResolverError';
  }
}
