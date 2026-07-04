// MeetMe UI kit — presentational, theme-driven components.
// Every component reads tokens via `useTheme()` so it renders correctly in both
// the Polish (green) and Trust (fintech blue) themes.

export { Button } from './Button';
export type { ButtonProps, ButtonVariant } from './Button';

export { Badge, StatusPill } from './Badge';
export type { BadgeProps, StatusPillProps, DealState } from './Badge';

export { Avatar, AvatarPair } from './Avatar';
export type { AvatarProps, AvatarPairProps } from './Avatar';

export { Card, SectionLabel } from './Card';
export type { CardProps, SectionLabelProps } from './Card';

export { TrustBanner } from './TrustBanner';
export type { TrustBannerProps } from './TrustBanner';

export { Stepper } from './Stepper';
export type { StepperProps } from './Stepper';

export { PresenceCard } from './Presence';
export type { PresenceCardProps, Party } from './Presence';

export { DealCard } from './DealCard';
export type { DealCardProps, DealCardPeople } from './DealCard';

export { MeetupField } from './MeetupField';
export type { MeetupFieldProps } from './MeetupField';

export { DealHistoryRow } from './DealRow';
export type { DealHistoryRowProps } from './DealRow';

export { Callout } from './Callout';
export type { CalloutProps } from './Callout';

export { WalletSplit } from './WalletSplit';
export type { WalletSplitProps } from './WalletSplit';

export { Accordion } from './Accordion';
export type { AccordionProps } from './Accordion';

export { RatingStars } from './Rating';
export type { RatingStarsProps } from './Rating';

export { UIGallery } from './Gallery';

// Shared helper types (handy for consumers wiring props).
export type { Tone, IconName } from './_internal';
