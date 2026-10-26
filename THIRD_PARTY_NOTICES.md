# Third-party notices

## Geist

The extension bundles the Latin variable font from [Geist by Vercel](https://github.com/vercel/geist-font). The font was obtained from Google Fonts and is distributed under the SIL Open Font License 1.1. Its copyright notice and full license are included in [extension/assets/fonts/OFL.txt](extension/assets/fonts/OFL.txt). The font loads from the extension package; there is no runtime Google Fonts request.

## Country and region membership

The factual country and area groupings follow [UN M49](https://unstats.un.org/unsd/methodology/m49/overview/), consulted on October 25, 2026. The North America grouping combines Northern America, Central America, and the Caribbean.

## Development references

Chrome's [popup documentation](https://developer.chrome.com/docs/extensions/develop/ui/add-popup) and [extension security guidance](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security) informed the packaging and UI boundaries. Initial endpoint research consulted [X-Posed](https://github.com/xaitax/x-account-location-device/tree/8cd76d053584e5bd5c5d3b7dea37566b0f99fcb1); the extension implementation is separate, and live X responses were used to verify the fields.

The popup design used the [Taste skill](https://github.com/Leonxlnx/taste-skill/tree/main/skills/taste-skill) as guidance. The skill's implementation is not bundled in the extension. Development dependencies and their licenses are recorded in the npm lockfile and installed packages; none ship as extension runtime code.
