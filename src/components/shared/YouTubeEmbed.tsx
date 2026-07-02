// Reusable YouTube embed (privacy-enhanced no-cookie origin).
// Replace the placeholder video IDs below with your own IDs.
//
// How to get the ID:
//   - https://www.youtube.com/watch?v=VIDEO_ID  -> use the v=... value
//   - https://youtu.be/VIDEO_ID                 -> use the path segment
//
// Home intro:       <YOUR_HOME_VIDEO_ID>
// Network tutorial: <YOUR_NETWORK_VIDEO_ID>

import { cn } from "@/lib/utils";

interface YouTubeEmbedProps {
  videoId: string;
  title: string;
  className?: string;
}

export function YouTubeEmbed({ videoId, title, className }: YouTubeEmbedProps) {
  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-lg border border-border bg-black shadow-sm",
        className
      )}
    >
      <div className="aspect-video w-full">
        <iframe
          className="h-full w-full"
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
        />
      </div>
    </div>
  );
}
