# Popup design

The popup answers: which filters are active, and are they doing anything in this feed? It is a short settings visit in a browser action, not a dashboard.

The design follows Taste skill's Achromatic ledger direction, seed 1474212302, with no redraw. The layout adapts the settings pattern to a 460-pixel popup, with a shared 24-pixel inset. It uses locally bundled Geist, neutral controls, flat surfaces, and a small status signal. The three receding lines in the mark refer to a filtered feed. Region chips and the inline explanation of shared-post coverage make the interface specific to this extension.

The first screen holds the master switch, connection/feed feedback, region controls, and the account age switch. Coverage and activity expand when needed. Counts come from the worker; missing feed data asks the user to open X instead of showing a fabricated zero. There are no sample totals in the shipped interface.

The document has an explicit 460-pixel intrinsic width so Chromium cannot shrink-wrap it to 250 pixels. Layout checks include a 16-pixel minimum font and four selected regions. Native details and form controls preserve keyboard behavior. Motion is limited to the toggle, with reduced-motion support. The help page uses the same local typeface and neutral palette.

The Taste inspector's static HTTP rendering cannot access Chrome extension storage or worker messaging. Its layout measurements cover the loading shell; the browser suite loads the actual extension for populated controls, saved settings, error states, and screenshots. Test screenshots stay in the ignored test-results directory. The README uses a separate product banner.

The popup keeps short status labels and puts explanations in Help. The toolbar and popup use the same teal filter icon with a lime dot, drawn in the editable SVG source and rasterized at the browser’s required sizes. The count badge uses dark teal with white text.

## README banner

The README banner uses the product name, a filter mark, and an abstract feed illustration. It contains no account examples or selected countries. The built-in image-generation tool created the [banner](images/banner.png); the [generation prompt](images/banner-prompt.txt) records its composition and exact text. The final PNG is 2172 by 724 pixels and scales to the README width.
