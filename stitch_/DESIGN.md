---
name: Executive Stream Intelligence
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#434655'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#006c4a'
  on-secondary: '#ffffff'
  secondary-container: '#82f5c1'
  on-secondary-container: '#00714e'
  tertiary: '#943700'
  on-tertiary: '#ffffff'
  tertiary-container: '#bc4800'
  on-tertiary-container: '#ffede6'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#85f8c4'
  secondary-fixed-dim: '#68dba9'
  on-secondary-fixed: '#002114'
  on-secondary-fixed-variant: '#005137'
  tertiary-fixed: '#ffdbcd'
  tertiary-fixed-dim: '#ffb596'
  on-tertiary-fixed: '#360f00'
  on-tertiary-fixed-variant: '#7d2d00'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-bold:
    fontFamily: Inter, Noto Sans SC
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.02em
  heading-md:
    fontFamily: Inter, Noto Sans SC
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-base:
    fontFamily: Inter, Noto Sans SC
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter, Noto Sans SC
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-caps:
    fontFamily: Inter, Noto Sans SC
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  data-mono:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  container-padding: 24px
  gutter: 16px
  component-gap-tight: 4px
  component-gap-base: 8px
  section-margin: 32px
---

## Brand & Style

This design system is engineered for the high-stakes environment of enterprise live-streaming strategy. The brand personality is **authoritative, analytical, and precise**, designed to instill confidence in executive-level decision-makers. 

The visual style follows a **Corporate / Modern** aesthetic with a heavy emphasis on **Minimalism**. By prioritizing a neutral canvas, we allow the complex data streams—categorized by high-chroma health and grade indicators—to remain the focal point. The interface avoids decorative flourishes, opting instead for a "data-first" architecture that maximizes information density without sacrificing clarity. The emotional response is one of controlled efficiency and clarity amidst high-volume live data.

## Colors

The color strategy utilizes a neutral slate background (`#F8FAFC`) to provide a clinical environment for data visualization. 

- **Primary & Action:** Blue (`#2563EB`) serves as the primary action color and represents 'A-Grade' performance, suggesting stability.
- **Categorical Identity:** Specific hues are reserved for line-of-business tracking (Emerald for Health, Pink for Beauty, Purple for Interest).
- **Performance Grading:** A distinct hierarchy from Amber Gold (S-Grade) down to Gray (C-Grade) allows for immediate visual scanning of stream quality.
- **Status & Alerts:** Red is strictly reserved for critical conflicts or scheduling dangers, ensuring high signal-to-noise ratios.

## Typography

The typography system leverages **Inter** for its exceptional legibility in data-heavy SaaS interfaces, paired with **Noto Sans SC** for comprehensive Chinese language support. 

Hierarchy is established through weight and scale rather than decorative shifts. We use a reduced base font size (14px) to accommodate the high information density required for schedule dashboards. Labels use an uppercase 11px style to differentiate metadata from actionable content. For numerical data points within tables or charts, a monospace font is recommended to ensure tabular alignment and rapid scanning of figures.

## Layout & Spacing

This design system employs a **Fluid Grid** model optimized for wide-screen executive monitors. The layout is built on a 4px baseline grid to ensure mathematical consistency across all dense components.

- **Main Dashboard:** 12-column grid with 16px gutters.
- **Density:** We utilize "Compact" spacing for data tables and "Comfortable" spacing for executive summaries.
- **Sidebars:** Fixed-width left navigation (240px) with a collapsible state (64px) to maximize the horizontal timeline real estate for live streaming schedules.
- **Margins:** Standard outer container padding is set to 24px to provide "breathing room" against the screen edge while maintaining high internal density.

## Elevation & Depth

To maintain a professional, high-end feel, this design system eschews heavy shadows in favor of **Tonal Layers** and **Low-Contrast Outlines**.

- **Surface 1 (Background):** #F8FAFC.
- **Surface 2 (Cards/Modules):** White (#FFFFFF) with a 1px border (#E2E8F0).
- **Surface 3 (Popovers/Modals):** White with a very soft, diffused ambient shadow (0px 4px 20px rgba(0,0,0,0.05)) to suggest focus without breaking the flat professional aesthetic.
- **Depth Hierarchy:** Use subtle background shifts (e.g., #F1F5F9 for hover states on list items) rather than elevation changes to indicate interactivity.

## Shapes

The shape language is strictly **Professional and Structured**. We use a "Soft" rounding approach to take the edge off the technical data without veering into consumer-grade playfulness.

- **Primary Components:** Buttons, input fields, and small tags use a **4px** corner radius.
- **Structural Elements:** Dashboard cards and main container wrappers use a **6px** corner radius.
- **Icons:** Thin-line (1.5px stroke) icons with minimal rounding to match the "Lucide" aesthetic. 
- **Consistency:** No sharp 0px corners are permitted, nor are pill-shaped buttons, to maintain the architectural integrity of the dashboard.

## Components

- **Buttons:** Primary buttons use a solid #2563EB fill with white text. Secondary buttons use a white background with a #E2E8F0 border. Height is kept at 32px for high-density layouts.
- **Status Chips:** Small, 4px rounded tags. Use a "tinted" background (10% opacity of the semantic color) with high-contrast text for Grade and Line indicators (e.g., S-Grade uses a light amber background with #D97706 text).
- **Data Tables:** Border-collapsed design. Header cells use the `label-caps` typography style. Row height is 40px for standard density.
- **Input Fields:** 1px border (#CBD5E1) with 4px radius. Focus state uses a 1px #2563EB border and a 2px soft blue glow.
- **Timeline Blocks:** Rectangular blocks representing stream slots. Use a vertical 3px accent bar on the left edge of the block to denote the "Line" category (Beauty, Health, etc.).
- **Icons:** Use 20px bounding boxes for 1.5px stroke-weight icons. Ensure consistent stroke ends (round) across the set.
- **Executive Cards:** Use a subtle top-border (2px) in the primary color to distinguish "Summary" cards from "General" cards.