# Popup design

The popup answers: which filters are active, and are they doing anything in this feed? It is a short settings visit in a browser action, not a dashboard.

The design follows Taste skill's Achromatic ledger direction, seed 1474212302, with no redraw. The layout adapts the settings pattern to a 420-pixel popup, with a shared 24-pixel inset. It uses locally bundled Geist, neutral controls, flat surfaces, and a small status signal. The three receding lines in the mark refer to a filtered feed. Region chips and the inline explanation of shared-post coverage make the interface specific to this extension.

The first screen holds the master switch, connection/feed feedback, region controls, and the account age switch. Coverage and activity expand when needed. Counts come from the worker; missing feed data asks the user to open X instead of showing a fabricated zero. There are no sample totals in the shipped interface.

The popup is checked at 420, 390, and 360 pixels. Native details and form controls preserve keyboard behavior. Motion is limited to the toggle, with reduced-motion support. The help page uses the same local typeface and neutral palette.

The Taste inspector's static HTTP rendering cannot access Chrome extension storage or worker messaging. Its layout measurements cover the loading shell; the browser suite loads the actual extension for populated controls, saved settings, error states, and screenshots. The screenshot in the README shows the actual extension before connecting to X.

The static inspector reports no failures and one text-size warning because the loading shell is mostly help text. Primary labels and controls use 13–14 pixels, the product name uses 20 pixels, and secondary explanations use 12 pixels. This keeps the normal 420-pixel popup within the browser's 600-pixel height while retaining readable contrast. Populated extension screens were also inspected at all three widths.
