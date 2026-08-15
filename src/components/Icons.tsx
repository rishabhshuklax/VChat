/**
 * Inline icon set.
 *
 * Hand-rolled rather than pulled from an icon package: the app needs about a
 * dozen glyphs, and this keeps the bundle free of a dependency that would ship
 * thousands. All icons share a 24px grid and inherit `currentColor`.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const MicIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <path d="M12 19v3" />
  </Icon>
);

export const MicOffIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
    <path d="M15 10.5V5a3 3 0 0 0-5.94-.6" />
    <path d="M19 10v2a7 7 0 0 1-1.1 3.76" />
    <path d="M5 10v2a7 7 0 0 0 10.5 6.06" />
    <path d="M12 19v3" />
    <path d="m3 3 18 18" />
  </Icon>
);

export const CameraIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2" y="6" width="13" height="12" rx="2.5" />
    <path d="m15 11 5.4-3.1a.8.8 0 0 1 1.2.7v6.8a.8.8 0 0 1-1.2.7L15 13Z" />
  </Icon>
);

export const CameraOffIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10.5 6H12.5A2.5 2.5 0 0 1 15 8.5V11" />
    <path d="m15 11 5.4-3.1a.8.8 0 0 1 1.2.7v6.8a.8.8 0 0 1-.5.74" />
    <path d="M15 15v.5a2.5 2.5 0 0 1-2.5 2.5h-8A2.5 2.5 0 0 1 2 15.5v-7A2.5 2.5 0 0 1 4.5 6" />
    <path d="m3 3 18 18" />
  </Icon>
);

export const ScreenIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2.5" y="4" width="19" height="12.5" rx="2" />
    <path d="M8.5 20.5h7" />
    <path d="M12 16.5v4" />
    <path d="m12 12.5-2.2-2.2M12 12.5l2.2-2.2M12 12.5V7" />
  </Icon>
);

export const ScreenOffIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M21.5 14.8V6a2 2 0 0 0-2-2H8.7" />
    <path d="M4.2 4.2A2 2 0 0 0 2.5 6v8.5a2 2 0 0 0 2 2h13" />
    <path d="M8.5 20.5h7" />
    <path d="M12 16.5v4" />
    <path d="m3 3 18 18" />
  </Icon>
);

export const ChatIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-3-.5L4 21l1.6-4a8.2 8.2 0 0 1-1.6-5A8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5Z" />
  </Icon>
);

export const PeopleIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
    <circle cx="9" cy="7.5" r="3.5" />
    <path d="M22 20v-1.5a4 4 0 0 0-3-3.87" />
    <path d="M16.5 4.13a4 4 0 0 1 0 7.75" />
  </Icon>
);

export const HangUpIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.5 9.5c5.4-3.6 13.6-3.6 19 0v3.3a1.7 1.7 0 0 1-2.1 1.65l-3-.75a1.7 1.7 0 0 1-1.3-1.65v-1.4a13.6 13.6 0 0 0-6.2 0v1.4a1.7 1.7 0 0 1-1.3 1.65l-3 .75A1.7 1.7 0 0 1 2.5 12.8Z" />
  </Icon>
);

export const SendIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 12 20.5 4.5 13.5 21l-2.4-6.6L4 12Z" />
  </Icon>
);

export const CopyIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="9" y="9" width="12" height="12" rx="2.5" />
    <path d="M5.5 15A2.5 2.5 0 0 1 3 12.5v-7A2.5 2.5 0 0 1 5.5 3h7A2.5 2.5 0 0 1 15 5.5" />
  </Icon>
);

export const CheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Icon>
);

export const LockIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="4" y="10.5" width="16" height="10.5" rx="2.5" />
    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
  </Icon>
);

export const SettingsIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 14.5a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-1 1.47V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 9.1 19.4a1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-1H3a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 4.6 9.1a1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.6 1.6 0 0 0 1.77.32H9.1a1.6 1.6 0 0 0 1-1.47V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.32 1.77V9.1a1.6 1.6 0 0 0 1.47 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.47 1Z" />
  </Icon>
);

export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);

export const VideoLogo = (props: IconProps) => (
  <Icon {...props} strokeWidth={1.6}>
    <rect x="2.5" y="5.5" width="13" height="13" rx="4" />
    <path d="m15.5 11 4.6-2.65a.9.9 0 0 1 1.4.78v5.74a.9.9 0 0 1-1.4.78L15.5 13Z" />
  </Icon>
);

export const SignalIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 18v-3" />
    <path d="M10 18V11" />
    <path d="M16 18V7" />
    <path d="M22 18V4" />
  </Icon>
);

export const PinIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M15 3 21 9l-3.5 1.2-3.8 3.8L13 18l-1.5 1.5L4.5 12.5 6 11l3.9-.7 3.8-3.8Z" />
    <path d="m8.5 15.5-4.5 5" />
  </Icon>
);

export const SpinnerIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </Icon>
);

export const SmileIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9.25" />
    <path d="M8.4 14.2c.9 1.2 2.2 1.9 3.6 1.9s2.7-.7 3.6-1.9" />
    <path d="M9 9.4h.01M15 9.4h.01" strokeWidth={2.4} />
  </Icon>
);

export const ArrowRightIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 12h15" />
    <path d="m13.5 5.5 6.5 6.5-6.5 6.5" />
  </Icon>
);
