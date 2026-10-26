# Changelog

## 0.6.0

- Reuse regions shown on About pages and update open feeds without a second lookup.
- Keep a disconnected tab from pausing checks in every tab.
- Add a per-tab hidden-post badge and colored toolbar icon.
- Fix the popup’s narrow window sizing and shorten its copy.
- Include South Asia and other familiar region names in the picker.

## 0.5.1

- Start new installations with an empty region list while preserving saved choices on update.
- Replace the README popup screenshot with a product banner.

## 0.5.0

- Reorganized the extension into a standalone repository with portable tests, CI, and repeatable ZIP packaging.
- Redesigned the popup with bundled Geist type, clearer filter controls, save feedback, and expandable activity details.
- Added keyboard focus handling, duplicate-label feedback, and explicit settings and status failure states.
- Reworked help and privacy documentation and added extension icons.
- Preserved region and age matching, shared-post handling, placeholders, cache policy, and request limits.

## 0.4.0

- Added the three-calendar-month account age rule using the same About response as the region lookup.
- Preserved existing region-only cache entries until their normal refresh.

## 0.3.0

- Added shared About quota tracking and a reserve for manual About visits.
- Reduced automatic lookup starts to 20 per rolling 15 minutes, with a 30-second gap.

## 0.2.0

- Corrected Authorization forwarding and read the current CSRF cookie for each lookup.

## 0.1.0

- Added local region filtering for Home and Lists, including rendered repost and quote authors.
