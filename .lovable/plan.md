# Plan: Add YouTube video embeds to home page and network view tutorial

## Goal
Add clean, professional YouTube video embeds to:
1. The home page (`/`) — a new full-width introduction video section.
2. The Network view tutorial help page (`/help/network-sci`) — a video tutorial embedded in the article.

Both will use the privacy-enhanced `youtube-nocookie.com` embed with placeholder IDs that you can replace.

## Design direction

- Reusable `YouTubeEmbed` component: responsive 16:9 aspect ratio, lazy-loaded iframe, rounded border, subtle shadow, and a title prop for accessibility.
- No external dependencies; use the existing shadcn card and aspect-ratio utilities.
- Keep the UI consistent with the current SuReSuite style: restrained borders, high contrast, and generous spacing.

## What will change

### 1. New component: `src/components/shared/YouTubeEmbed.tsx`

A thin wrapper around an iframe with:

- `videoId` prop
- `title` prop for screen readers
- `youtube-nocookie.com` origin
- `loading="lazy"` attribute
- `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"`
- `allowFullScreen`
- Responsive 16:9 wrapper using `aspect-ratio` Tailwind utility

Placeholder constant: `PLACEHOLDER_VIDEO_ID = "dQw4w9WgXcQ"` — clearly marked to replace.

### 2. Home page: `src/pages/GettingStarted.tsx`

Insert a new section between the hero intro and the "Core Capabilities" section.

- Section title: "See SuReSuite in action"
- Subtitle: short one-line description
- Centered, max-width video card (max 900px) on a clean background
- Button: "View full tutorial" link to `/help/network-sci`

Use the `Section` component already defined in the file to keep the layout consistent.

### 3. Network view tutorial: `src/pages/About.tsx`

Add a video block inside the `network-sci` doc body, near the top of the section after the opening paragraph.

- Label: "Video walkthrough: exploring the network view"
- Place it before the metrics table.

### 4. Placeholder instructions

I will add a comment at the top of `YouTubeEmbed.tsx` and next to each usage with:

```
// Replace with your actual YouTube video ID.
// Home intro: <YOUR_HOME_VIDEO_ID>
// Network tutorial: <YOUR_NETWORK_VIDEO_ID>
```

To find the video ID from a YouTube URL like `https://www.youtube.com/watch?v=abc123XYZ`, use the `v=abc123XYZ` value. From `https://youtu.be/abc123XYZ`, use the path segment `abc123XYZ`.

## Files to modify

1. `src/components/shared/YouTubeEmbed.tsx` (new)
2. `src/pages/GettingStarted.tsx` (new intro video section)
3. `src/pages/About.tsx` (video in `network-sci` doc body)

## How to verify

1. Open the home page and confirm the new "See SuReSuite in action" section appears with the embedded video frame.
2. Navigate to `/help/network-sci` and confirm the tutorial video appears at the top of the article.
3. Inspect each iframe and confirm the `src` uses `https://www.youtube-nocookie.com/embed/...`.
4. Replace the placeholder IDs with your real YouTube IDs and reload to verify the correct videos load.

## Out of scope

- No custom video player or lightbox.
- No auto-play; videos load on click only.
- No playlist integration or chapter timestamps.
- No backend changes.