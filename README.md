# Kawtar — Café · Bistro Marocain

A cinematic single-page site for a Moroccan café/bistro, built from the
Claude Design handoff **"Kawtar Cafe Bistro v2.dc.html"**.

## Experience

- **Desktop (mouse, ≥1024px):** a wheel-driven **horizontal scroll** stage —
  9 full-screen panels slide left/right with per-element parallax, a top
  progress bar, a panel-dot indicator, and a "Faites défiler" cue.
- **Mobile / touch / reduced-motion:** the same panels gracefully **stack
  vertically** with scroll-reveal animations and a full-screen slide-in nav.

Mode is chosen at runtime via `matchMedia('(min-width:1024px) and (pointer:fine)')`
and re-evaluated on resize.

## Panels

Accueil (hero) · Histoire · Entrées · Tajines & Couscous · Sandwichs & Desserts ·
Boissons · Galerie · Citation · Nous trouver.

The menu content (FR, CAD) was transcribed from the owner's photographed menu
boards in `menu-source/` — the photos themselves are **not** used on the site.

## Stack

Plain static HTML/CSS/JS — no build step, no framework.

```
index.html          all markup + reservation modal
css/styles.css      design tokens, components, horizontal/vertical modes
js/main.js          mode switch, horizontal engine, reveals, nav, modal, counters
assets/brand/       Kawtar logo / icon / lockup (owner-supplied)
assets/photos/      6 cinematic images (see below)
menu-source/        owner's menu board photos + image-gen script (reference only)
```

## Imagery

The 6 atmospheric photos in `assets/photos/` were generated with **nano-banana
(Gemini 2.5 Flash Image) via fal.ai** — see `menu-source/gen_images.py`.
Regenerate with:

```bash
set -a && . ~/Claude/Projects/shared-keys/fal.env && set +a
python3 menu-source/gen_images.py
```

## Run locally

```bash
python3 -m http.server 8175 --directory "/Users/inder/Claude/Projects/Kawtar Cafe"
```

Or use the Claude Code preview server named **`kawtar`** (port 8175).

## Interactive Tajine (Apple-style pinned scroll)

The `#p-tajine` panel is a scroll-pinned product showcase (à la apple.com): a giant
tajine stays centred while scroll drives the sequence — a **Higgsfield** lid-opening
video (`assets/video/tajine-open.mp4`, Seedance i2v, closed→chicken) scrubs open,
then four dish stills cross-fade **Chicken → Beef → Vegetarian → Seafood** with the
name/subtitle and step-dots changing. Stills in `assets/tajine/` are nano-banana:
one `dish-chicken.jpg` (text→image) then edits (`dish-beef/veg/seafood`, `tajine-closed`)
so the tajine, angle, table and light stay identical for clean morphs.

Mechanics in `js/main.js` (`updateTajine(p)`): **horizontal mode** gives the panel
`flex:0 0 280vw` and counter-translates `.tajine-stage` so it pins while the wide
panel traverses; **vertical mode** makes the panel `340vh` with a `position:sticky`
stage. If the video is missing it falls back to the `tajine-closed.jpg` lid lifting.
> Gotcha: `position:sticky` needs **no `overflow:hidden` ancestor** — the tajine
> panel is `overflow:visible` in vertical mode for this reason.

## Video reels + socials

The **Kawtar en vidéo / Kawtar on video** panel (`#p-reels`) shows three real
Instagram/TikTok reels (`assets/video/reel-1..3.mp4`, 9:16) in phone-frame cards:
muted autoplay-on-view (IntersectionObserver, paused off-screen, with a
first-interaction unlock for strict autoplay policies), **tap a card to unmute**
(solo — others re-mute). Below them, **Instagram** (`@cafebistrokawtar`) and
**TikTok** (`@cafe_bistro_kawtar`) follow buttons; both also linked in the Visit
panel. Two real dish photos the owner supplied live in `assets/photos/`
(`dish-prunes.jpg` → gallery card 1; `menu-spread.jpg` → reels backdrop).

## Scroll-scrubbed video

`assets/video/tea-pour.mp4` is a **Kling** image-to-video clip (via fal.ai,
seeded from `assets/photos/about.jpg`) of mint tea pouring into a glass. It lives
in the **Histoire** panel and is **scrubbed by scroll position** (no autoplay) —
the glass fills as you scroll. Driven by `applyScrub()` in `js/main.js`:
horizontal mode maps the panel's normalized position; vertical mode maps its
viewport rect. Regenerate via `menu-source/kling_poll.py` (uses `kling_req.json`).

## Bilingual (FR / EN)

French is the default; an **FR / EN toggle** in the nav switches the whole page.
Translations live inline on each element as `data-en="…"` (and `data-en-ph` for
input placeholders); `applyLang()` in `js/main.js` swaps `innerHTML`, updates
`<html lang>`, and persists the choice to `localStorage` (`kawtarLang`). The
reservation confirmation message is built per-language in JS.

## Real venue data

Address, hours and phones in **Nous trouver** are the real Laval business,
confirmed against **kawtar.ca** (Mon closed; Tue 9–19, Wed 9–20, Thu 9–21,
Fri/Sat 9–22, Sun 9–19). Also emitted as `Restaurant` JSON-LD in `<head>`.

## Grounded to the real bistro

Per the owner's interior photo, this is a small, casual neighbourhood café —
copy and imagery were toned down accordingly (no "candlelit hall" / "floor
cushions"). The middle gallery image is now Moroccan pastries + mint tea on a
bistro table.

## Scroll animations

Vertical mode uses staggered, directional reveals (`data-rv="left|right|scale|up"`,
cascaded via JS `transition-delay`) plus scroll-linked **parallax** on background
images (`data-parallax`). Horizontal mode keeps the per-panel "pop-up" entrance.

## Notes / to confirm with owner

- The supplied logo lockup reads **"CAFÉ · BTSTRO"** (a typo baked into the
  brand image). Site text uses the correct "Café · Bistro". Replace the asset
  or have it corrected if desired.
- The reservation form is front-end only (no backend); on submit it shows a
  confirmation. Wire it to email/booking when ready.
