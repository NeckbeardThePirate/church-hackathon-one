import { dark } from "@clerk/themes";
import type { ClerkProviderProps } from "@clerk/react";

/**
 * StudyBuddy tokens, mapped onto Clerk.
 * Colors and type come from app/globals.css and the auth card in SignInChoices.
 * Text on the gold button matches that card (`#1c1a16`).
 */
const SANS = "var(--font-sans), ui-sans-serif, system-ui, sans-serif";
const SERIF = 'var(--font-serif), Georgia, "Iowan Old Style", serif';
const ON_ACCENT = "#1c1a16";
const DANGER = "#c0533f";
const SUCCESS = "#89b09a";
/** Same value as `--accent`. Clerk copies `colorPrimary` onto its own `--accent`, so `var(--accent)` would loop. */
const ACCENT = "#c9b896";

interface Style {
  [key: string]: string | number | Style;
}

const floatShadow = "0 16px 48px -16px rgba(0, 0, 0, 0.65)";

const headerTitle: Style = {
  fontFamily: SERIF,
  fontSize: "1.5rem",
  fontWeight: 500,
  letterSpacing: "-0.02em",
  color: "var(--ink)",
  lineHeight: 1.2,
};

/** Utilities sit above Clerk's layer, so they win against `data-variant` rings. */
const fieldClass =
  "w-full border border-solid border-[var(--line)] bg-[var(--canvas)] text-[var(--ink)] shadow-none rounded-lg min-h-11 px-3 text-base outline-none placeholder:text-[var(--ink-muted)] focus:border-[color-mix(in_srgb,var(--accent)_55%,var(--line))] focus:shadow-none";

const primaryClass =
  "border-0 bg-[var(--accent)] text-[#1c1a16] shadow-none rounded-lg min-h-11 px-4 text-base font-medium after:hidden hover:bg-[color-mix(in_srgb,var(--accent)_88%,white)] disabled:opacity-40";

const secondaryClass =
  "border border-solid border-[var(--line)] bg-transparent text-[var(--ink)] shadow-none rounded-lg min-h-11 px-4 text-base font-medium hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] hover:bg-[var(--sidebar-active)] hover:shadow-none";

const menuClass =
  "min-h-11 w-full rounded-md px-2 text-left text-sm text-[var(--ink-muted)] hover:bg-[var(--sidebar-active)] hover:text-[var(--ink)] focus-visible:bg-[var(--sidebar-active)] focus-visible:text-[var(--ink)]";

/**
 * Account-menu Sign out. Visual chrome lives in `.sign-out-button` so it wins
 * over the menu-row utilities above. `shrink-0` and `whitespace-nowrap` keep
 * the label on one line in the popover and the mobile account drawer.
 */
export const signOutButtonClass =
  "sign-out-button inline-flex shrink-0 items-center justify-center whitespace-nowrap";

const surface: Style = {
  backgroundColor: "var(--sidebar)",
  color: "var(--ink)",
  border: "1px solid var(--line)",
  borderRadius: "0.75rem",
  boxShadow: "none",
};

const popover: Style = {
  ...surface,
  boxShadow: floatShadow,
  width: "min(20rem, calc(100vw - 1.5rem))",
};

const scroll: Style = {
  scrollbarGutter: "stable",
};

const elements: Record<string, Style | string> = {
  rootBox: { width: "100%", fontFamily: SANS },
  cardBox: { ...surface, width: "100%", overflow: "hidden" },
  card: {
    backgroundColor: "transparent",
    color: "var(--ink)",
    border: "none",
    borderRadius: "0",
    boxShadow: "none",
    width: "100%",
    padding: "1.25rem",
  },
  headerTitle,
  headerSubtitle: {
    fontFamily: SANS,
    fontSize: "0.875rem",
    lineHeight: 1.5,
    color: "var(--ink-muted)",
  },
  main: { gap: "1rem" },
  socialButtonsBlockButton: secondaryClass,
  socialButtonsBlockButtonText: { fontSize: "1rem", fontWeight: 500, color: "var(--ink)" },
  socialButtonsIconButton: `${secondaryClass} w-11 min-w-11 px-0`,
  dividerLine: { backgroundColor: "var(--line)", height: "1px" },
  dividerText: { color: "var(--ink-muted)", fontSize: "0.875rem", fontFamily: SANS },
  formFieldLabel: {
    color: "var(--ink)",
    fontFamily: SANS,
    fontSize: "0.875rem",
    fontWeight: 500,
  },
  formFieldInput: fieldClass,
  formFieldInput__error: `${fieldClass} border-[#c0533f]`,
  formFieldInputGroup: { boxShadow: "none", borderRadius: "0.5rem" },
  formFieldInputShowPasswordButton: "min-h-11 min-w-11 text-[var(--ink-muted)] hover:text-[var(--ink)]",
  formFieldErrorText: { color: DANGER, fontSize: "0.875rem", fontFamily: SANS },
  formFieldSuccessText: { color: SUCCESS, fontSize: "0.875rem" },
  formFieldWarningText: { color: "var(--accent)", fontSize: "0.875rem" },
  formFieldInfoText: { color: "var(--ink-muted)", fontSize: "0.875rem" },
  formFieldHintText: { color: "var(--ink-muted)", fontSize: "0.75rem" },
  formFieldAction: "inline-flex min-h-11 items-center text-sm font-medium text-[color-mix(in_srgb,var(--accent)_80%,var(--ink))] hover:text-[var(--ink)]",
  formButtonPrimary: primaryClass,
  formButtonReset: secondaryClass,
  buttonArrowIcon: "hidden",
  footer: {
    backgroundColor: "transparent",
    color: "var(--ink-muted)",
    borderTop: "1px solid var(--line)",
    marginTop: "0.25rem",
    padding: "0.75rem 1.25rem 1rem",
  },
  footerAction: { padding: "0.75rem 1.25rem 0" },
  footerActionText: { color: "var(--ink-muted)", fontSize: "0.875rem" },
  footerActionLink: "text-sm font-medium text-[color-mix(in_srgb,var(--accent)_80%,var(--ink))] hover:text-[var(--ink)]",
  footerPagesLink: { color: "var(--ink-muted)", fontSize: "0.75rem" },
  identityPreview: {
    backgroundColor: "var(--canvas)",
    border: "1px solid var(--line)",
    borderRadius: "0.5rem",
    boxShadow: "none",
  },
  identityPreviewText: { color: "var(--ink)", fontSize: "0.875rem" },
  identityPreviewEditButton: "min-h-11 min-w-11 text-[color-mix(in_srgb,var(--accent)_80%,var(--ink))] hover:text-[var(--ink)]",
  otpCodeFieldInput: `${fieldClass} text-center text-lg font-medium`,
  formResendCodeLink: "inline-flex min-h-11 items-center text-sm font-medium text-[color-mix(in_srgb,var(--accent)_80%,var(--ink))] hover:text-[var(--ink)]",
  alert: {
    borderRadius: "0.5rem",
    border: `1px solid color-mix(in srgb, ${DANGER} 45%, var(--line))`,
    backgroundColor: `color-mix(in srgb, ${DANGER} 12%, var(--sidebar))`,
  },
  alertText: { color: "var(--ink)", fontSize: "0.875rem" },
  backLink: "inline-flex min-h-11 items-center text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]",
  headerBackLink: "inline-flex min-h-11 items-center text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]",
  alternativeMethodsBlockButton: secondaryClass,
  selectButton: fieldClass,
  selectSearchInput: fieldClass,
  selectOptionsContainer: {
    ...surface,
    boxShadow: floatShadow,
    backgroundColor: "var(--sidebar)",
  },
  selectOption: menuClass,
  menuList: { ...surface, boxShadow: floatShadow, padding: "0.25rem" },
  menuItem: menuClass,
  menuButton: "min-h-11 min-w-11 rounded-md text-[var(--ink-muted)] hover:bg-[var(--sidebar-active)] hover:text-[var(--ink)]",
  badge: {
    backgroundColor: "color-mix(in srgb, var(--accent) 16%, var(--sidebar))",
    color: "var(--ink)",
    borderRadius: "999px",
    border: "1px solid var(--line)",
  },
  spinner: { color: "var(--accent)" },
  modalBackdrop: { backdropFilter: "none" },
  modalContent: {
    ...surface,
    boxShadow: floatShadow,
    width: "min(54rem, calc(100vw - 1.5rem))",
    maxHeight: "min(44rem, calc(100dvh - 1.5rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)))",
  },
  modalCloseButton: "min-h-11 min-w-11 rounded-md text-[var(--ink-muted)] hover:bg-[var(--sidebar-active)] hover:text-[var(--ink)]",
  scrollBox: scroll,
  pageScrollBox: scroll,
  navbar: {
    backgroundColor: "transparent",
    borderColor: "var(--line)",
  },
  navbarButton: menuClass,
  navbarButtonIcon: { color: "inherit" },
  navbarMobileMenuRow: { borderColor: "var(--line)" },
  navbarMobileMenuButton: `${secondaryClass} w-full justify-between`,
  page: { backgroundColor: "transparent", color: "var(--ink)" },
  profileSection: { borderColor: "var(--line)" },
  profileSectionTitle: { borderColor: "var(--line)" },
  profileSectionTitleText: {
    fontFamily: SANS,
    fontSize: "0.875rem",
    fontWeight: 600,
    letterSpacing: "-0.01em",
    color: "var(--ink)",
  },
  profileSectionSubtitle: { color: "var(--ink-muted)", fontSize: "0.875rem" },
  profileSectionContent: { color: "var(--ink)" },
  profileSectionPrimaryButton: secondaryClass,
  accordionTriggerButton: `${menuClass} text-[var(--ink)]`,
  userButtonPopoverCard: popover,
  userButtonPopoverMain: scroll,
  userButtonPopoverActions: { borderColor: "var(--line)" },
  userButtonPopoverActionButton: menuClass,
  userButtonPopoverActionButton__signOut: signOutButtonClass,
  userButtonPopoverActionButton__signOutAll: signOutButtonClass,
  userButtonPopoverActionButtonIcon: { color: "inherit" },
  userButtonPopoverFooter: {
    backgroundColor: "transparent",
    borderTop: "1px solid var(--line)",
    color: "var(--ink-muted)",
  },
  userPreviewMainIdentifier: { color: "var(--ink)", fontWeight: 600, fontSize: "0.875rem" },
  userPreviewSecondaryIdentifier: { color: "var(--ink-muted)", fontSize: "0.75rem" },
  userButtonOuterIdentifier: { color: "var(--ink)", fontSize: "0.875rem" },
  organizationSwitcherPopoverCard: popover,
  organizationSwitcherPopoverActionButton: menuClass,
  organizationSwitcherTrigger: secondaryClass,
  organizationPreviewMainIdentifier: { color: "var(--ink)", fontWeight: 600 },
  organizationPreviewSecondaryIdentifier: { color: "var(--ink-muted)", fontSize: "0.75rem" },
  organizationListPreviewButton: menuClass,
  membersPageInviteButton: primaryClass,
  table: { color: "var(--ink)" },
  tableHead: { color: "var(--ink-muted)", borderColor: "var(--line)" },
  tableRow: { borderColor: "var(--line)" },
  drawerContent: {
    backgroundColor: "var(--sidebar)",
    color: "var(--ink)",
    borderColor: "var(--line)",
  },
  drawerTitle: { ...headerTitle, fontSize: "1.25rem" },
  drawerClose: {
    color: "var(--ink-muted)",
    minWidth: "2.75rem",
    minHeight: "2.75rem",
  },
  verificationLinkStatusText: { color: "var(--ink)", fontSize: "0.875rem" },
  formHeaderTitle: { ...headerTitle, fontSize: "1.25rem" },
  formHeaderSubtitle: { color: "var(--ink-muted)", fontSize: "0.875rem" },
  activeDevice: { borderColor: "var(--line)", borderRadius: "0.5rem" },
  qrCodeContainer: { backgroundColor: "var(--canvas)", borderRadius: "0.5rem" },
};

const authCard: Record<string, Style | string> = {
  rootBox: { width: "100%", maxWidth: "100%" },
  cardBox: { ...surface, width: "100%", maxWidth: "100%", overflow: "hidden" },
  card: elements.card,
  headerTitle,
};

export const studyBuddyClerkAppearance = {
  cssLayerName: "clerk",
  theme: dark,
  options: {
    logoPlacement: "none" as const,
    logoLinkUrl: "/",
    socialButtonsVariant: "blockButton" as const,
    socialButtonsPlacement: "top" as const,
  },
  captcha: { theme: "dark" as const, size: "flexible" as const },
  variables: {
    colorPrimary: ACCENT,
    colorPrimaryForeground: ON_ACCENT,
    colorDanger: DANGER,
    colorSuccess: SUCCESS,
    colorWarning: "var(--accent)",
    colorNeutral: "var(--ink)",
    colorForeground: "var(--ink)",
    colorMutedForeground: "var(--ink-muted)",
    colorMuted: "var(--sidebar-active)",
    colorBackground: "var(--sidebar)",
    colorInput: "var(--canvas)",
    colorInputForeground: "var(--ink)",
    colorShimmer: "var(--line)",
    colorRing: "var(--accent)",
    colorShadow: "rgba(0, 0, 0, 0.65)",
    colorBorder: "var(--line)",
    colorModalBackdrop: "#000000",
    fontFamily: SANS,
    fontFamilyButtons: SANS,
    fontSize: {
      xs: "0.75rem",
      sm: "0.875rem",
      md: "1rem",
      lg: "1.125rem",
      xl: "1.5rem",
    },
    fontWeight: { normal: 400, medium: 500, semibold: 600, bold: 700 },
    borderRadius: "0.5rem",
    spacing: "1rem",
  },
  elements,
  signIn: { elements: authCard },
  signUp: { elements: authCard },
  userButton: {
    elements: {
      userButtonPopoverCard: popover,
      userButtonPopoverActionButton: menuClass,
      userButtonPopoverActionButton__signOut: signOutButtonClass,
      userButtonPopoverActionButton__signOutAll: signOutButtonClass,
    },
  },
  userProfile: {
    elements: {
      rootBox: { width: "100%" },
      cardBox: { ...surface, width: "100%", boxShadow: floatShadow, overflow: "hidden" },
      headerTitle: { ...headerTitle, fontSize: "1.25rem" },
      navbarButton: menuClass,
      profileSectionTitleText: elements.profileSectionTitleText,
      scrollBox: scroll,
      pageScrollBox: scroll,
    },
  },
  userVerification: {
    elements: {
      cardBox: { ...surface, width: "100%" },
      headerTitle,
      formFieldInput: fieldClass,
      otpCodeFieldInput: elements.otpCodeFieldInput,
      formButtonPrimary: primaryClass,
    },
  },
  organizationSwitcher: {
    elements: {
      organizationSwitcherPopoverCard: popover,
      organizationSwitcherPopoverActionButton: menuClass,
    },
  },
  organizationProfile: {
    elements: {
      cardBox: { ...surface, width: "100%", boxShadow: floatShadow },
      headerTitle: { ...headerTitle, fontSize: "1.25rem" },
      navbarButton: menuClass,
      scrollBox: scroll,
      pageScrollBox: scroll,
    },
  },
  organizationList: { elements: { cardBox: { ...surface, width: "100%" }, headerTitle } },
  createOrganization: { elements: { cardBox: { ...surface, width: "100%" }, headerTitle, formButtonPrimary: primaryClass } },
  waitlist: { elements: authCard },
} satisfies NonNullable<ClerkProviderProps["appearance"]>;
