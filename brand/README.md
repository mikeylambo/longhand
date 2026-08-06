# Foolscap logo source

Confirmed direction: use the collaborative negative-space **F** for the app icon, splash, and favicon. Keep the existing line-nib glyph for the **Draw** tab so the tab bar remains a consistent monochrome navigation system.

## Files

- `foolscap-mark.svg` — canonical source. Transparent background, six flat ink regions, and a true transparent negative-space **f**. It contains no fonts, embedded rasters, filters, or blend modes.
- `foolscap-mark-flat-2048.png` — transparent 2048 px render of the vector with icon-safe padding.
- `foolscap-mark-textured-2048.png` — transparent 2048 px reference preserving the generated raster's paper/ink character. Use this for visual matching, not tiny icons.
- `foolscap-icon-master-2048.png` — flat vector render on the app's warm cream background.

## Palette

| Role | Hex |
| --- | --- |
| App cream | `#E7E0D2` |
| Teal | `#26464E` |
| Brick red | `#B43E29` |
| Ochre | `#C07D2D` |
| Teal/red overlap | `#1C1F1B` |
| Teal/ochre overlap | `#292C1C` |
| Red/ochre overlap | `#56271A` |
| UI ink / suggested mono | `#1B1A17` |

## Production notes

- Generate small raster icons from `foolscap-mark.svg`, not from the concept board.
- The supplied 2048 masters keep the mark within roughly 80% of the square canvas. Re-apply the platform's required maskable safe-area inset when creating the dedicated maskable asset.
- At 22 px and above the negative-space **f** remains clear. For a 16 px favicon, make an optical variant by opening the **f** counters slightly rather than changing the master.
- Use the app's existing old-style serif for the splash wordmark; the generated concept-board lettering is not embedded in the SVG.
