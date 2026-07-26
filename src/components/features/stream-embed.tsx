/**
 * Embedded livestream (D10, screen [1]).
 *
 * The stream is the centre of the spectator experience, so the URL an operator
 * pastes has to work whatever form they paste it in — a watch link, a share
 * link, a live link, or an embed URL. Anything that is not recognisably a
 * YouTube URL renders nothing rather than an iframe pointing at an arbitrary
 * origin.
 */

/** Extract a YouTube video id from the URL forms an operator might paste. */
export function youtubeVideoId(rawUrl: string | null): string | null {
  if (!rawUrl) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');
  const isYouTube =
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'youtube-nocookie.com' ||
    host === 'youtu.be';
  if (!isYouTube) return null;

  // youtu.be/<id>
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return isVideoId(id) ? id : null;
  }

  // youtube.com/watch?v=<id>
  const queryId = url.searchParams.get('v');
  if (isVideoId(queryId)) return queryId;

  // youtube.com/{embed,live,shorts}/<id>
  const segments = url.pathname.split('/').filter(Boolean);
  if (
    segments.length >= 2 &&
    ['embed', 'live', 'shorts', 'v'].includes(segments[0]!)
  ) {
    return isVideoId(segments[1]) ? segments[1]! : null;
  }

  return null;
}

function isVideoId(value: string | null | undefined): value is string {
  // YouTube ids are 11 characters of URL-safe base64. Validating the shape
  // stops a malformed path segment becoming part of an embed URL.
  return typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value);
}

export function StreamEmbed({
  url,
  title = 'The Circuit livestream',
}: {
  url: string | null;
  title?: string;
}) {
  const videoId = youtubeVideoId(url);

  if (!videoId) {
    return (
      <div className="border-border bg-muted/30 flex aspect-video w-full items-center justify-center rounded-xl border border-dashed">
        <div className="px-6 text-center">
          <p className="font-medium">The stream is not live yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Commentary starts with the knockout rounds.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="border-border bg-card aspect-video w-full overflow-hidden rounded-xl border">
      <iframe
        // `-nocookie` so a visitor who never interacts with the player is not
        // tracked by it; the spectator page is public and mostly anonymous.
        src={`https://www.youtube-nocookie.com/embed/${videoId}`}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        className="size-full"
      />
    </div>
  );
}
