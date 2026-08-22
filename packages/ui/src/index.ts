/**
 * `@mprelist/ui` — the one design system behind the extension popup and
 * `apps/web` (ADR-0011, ADR-0017).
 *
 * Consumed as TypeScript source: both consumers bundle (esbuild for the
 * extension, Vite for the web app), so a build step here would only produce a
 * second artefact to keep in step. `bundles.test.ts` proves the extension's own
 * bundler resolves this entry point.
 */
export { classes } from "./classes";
export {
  cssVarName,
  fontFamily,
  monoFamily,
  motion,
  palette,
  radius,
  space,
  staticTokens,
  text,
  type PaletteName,
  type Theme,
} from "./tokens";
export { themeAttribute, themeCss } from "./theme";
export { componentCss, uiCss } from "./styles";
export { UiStyles } from "./components/UiStyles";
export { Button, isInert, type ButtonProps, type ButtonShape, type ButtonTone } from "./components/Button";
export { IconButton, type IconButtonProps } from "./components/IconButton";
export { Icon, iconNames, type IconName, type IconProps } from "./components/Icon";
export { Badge, type BadgeProps, type BadgeTone } from "./components/Badge";
export { Card, type CardProps } from "./components/Card";
export {
  Checkbox,
  Field,
  Input,
  Select,
  Textarea,
  type InputProps,
  type SelectProps,
  type TextareaProps,
} from "./components/Field";
export { Meter, type MeterProps } from "./components/Meter";
export { Note, type NoteProps, type NoteTone } from "./components/Note";
export { Skeleton, type SkeletonProps } from "./components/Skeleton";
export { Spinner, type SpinnerProps } from "./components/Spinner";
