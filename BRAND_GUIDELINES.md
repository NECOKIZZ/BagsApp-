# Delphi Brand Guidelines

This document outlines the visual identity and design system for **Delphi**, a real-time narrative-driven token terminal.

## 1. Brand Identity
**Delphi** (formerly BagsApp) is a high-fidelity, cinematic dashboard for tracking crypto narratives and launching tokens. The aesthetic is inspired by holographic terminals, futuristic interfaces, and degen culture.

---

## 2. Color Palette
The color system is designed for a deep dark-mode experience with high-contrast neon accents.

| Category | Color Name | Hex Code | Usage |
| :--- | :--- | :--- | :--- |
| **Primary** | Neon Green | `#00FFA3` | Primary action buttons, success states, live indicators, and brand accents. |
| **Background** | Deep Black | `#05070B` | Main application background and deep-level surfaces. |
| **Surface** | Navy Black | `#0B0F17` | Card backgrounds, side panels, and elevated UI containers. |
| **Info** | Vibrant Cyan | `#00D4FF` | Secondary accents, informational badges, and specialty statuses. |
| **Muted** | Muted Steel | `#8B92A8` | Secondary text, placeholders, and non-essential metadata. |
| **Border** | Dark Slate | `#1A1F2E` | Default border color for cards and section dividers. |
| **Warning** | Amber | `#F59E0B` | Low-urgency warnings and "Hot" score indicators. |
| **Danger** | Red | `#EF4444` | Negative price movements, error states, and high-risk alerts. |

---

## 3. Typography
The typography strategy blends modern sans-serifs with retro-terminal aesthetics.

### Primary Fonts
- **Geist**: The main **Sans-Serif** font used for body text, descriptions, and lists.
- **Clash Display**: The **Heading & CTA** font. Used for prominent headers and button labels, often in uppercase with wide letter-spacing (`tracking-widest`).
- **Press Start 2P**: The **Stylistic Terminal** font. Used for the main "DELPHI" branding and section headers like "TERMINAL".
- **JetBrains Mono**: The **Monospace** font. Used for technical data, contract addresses, and token tickers.
- **Space Grotesk**: A **Display** font used in secondary headers and specialized UI components.

### Typography Rules
- **Uppercase Headers**: Use `uppercase` and `tracking-widest` for section labels to give a premium, editorial look.
- **Data Tables**: Always use **JetBrains Mono** for numerical values and addresses to ensure alignment and technical clarity.
- **Buttons**: Use **Clash Display** (Bold) for all primary and secondary action buttons.

---

## 4. Design Components & Patterns

### Cards & Containers
- **Background**: `bg-[#0B0F17]/80` with `backdrop-blur-xl`.
- **Borders**: `border-[#1A1F2E]`.
- **Glow Effects**: Use subtle outer glows for active elements (e.g., `shadow-[0_0_10px_rgba(0,255,163,0.1)]`).

### Status Indicators
- **Live Sync**: A `6px` neon green dot with a slow CSS pulse animation.
- **Score Indicators**: Linear gradient from Red (`0`) to Green (`100`) using HSL mapping.

### Buttons
- **Primary**: Solid Neon Green (`#00FFA3`) with black text.
- **Secondary/Terminal**: Transparent background with a thin `1px` Neon Green border and subtle inner glow.

---

## 5. Visual Philosophy
- **High-Fidelity**: Surfaces should feel like glass or holographic projections.
- **Information Density**: Layouts should be efficient but never cluttered, using monospace for data to keep everything scan-able.
- **Interactive**: Hover states should feel alive with subtle scale transforms (`active:scale-95`) and border color shifts.
