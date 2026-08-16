# DirectDrop Design System

## Direction

DirectDrop is a calm desktop utility. The interface combines Apple-like restraint with Toss-like clarity: generous whitespace, short Korean copy, one strong action per screen, and almost no decorative motion.

## Foundation

| Token         | Value     | Usage                                   |
| ------------- | --------- | --------------------------------------- |
| Primary       | `#3182F6` | Primary action, current progress, focus |
| Primary hover | `#1B64DA` | Hover and pressed emphasis              |
| Background    | `#F2F4F6` | App canvas                              |
| Surface       | `#FFFFFF` | Cards and dialogs                       |
| Surface muted | `#F7F8FA` | Grouped controls and summaries          |
| Foreground    | `#191F28` | Headings and important values           |
| Secondary     | `#4E5968` | Body copy                               |
| Muted         | `#8B95A1` | Labels and metadata                     |
| Border        | `#E5E8EB` | Quiet separation                        |
| Success       | `#00A878` | Online and privacy confirmation         |
| Destructive   | `#E42939` | Errors and destructive actions          |

Use the system font stack: SF Pro on macOS, Pretendard or Apple SD Gothic Neo for Korean, then Noto Sans KR and Inter fallbacks. Headings use 700 weight with tight Korean-safe tracking. Body text is 14–16px with 1.5–1.65 line height.

## Components

- Cards: white, 22px radius, 1px quiet border, `0 1px 2px` shadow only.
- Buttons: 44px minimum height, 12px radius. Primary is solid blue; secondary is white or neutral gray.
- Inputs: neutral filled background, no heavy border at rest, blue border and focus halo when focused.
- Navigation: compact neutral segmented control in a translucent white top bar.
- Progress: four compact labeled steps. Current state uses blue fill; completed states use a pale blue tint.
- Active share list: link first, followed by a dense two-column file list with name and size. Keep download count and remaining time in the summary row.
- Dialogs: white 24px surface over a 42% dark scrim, with a short fade and 8px rise.

## Responsive layout

- Treat the desktop window as a fixed application viewport. At the supported 600×620 minimum, the top bar and current task must fit without page-level scrolling.
- Use a two-column composition from 561px: file selection on the left and compact settings on the right. Collapse to one column only for browser widths below the native minimum.
- Use `100dvh`, flex children with `min-height: 0`, and internal overflow only for unbounded file or transfer collections.
- At short heights, remove secondary descriptions before reducing control size. Interactive targets remain at least 44px.

## Share lifecycle

- A timed share disappears from the active list at the exact local expiration deadline. UI removal happens before network cleanup so the expired state is never left visible.
- Keep the share URL, every selected file, total size, download count, and remaining time visible in the active-share view.

## Interaction

- Use 180–220ms transitions for feedback and content replacement.
- Do not animate decorative backgrounds or run continuous animations.
- Preserve visible keyboard focus and 44px minimum hit targets.
- Respect `prefers-reduced-motion`.
- Use icons only from Lucide with consistent 1.5–2px strokes.

## Content

- Prefer conversational Korean: explain what is happening and what the user should do next.
- Keep English to the DirectDrop name and small product labels only.
- Each view should expose one obvious primary action.

## Avoid

- Gradients, particle effects, oversized English state words, glass cards, glow effects, and deep shadows.
- Multiple competing primary buttons.
- Gray text below accessible contrast or icon-only controls without labels.
- Layout-shifting hover effects and animations longer than 300ms.
