# Railway display fonts

Self-hosted Google Fonts for the two passenger information displays. The rest of the app keeps its existing typography.

- **BIZ UDGothic Bold** by Morisawa: the in-car LCD's legible Japanese signage typography. https://fonts.google.com/specimen/BIZ+UDGothic
- **DotGothic16** by Fontworks: the departure board's matrix-style train numbers, clocks and times. https://fonts.google.com/specimen/DotGothic16
- **Noto Sans SC Semibold**: simplified Chinese coverage, including user-defined station names. https://fonts.google.com/noto/specimen/Noto+Sans+SC

Downloaded from the Google Fonts CSS API and converted to WOFF2 using FontTools. Noto Sans SC is pinned to weight 600. All are licensed under the SIL Open Font License 1.1; the complete licenses and copyright notices are adjacent `*-OFL.txt` files. No runtime font service or network access is needed.

On the LCD, BIZ UDGothic is followed by Noto Sans SC for missing simplified Chinese glyphs. On the departure board, Noto Sans SC handles Chinese while DotGothic16 handles the numerical information, preserving readable Chinese rather than approximating missing glyphs.
