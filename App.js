import React, { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Alert, Avatar, Badge, Box, Button, Checkbox, Chip, CircularProgress,
  CssBaseline, Dialog, DialogContent, DialogTitle,
  Divider, Drawer, IconButton, InputBase, LinearProgress, Menu, MenuItem,
  Modal, Pagination, Paper, Popover, Select, Slide, Snackbar, Switch, Tab, Tabs,
  Tooltip, Typography, useMediaQuery,
} from '@mui/material';
import { ThemeProvider, alpha, createTheme } from '@mui/material/styles';
import {
  DataGrid,
  GridFooterContainer,
  gridPageCountSelector,
  gridPaginationModelSelector,
  gridRowCountSelector,
  useGridApiContext,
  useGridSelector,
} from '@mui/x-data-grid';

import StatusPill from './components/StatusPill';
import {
  BRAND_TEAL_LIGHT,
  CARE_BAR_GRADIENT,
  CARE_GRADIENT_SURFACE_SX,
  CARE_GRADIENT_TEXT_SX,
  CARE_WORDMARK_GRADIENT,
} from './shared/uiTokens';
import { getDaysLeft, getCertStatus, formatDaysLeft, formatShortDate } from './shared/certStatus';

// --- Icons ---
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import AddIcon from '@mui/icons-material/Add';
import AltRouteOutlinedIcon from '@mui/icons-material/AltRouteOutlined';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIosOutlined';
import AssessmentIcon from '@mui/icons-material/Assessment';
import AssignmentIcon from '@mui/icons-material/Assignment';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DashboardIcon from '@mui/icons-material/Dashboard';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMoreOutlined';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import FilterListIcon from '@mui/icons-material/FilterList';

import HourglassBottomOutlinedIcon from '@mui/icons-material/HourglassBottomOutlined';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import LogoutIcon from '@mui/icons-material/LogoutOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';

import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PublicOutlinedIcon from '@mui/icons-material/PublicOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import RestartAltIcon from '@mui/icons-material/RestartAltOutlined';
import SearchIcon from '@mui/icons-material/Search';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import TagIcon from '@mui/icons-material/Tag';
import TaskAltIcon from '@mui/icons-material/TaskAltOutlined';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

const DashboardView = lazy(() => import('./views/DashboardView'));
const MetricsView = lazy(() => import('./views/MetricsView'));

// --- THEME / DESIGN SYSTEM ---
// ======================================================
// DESIGN SYSTEM - CARE Portal
//
// Neutral slate surfaces carrying ONE brand hue (navy), semantic tokens for
// success/warning/danger/info, and a full light + dark mode via a factory.
//
// COLOR RULE: navy is the only interactive/brand hue in the product. Teal
// appears in the shield mark and nowhere else. Green/amber/red mean exactly
// one thing each - certificate health - so a coloured element anywhere in the
// UI is always readable as either "brand" or "status", never decoration.
// ======================================================

// Interface face: neutral, tall x-height, built for dense data.
const FONT_SANS = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
// Display face: the CARE wordmark only. Deliberately not used for body text.
const FONT_BRAND = '"Plus Jakarta Sans", Inter, -apple-system, "Segoe UI", sans-serif';
const FONT_MONO = '"JetBrains Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace';

// -- The brand ramp. One hue, four stops. Everything interactive picks from
// here, which is what replaced the eight unrelated blues this file used to
// carry (#004AEB, #3B82F6, #0B3D6E, #1A6BB5, #062847, #5EB8E8, #0284C7, #075985).
const NAVY_900 = '#062847';
const NAVY_700 = '#0B3D6E'; // brand anchor - wordmark, nav, primary actions
const NAVY_500 = '#1A6BB5';

// Table column header — same soft navy tint as the active KPI tabs and PROD badge,
// so the grid reads as part of the card instead of a separate dark strip.
const TABLE_HEADER_BG = '#E8F0F9';
const TABLE_HEADER_BORDER = '#C7DBEE';
const TABLE_HEADER_TEXT = NAVY_700;
const FILTER_BAR_BG = '#F3F7FC';

// Reserved for the shield mark and brand gradient endpoints.
const BRAND_TEAL = '#009999';

const PRIMARY_MAIN = NAVY_700;
const ERROR_MAIN = '#DC2626';

// Renders the app at 110% so type and controls stay readable at browser zoom 100%.
// Kept at 1 (no scaling) - the app previously forced every visitor to
// 110% zoom via `html { zoom }` below, stacking on top of whatever zoom
// level the user's own browser was already at. That's also what caused
// the Popper-positioning bugs on the Filters popover and PagerDuty
// tooltip: `zoom` isn't a standard scaling transform, and most Popper
// math assumes unscaled coordinates. The HTML_ZOOM_POPPER_MODIFIER /
// ZOOM_AWARE_POPPER_PROPS machinery below exists solely to compensate for
// a non-1 value here; it's a deliberate no-op at UI_SCALE = 1 (see the
// `if (zoom === 1) return;` guard in HTML_ZOOM_POPPER_MODIFIER) rather
// than something that needs to be torn out - if this ever needs to change
// again, the compensation is already wired up everywhere it's needed.
const UI_SCALE = 1;

// CSS `zoom` on <html> breaks Popper anchor math for portaled menus/popovers.
// Re-anchor from the reference rect (viewport coords are already zoom-correct).
const getHtmlZoom = () => {
  if (typeof document === 'undefined') return 1;
  const zoom = getComputedStyle(document.documentElement).zoom;
  return zoom && zoom !== 'normal' ? parseFloat(zoom) : 1;
};

const HTML_ZOOM_POPPER_MODIFIER = {
  name: 'htmlZoomAnchorFix',
  enabled: true,
  phase: 'beforeWrite',
  requires: ['popperOffsets'],
  fn({ state }) {
    const zoom = getHtmlZoom();
    if (zoom === 1) return;
    const el = state.elements.reference;
    if (!el?.getBoundingClientRect) return;
    const ref = el.getBoundingClientRect();
    const popper = state.rects.popper;
    const placement = state.placement || 'bottom-start';

    let x = ref.x;
    let y = ref.y + ref.height;

    if (placement.startsWith('top')) {
      y = ref.y - popper.height;
    }
    if (placement.endsWith('end')) {
      x = ref.x + ref.width - popper.width;
    } else if (placement.includes('center') || placement === 'bottom' || placement === 'top') {
      x = ref.x + (ref.width - popper.width) / 2;
    }

    state.modifiersData.popperOffsets.x = Math.round(x);
    state.modifiersData.popperOffsets.y = Math.round(y);
  },
};

const ZOOM_AWARE_POPPER_PROPS = {
  strategy: 'fixed',
  modifiers: [HTML_ZOOM_POPPER_MODIFIER],
};

// Shared Menu/Popover props: no body scroll-lock (prevents fixed header jump) + zoom fix.
const FLOATING_PANEL_POPPER_SLOT = { popper: ZOOM_AWARE_POPPER_PROPS };

// Focus halo shared by every focused input.
const FOCUS_RING = `0 0 0 3px ${alpha(NAVY_700, 0.20)}`;

// Surface palette: off-white canvas, pure white cards and top bar.
const PALETTE = {
  bg: '#F9FAFB',
  surface: '#FFFFFF',
  surfaceMuted: '#F3F4F6',
  text: '#030712',
  textSecondary: '#4B5563',
  textMuted: '#9CA3AF',
  border: '#E5E7EB',
  borderStrong: '#D1D5DB',
  rowHover: '#F9FAFB',
  rowSelected: alpha(PRIMARY_MAIN, 0.06),
  shellBg: '#F3F4F6',
  shellText: '#4B5563',
  shellTextStrong: '#030712',
  shellHover: '#E5E7EB',
  shellActive: '#FFFFFF',
  shellActiveText: '#030712',
  shellBorder: '#E5E7EB',
};

// Softer, layered shadows.
const SHADOWS = {
  card: '0 1px 2px rgba(16,24,40,0.05), 0 1px 3px rgba(16,24,40,0.05)',
  cardHover: '0 6px 16px -4px rgba(16,24,40,0.10), 0 2px 6px rgba(16,24,40,0.05)',
  floating: '0 16px 40px -8px rgba(16,24,40,0.18), 0 4px 10px rgba(16,24,40,0.06)',
};


// Typography scale. Nine stops, and nothing outside them - this file used to
// carry 96 inline `fontSize` literals across 20 distinct sizes, including
// three sets of near-duplicates (0.6625 vs 0.6875, 1.05/1.1/1.15, 0.78125)
// that were visibly arbitrary rather than chosen.
const TS = {
  xs: '0.6875rem',    // 11px - captions, overlines, badges
  sm: '0.75rem',      // 12px - secondary labels, timestamps, table headers
  body: '0.8125rem',  // 13px - standard body text, menu items, table cells
  md: '0.875rem',     // 14px - slightly emphasized body
  lg: '0.9375rem',    // 15px - subtitles, drawer titles
  xl: '1.0625rem',    // 17px - section headings (h6)
  brand: '1.1875rem', // 19px - the CARE wordmark, and only that
  h2: '1.25rem',      // 20px - page title
  display: '1.375rem',// 22px - donut centre, coverage tile figures
  stat: '2.25rem',    // 36px - KPI numbers, health gauge
  hero: '3rem',       // 48px - the detail drawer countdown
};

const ROW_SELECTED_BG = alpha(PRIMARY_MAIN, 0.06);

// -- Semantic tints. Green/amber/red mean certificate health and nothing else.
const TINTS = {
  status: {
    error:   { bg: '#FEE2E2', fg: '#991B1B', border: '#FECACA', dot: '#DC2626' },
    warning: { bg: '#FEF3C7', fg: '#92400E', border: '#FDE68A', dot: '#D97706' },
    success: { bg: '#D1FAE5', fg: '#065F46', border: '#A7F3D0', dot: '#059669' },
  },
  // Expired reads as "no longer live" rather than "on fire" - neutral slate.
  expired: { bg: '#F3F4F6', fg: '#1F2937', border: '#E5E7EB', dot: '#4B5563' },
  env: {
    // PROD used to be sky blue, a blue unrelated to the brand. It now borrows
    // the brand navy, which also makes it the most prominent environment.
    PROD:    { bg: '#E8F0F9', fg: NAVY_700, border: '#C7DBEE' },
    STAGING: { bg: '#FEF3C7', fg: '#92400E', border: '#FDE68A' },
    DEV:     { bg: '#F3F4F6', fg: '#374151', border: '#E5E7EB' },
  },
};

// Kept as a hook-shaped accessor so the many call sites read the same as
// before; there is no longer a mode to resolve against.
const useTints = () => TINTS;

// Subtle neutral fills - search fields, row hovers, panel headers, progress
// tracks. Named so these stay consistent instead of drifting between
// grey.50/100/200 at each call site.
const SUBTLE_BG = (t) => t.palette.grey[50];
const SUBTLE_BG_STRONG = (t) => t.palette.grey[100];
const SUBTLE_BORDER = (t) => t.palette.grey[300];

// The single page gutter. Every top-level block in the content area - page
// heading, status tabs, filter bar, chip strip, error banner, grid, and both
// insight views - pads to this and nothing else, so they share one left edge.
// The page heading used to sit at {xs: 2.5, md: 4} while everything below it
// used {xs: 2, md: 3}, which put the title 8px right of every card under it.
const PAGE_PX = { xs: 2, md: 3 };

// Elevated surface shared by KPI cards, filter bar, chip strip, error banner,
// grid shell and drawer cards. Corner radius left to caller.
const SURFACE_SX = {
  bgcolor: 'background.paper',
  border: '1px solid',
  borderColor: 'divider',
  boxShadow: (t) => t.shadows[1],
};

// Floating panel: filter popover, dropdown menus, notifications.
const FLOATING_PANEL_SX = {
  borderRadius: '14px',
  border: '1px solid',
  borderColor: 'divider',
  boxShadow: (t) => t.shadows[8],
};

const createAppTheme = () => {
  const p = PALETTE;
  const s = SHADOWS;
  return createTheme({
    palette: {
      mode: 'light',
      // The brand navy IS the primary. This block used to hold #004AEB while
      // PRIMARY_MAIN said navy, so buttons and focus rings rendered one blue
      // and every alpha() tint rendered another.
      primary: {
        main: NAVY_700,
        dark: NAVY_900,
        light: NAVY_500,
        contrastText: '#FFFFFF',
      },
      secondary: { main: BRAND_TEAL, light: BRAND_TEAL_LIGHT, dark: NAVY_700 },
      background: { default: p.bg, paper: p.surface },
      text: { primary: p.text, secondary: p.textSecondary, disabled: p.textMuted },
      divider: p.border,
      success: { main: '#059669'},
      warning: { main: '#D97706'},
      error: { main: ERROR_MAIN },
      // info stays in the navy family rather than introducing a sky blue.
      info: { main: NAVY_500 },
      grey: {
        50:  '#F9FAFC',
        100: '#F2F4F8',
        200: '#E7EBF2',
        300: '#D0D5DD',
        400: '#98A2B3',
        500: '#667085',
        700: '#374151',
        900: '#0B1220',
      },
      // Custom shell tokens accessible via theme.palette.shell.
      shell: {
        bg: p.shellBg,
        text: p.shellText,
        textStrong: p.shellTextStrong,
        hover: p.shellHover,
        active: p.shellActive,
        activeText: p.shellActiveText,
        border: p.shellBorder,
      },
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: FONT_SANS,
      h3: { fontSize: TS.stat, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.25 },
      h4: { fontSize: TS.display, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.25 },
      h5: { fontSize: TS.h2, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.3 },
      h6: { fontSize: TS.xl, fontWeight: 700, letterSpacing: '-0.015em', lineHeight: 1.4 },
      subtitle1: { fontSize: TS.lg, fontWeight: 700, letterSpacing: '-0.01em' },
      subtitle2: { fontSize: TS.body, fontWeight: 700, letterSpacing: 0 },
      body1: { fontSize: TS.md, lineHeight: 1.55 },
      body2: { fontSize: TS.body, fontWeight: 400, lineHeight: 1.5 },
      caption: { fontSize: TS.sm, fontWeight: 600, letterSpacing: '0.06em' },
      overline: { fontSize: TS.body, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' },
      button: { textTransform: 'none', fontWeight: 600, fontSize: TS.body, letterSpacing: 0 }
    },
    shadows: [
      'none',
      s.card,
      s.card,
      s.cardHover,
      s.cardHover,
      s.floating,
      s.floating,
      s.floating,
      s.floating,
      s.floating,
      s.floating, s.floating, s.floating, s.floating, s.floating, s.floating,
      s.floating, s.floating, s.floating, s.floating, s.floating, s.floating,
      s.floating, s.floating, s.floating,
    ],
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          html: {
            zoom: UI_SCALE,
            // Reserve scrollbar width so opening a menu does not shift the fixed header.
            scrollbarGutter: 'stable',
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
          },
          body: { fontFeatureSettings: '"cv02","cv03","cv04","cv11"' },
          '*::-webkit-scrollbar': { width: 10, height: 10 },
          '*::-webkit-scrollbar-track': { background: 'transparent' },
          '*::-webkit-scrollbar-thumb': {
            backgroundColor: '#CBD3E1',
            borderRadius: 8,
            border: '2px solid transparent',
            backgroundClip: 'content-box'
          },
          '*::-webkit-scrollbar-thumb:hover': { backgroundColor: '#98A2B3'},
          '::selection': { background: alpha(PRIMARY_MAIN, 0.28) },
          // -- Animation keyframes ----------------------------
          '@keyframes fadeSlideIn': {
            from: { opacity: 0, transform: 'translateY(8px)' },
            to:   { opacity: 1, transform: 'translateY(0)' },
          },
          '@keyframes fadeIn': {
            from: { opacity: 0 },
            to:   { opacity: 1 },
          },
          '@keyframes scaleIn': {
            from: { opacity: 0, transform: 'scale(0.96)' },
            to:   { opacity: 1, transform: 'scale(1)' },
          },
          '@keyframes growBarX': {
            from: { transform: 'scaleX(0)' },
            to:   { transform: 'scaleX(1)' },
          },
          '@keyframes growBarY': {
            from: { transform: 'scaleY(0)' },
            to:   { transform: 'scaleY(1)' },
          },
          '@keyframes shimmer': {
            '0%':   { backgroundPosition: '-200% 0' },
            '100%': { backgroundPosition: '200% 0' },
          },
          '@keyframes chipIn': {
            from: { opacity: 0, transform: 'scale(0.85)' },
            to:   { opacity: 1, transform: 'scale(1)' },
          },
          '@keyframes slideDrawerIn': {
            from: { opacity: 0, transform: 'translateX(24px)' },
            to:   { opacity: 1, transform: 'translateX(0)' },
          },
        }
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 8,
            paddingLeft: 14,
            paddingRight: 14,
            transition: 'background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease, transform 0.1s ease',
            '&:active': { transform: 'scale(0.97)' },
          },
          contained: {
            boxShadow: '0 1px 2px rgba(16,24,40,0.10)',
            '&:hover': { boxShadow: `0 4px 12px ${alpha(PRIMARY_MAIN, 0.28)}` }
          },
          outlined: ({ theme: t }) => ({
            borderColor: t.palette.divider,
            color: t.palette.text.primary,
            backgroundColor: t.palette.background.paper,
            '&:hover': {
              borderColor: t.palette.primary.main,
              color: t.palette.primary.main,
              backgroundColor: alpha(t.palette.primary.main, 0.04)
            }
          })
        }
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 600, fontSize: TS.xs, borderRadius: 6, animation: 'chipIn 0.2s ease-out both' },
          label: { paddingLeft: 8, paddingRight: 8 }
        }
      },
      MuiSelect: {
        defaultProps: {
          MenuProps: {
            disableScrollLock: true,
            // SelectInput defaults to horizontal: 'center' — left-align dropdowns.
            anchorOrigin: { vertical: 'bottom', horizontal: 'left' },
            transformOrigin: { vertical: 'top', horizontal: 'left' },
            slotProps: {
              popper: ZOOM_AWARE_POPPER_PROPS,
              paper: {
                sx: {
                  mt: 0.75,
                  maxHeight: 340,
                  borderRadius: '12px',
                  border: '1px solid',
                  borderColor: 'divider',
                  boxShadow: (t) => t.shadows[8]
                }
              }
            }
          }
        }
      },
      MuiPopover: {
        defaultProps: {
          disableScrollLock: true,
          slotProps: FLOATING_PANEL_POPPER_SLOT,
        }
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: ({ theme: t }) => ({
            borderRadius: 8,
            backgroundColor: t.palette.background.paper,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: t.palette.divider },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#98A2B3' },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: t.palette.primary.main,
              borderWidth: 1,
              boxShadow: FOCUS_RING
            }
          })
        }
      },
      MuiMenu: {
        defaultProps: {
          disableScrollLock: true,
          slotProps: FLOATING_PANEL_POPPER_SLOT,
        },
        styleOverrides: {
          paper: ({ theme: t }) => ({ borderRadius: 12, boxShadow: t.shadows[8], border: '1px solid', borderColor: t.palette.divider })
        }
      },
      // Tooltip is Popper-based too, same as Select/Popover/Menu above, and
      // was missed when the zoom-anchor fix was first added - every tooltip
      // in the app (PagerDuty column, domain names, escalation chips, etc.)
      // has been positioning itself against the unscaled DOM rect instead of
      // the zoomed one ever since UI_SCALE was introduced.
      MuiTooltip: {
        defaultProps: {
          slotProps: { popper: ZOOM_AWARE_POPPER_PROPS },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: ({ theme: t }) => ({
            fontSize: TS.body,
            borderRadius: 8,
            marginLeft: 4,
            marginRight: 4,
            '&:hover': { backgroundColor: alpha(t.palette.primary.main, 0.06) },
            '&.Mui-selected, &.Mui-selected:hover': { backgroundColor: alpha(t.palette.primary.main, 0.09) }
          })
        }
      },
      MuiSwitch: {
        styleOverrides: {
          thumb: {
            boxShadow: '0 1px 3px rgba(16,24,40,0.24)',
            backgroundColor: '#FFFFFF',
          },
          track: ({ theme: t }) => ({
            backgroundColor: t.palette.grey[300],
            opacity: 1,
            border: '1px solid',
            borderColor: t.palette.grey[400],
          }),
          switchBase: ({ theme: t }) => ({
            '&.Mui-checked': { color: t.palette.primary.main },
            '&.Mui-checked + .MuiSwitch-track': {
              backgroundColor: t.palette.primary.main,
              borderColor: t.palette.primary.main,
              opacity: 1,
            },
          }),
        }
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: () => ({
            backgroundColor: '#0F172A',
            color: '#FFFFFF',
            fontSize: TS.body,
            fontWeight: 500,
            borderRadius: 8,
            padding: '6px 10px',
            boxShadow: '0 6px 18px rgba(0,0,0,0.24)'
          }),
          arrow: () => ({ color: '#0F172A'})
        }
      },
      MuiCheckbox: { styleOverrides: { root: { borderRadius: 6 } } },
      MuiSkeleton: { styleOverrides: { root: ({ theme: t }) => ({ borderRadius: 6, backgroundColor: alpha(t.palette.text.primary, 0.08) }) } },
      MuiIconButton: {
        styleOverrides: {
          root: ({ theme: t }) => ({
            borderRadius: 8,
            '&:focus-visible': { outline: `2px solid ${t.palette.primary.main}`, outlineOffset: 2 }
          })
        }
      },
      MuiPaper: {
        styleOverrides: {
          root: ({ theme: t }) => ({ backgroundImage: 'none', backgroundColor: t.palette.background.paper }),
        }
      },
      MuiTabs: {
        styleOverrides: {
          indicator: ({ theme: t }) => ({ height: 2, borderRadius: 2, backgroundColor: t.palette.primary.main }),
        }
      },
      MuiTab: {
        styleOverrides: {
          root: ({ theme: t }) => ({
            textTransform: 'none',
            fontSize: TS.body,
            fontWeight: 600,
            minHeight: 44,
            color: t.palette.text.secondary,
            '&.Mui-selected': { color: t.palette.text.primary }
          })
        }
      },
    }
  });
};

// NOTE: the app is light-mode only. There is no colour-mode context, no
// toggle, and no persisted preference - if a dark theme is wanted later, it
// belongs in createAppTheme() plus a provider, not in per-component branches.

// --- FIELD METADATA ---
// ======================================================
// FIELD METADATA
//
// Single source of truth for which certificate attributes the UI exposes and
// what they are called on screen. Adding a field to the registry means adding
// it here, not hunting through component files.
// ======================================================

// Columns offered by the per-column rules in the Filters popover.
const FILTERABLE_COLUMNS = [
  { value: 'domainName', label: 'Domain Name' },
  { value: 'certProvider', label: 'Cert Provider' },
  { value: 'expiryDate', label: 'Expiry Date' },
  { value: 'renewalFrequency', label: 'Renewal Frequency' },
  { value: 'teamOwner', label: 'Team Owner' },
  { value: 'manager', label: 'Manager' },
  { value: 'escalationMatrix', label: 'Escalation Matrix' },
  { value: 'slackAlerting', label: 'Slack Alerting' },
  { value: 'slackChannelName', label: 'Slack Channel Name' },
  { value: 'pagerDutyAlerting', label: 'PagerDuty Alerting' },
  { value: 'app', label: 'App' },
  { value: 'ci', label: 'CI' },
  { value: 'type', label: 'Type' },
  { value: 'environment', label: 'Environment' },
  { value: 'accountId', label: 'Account ID' },
];

// Columns the user can show/hide from the Columns menu. Everything except
// Domain (the row's identity) and Expiry (the reason the registry exists) is
// hideable - the menu used to control only 10 of the 16 columns, so Provider,
// the two alerting toggles and Runbook could not be turned off at all.
const OPTIONAL_COLUMNS = [
  { field: 'certProvider', label: 'Provider' },
  { field: 'teamOwner', label: 'Team owner' },
  { field: 'manager', label: 'Manager' },
  { field: 'environment', label: 'Environment' },
  { field: 'type', label: 'Type' },
  { field: 'app', label: 'App' },
  { field: 'ci', label: 'CI' },
  { field: 'renewalFrequency', label: 'Renewal frequency' },
  { field: 'escalationMatrix', label: 'Escalation matrix' },
  { field: 'slackAlerting', label: 'Slack alerting' },
  { field: 'slackChannelName', label: 'Slack channel' },
  { field: 'pagerDutyAlerting', label: 'PagerDuty' },
  { field: 'accountId', label: 'Account ID' },
  { field: 'runbook', label: 'Runbook' },
];

// All sixteen columns on by default. The table scrolls horizontally when they
// don't fit, with Domain pinned so the row is always identifiable while
// scrolled. Anything not needed can still be switched off in the Columns menu.
//
// NOTE: CSV export writes the *visible* columns, so a default export carries
// all sixteen. Hide a column and it drops out of the export too.
const DEFAULT_COLUMN_VISIBILITY = {
  domainName: true, certProvider: true, expiryDate: true, renewalFrequency: true,
  teamOwner: true, manager: true, escalationMatrix: true, slackAlerting: true,
  slackChannelName: true, pagerDutyAlerting: true, app: true, ci: true,
  type: true, environment: true, accountId: true, runbook: true,
};

// Detail drawer: tab labels, and the field lists each tab renders.
const DETAIL_TABS = ['Overview', 'Escalation', 'Alerts', 'Details', 'Runbook'];

const OVERVIEW_CERT_FIELDS = [
  { field: 'certProvider', label: 'Certificate Provider' },
  { field: 'renewalFrequency', label: 'Renewal Frequency' },
  { field: 'type', label: 'Type' },
  { field: 'environment', label: 'Environment' },
  { field: 'app', label: 'App' },
  { field: 'ci', label: 'CI' },
  { field: 'accountId', label: 'Account ID', mono: true },
];

const OVERVIEW_OWNERSHIP_FIELDS = [
  { field: 'teamOwner', label: 'Team Owner' },
  { field: 'manager', label: 'Manager' },
];

const DETAIL_FIELDS = [
  { field: 'certProvider', label: 'Certificate Provider' },
  { field: 'renewalFrequency', label: 'Renewal Frequency' },
  { field: 'teamOwner', label: 'Team Owner' },
  { field: 'manager', label: 'Manager' },
  { field: 'app', label: 'App' },
  { field: 'type', label: 'Type' },
  { field: 'environment', label: 'Environment' },
  { field: 'ci', label: 'CI' },
  { field: 'accountId', label: 'Account ID', mono: true },
  { field: 'slackChannelName', label: 'Slack Channel' },
];

// Status buckets mirror the thresholds in getCertStatus.
const STATUS_FILTER_OPTIONS = [
  { value: 'Expired', label: 'Expired' },
  { value: 'Critical', label: 'Critical (0-10 days)' },
  { value: 'Warning', label: 'Warning (11-30 days)' },
  { value: 'Good', label: 'Good (>30 days)' }
];

// The two buckets behind the "Expiring <= 30 Days" KPI card.
const EXPIRING_STATUSES = ['Critical', 'Warning'];

// Everything the header's alert list counts: expired plus the 30-day window.
const ATTENTION_STATUSES = ['Expired', ...EXPIRING_STATUSES];

const DEFAULT_ROWS_PER_PAGE = 10;
const ROWS_PER_PAGE_OPTIONS = [10, 15, 25, 50];

// Row height per density setting. Only rowHeight is driven from here rather
// than the DataGrid's own `density` prop, because that prop applies a
// multiplier on top of rowHeight and the two together are hard to predict.
export const DENSITY_OPTIONS = [
  { value: 'compact', label: 'Compact', rowHeight: 40 },
  { value: 'standard', label: 'Standard', rowHeight: 50 },
  { value: 'comfortable', label: 'Comfortable', rowHeight: 78 },
];
export const DEFAULT_DENSITY = 'standard';

export const resolveDensity = (density) =>
  DENSITY_OPTIONS.find((option) => option.value === density) ||
  DENSITY_OPTIONS.find((option) => option.value === DEFAULT_DENSITY);


// --- CERT STATUS & FORMATTING ---
// ======================================================
// CERTIFICATE STATUS + VALUE FORMATTING
//
// Pure functions over row data: no React, no DOM. Everything here is safe to
// unit-test with plain objects.
// ======================================================

export const EM_DASH = '\u2014';

export const displayValue = (value) => {
  if (value === null || value === undefined) return EM_DASH;
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  const text = String(value).trim();
  return text.length === 0 ? EM_DASH : text;
};

export const parseValidDate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseEscalationMatrix = (matrixStr) => {
  if (!matrixStr) return [];
  // Support both formats:
  //   "Name (L1), Name (L2)"  - parenthesised level suffix
  //   "L1:Name; L2:Name"       - colon-prefixed level, semicolon-delimited
  const colonFormat = /^(L\d+)\s*:\s*(.+)$/i;
  const parenFormat = /^(.+?)\s*\((L\d+)\)$/i;
  // Detect which delimiter is used: semicolons -> colon format, else comma -> paren format
  const entries = matrixStr.includes(';')
    ? matrixStr.split(';')
    : matrixStr.split(',');
  return entries
    .map((e) => e.trim())
    .filter(Boolean)
    .map((entry) => {
      const cm = entry.match(colonFormat);
      if (cm) return { level: cm[1].toUpperCase(), name: cm[2].trim() };
      const pm = entry.match(parenFormat);
      if (pm) return { level: pm[2].toUpperCase(), name: pm[1].trim() };
      return { level: '-', name: entry };
    });
};

// Derives "when this data was actually last written in DynamoDB" from the
// fetched rows, instead of just using the browser's fetch completion time.
//
// This checks several *common* field name candidates since the exact
// attribute name in your DynamoDB items wasn't confirmed. If your table
// uses a different attribute (e.g. "modifiedAt", "syncedAt"), add it to
// CANDIDATE_TIMESTAMP_FIELDS below - that's the only change needed.
const CANDIDATE_TIMESTAMP_FIELDS = ['updatedAt', 'lastUpdated', 'lastSyncedAt', 'lastModified', 'timestamp'];

const getLatestRowTimestamp = (rows) => {
  let latest = null;
  for (const row of rows) {
    for (const field of CANDIDATE_TIMESTAMP_FIELDS) {
      if (row[field]) {
        const parsed = new Date(row[field]);
        if (!isNaN(parsed) && (!latest || parsed > latest)) {
          latest = parsed;
        }
      }
    }
  }
  return latest;
};

// Certificates that need somebody to act, worst state first: everything
// already expired, then everything inside the 30-day window. Rows whose expiry
// date can't be parsed are left out rather than guessed at, so they can't
// masquerade as urgent. Feeds the alert list in the header.
const ATTENTION_WINDOW_DAYS = 30;

const getCertsNeedingAttention = (rows) =>
  rows
    .map((row) => ({ row, daysLeft: getDaysLeft(row.expiryDate) }))
    .filter(({ daysLeft }) => Number.isFinite(daysLeft) && daysLeft <= ATTENTION_WINDOW_DAYS)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .map(({ row, daysLeft }) => ({
      id: row.id,
      domainName: row.domainName,
      teamOwner: row.teamOwner,
      daysLeft,
      status: getCertStatus(daysLeft),
    }));

// Whole-registry counts for the KPI cards, in a single pass. Rows with an
// unparseable expiry date land in neither bucket rather than being guessed at.
export const summarizeCertificates = (rows) => {
  let expiringSoon = 0;
  let expired = 0;
  let critical = 0;
  let warning = 0;

  for (const row of rows) {
    const daysLeft = getDaysLeft(row.expiryDate);
    if (daysLeft < 0) expired += 1;
    else if (daysLeft <= 10) { critical += 1; expiringSoon += 1; }
    else if (daysLeft <= 30) { warning += 1; expiringSoon += 1; }
  }

  const good = Math.max(0, rows.length - expired - expiringSoon);
  return { total: rows.length, expiringSoon, expired, critical, warning, good };
};


// --- DASHBOARD & METRICS LOGIC ---
// ======================================================
// Pure, React-free derivations that power the Dashboard and Metrics views.
// Everything here reads only from `rows` (the same collection useCertificates
// already fetches) and the field helpers above (getDaysLeft, getCertStatus,
// parseEscalationMatrix, CANDIDATE_TIMESTAMP_FIELDS) - no new endpoints, no
// new dependencies. Kept as plain functions so each one stays trivial to
// unit-test with a plain rows array, matching filterCertificates above.
// ======================================================

// Treats a field as "missing" whether it's blank/undefined or the literal
// string some data sources use for "not set" (e.g. "N/A"). Superset of a
// simple falsy check, so it never misses a genuinely blank field either way.
const isBlankOrNA = (value) => {
  if (value === null || value === undefined) return true;
  const trimmed = String(value).trim();
  return trimmed === '' || trimmed.toUpperCase() === 'N/A';
};

// Counts rows by an arbitrary key function, returning [{label, value}]
// sorted by count descending. Backs every "by category" breakdown across
// Dashboard and Metrics (provider, team, manager, renewal frequency, etc.).
const countBy = (rows, keyFn) => {
  const counts = new Map();
  rows.forEach((row) => {
    const key = keyFn(row) || 'Unspecified';
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
};

// Status mix across the whole registry, for the Dashboard donut. Colors are
// assigned by the component layer (statusChartColorsFor), since Expired and
// Critical share a colorKey ('error') in getCertStatus but need to read as
// visually distinct slices here.
const computeStatusBreakdown = (rows) => {
  const counts = { Good: 0, Warning: 0, Critical: 0, Expired: 0 };
  rows.forEach((row) => {
    const { label } = getCertStatus(getDaysLeft(row.expiryDate));
    counts[label] = (counts[label] || 0) + 1;
  });
  // The 4 known labels are always returned first, in a fixed order, so chart
  // rendering stays stable. But getCertStatus is only *contracted* to return
  // one of those 4 - a null/unparseable expiryDate, or any future status
  // tier, would previously fall outside this hardcoded list and vanish from
  // the total silently (counted internally, then dropped on return). Any
  // extra label that shows up still gets surfaced instead of disappearing.
  const KNOWN_STATUS_LABELS = ['Good', 'Warning', 'Critical', 'Expired'];
  const extraLabels = Object.keys(counts).filter((label) => !KNOWN_STATUS_LABELS.includes(label));
  return [
    ...KNOWN_STATUS_LABELS.map((label) => ({ label, value: counts[label] })),
    ...extraLabels.map((label) => ({ label, value: counts[label] })),
  ];
};

// Certificates expiring over the next `monthsAhead` calendar months, bucketed
// by month, for the Dashboard's upcoming-expirations chart.
const computeMonthlyExpiry = (rows, monthsAhead = 6) => {
  const now = new Date();
  const buckets = [];
  for (let i = 0; i < monthsAhead; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('en-US', { month: 'short' }), value: 0 });
  }
  rows.forEach((row) => {
    const parsed = parseValidDate(row.expiryDate);
    if (!parsed) return;
    const key = `${parsed.getFullYear()}-${parsed.getMonth()}`;
    const bucket = buckets.find((b) => b.key === key);
    if (bucket) bucket.value += 1;
  });
  return buckets;
};

// Status breakdown per environment, so Production risk doesn't hide behind
// an aggregate figure that includes Dev/Staging.
const computeEnvironmentRisk = (rows) => {
  const byEnv = new Map();
  rows.forEach((row) => {
    const env = row.environment || 'Unspecified';
    if (!byEnv.has(env)) byEnv.set(env, { env, Good: 0, Warning: 0, Critical: 0, Expired: 0, total: 0 });
    const entry = byEnv.get(env);
    const { label } = getCertStatus(getDaysLeft(row.expiryDate));
    // Same defensive fix as computeStatusBreakdown above: entry only
    // pre-declares the 4 known labels, so a label outside that set (e.g.
    // from a null/unparseable expiryDate) used to compute entry[label] as
    // undefined + 1 = NaN, silently corrupting that environment's group
    // instead of erroring or being visibly counted.
    entry[label] = (entry[label] ?? 0) + 1;
    entry.total += 1;
  });
  return Array.from(byEnv.values()).sort((a, b) => b.total - a.total);
};

// Three-tier alerting posture: both channels on, one channel on, or
// completely unmonitored.
const computeAlertingMatrix = (rows) => {
  let full = 0, partial = 0, none = 0;
  rows.forEach((row) => {
    if (row.slackAlerting && row.pagerDutyAlerting) full += 1;
    else if (row.slackAlerting || row.pagerDutyAlerting) partial += 1;
    else none += 1;
  });
  return { full, partial, none, total: rows.length };
};

// Per-team risk: total certs vs. how many are currently critical/expired, so
// exposure is visible, not just headcount of certificates.
const computeTeamRisk = (rows) => {
  const byTeam = new Map();
  rows.forEach((row) => {
    const team = row.teamOwner || 'Unspecified';
    const { label } = getCertStatus(getDaysLeft(row.expiryDate));
    if (!byTeam.has(team)) byTeam.set(team, { team, total: 0, atRisk: 0 });
    const entry = byTeam.get(team);
    entry.total += 1;
    if (label === 'Critical' || label === 'Expired') entry.atRisk += 1;
  });
  return Array.from(byTeam.values()).sort((a, b) => b.atRisk - a.atRisk || b.total - a.total);
};

// Data-quality scorecard - the % of certificates missing each governance
// field, so cleanup progress can be tracked over time instead of hunting for
// gaps row by row.
const computeMissingMetadata = (rows) => {
  const total = rows.length || 1;
  const fields = [
    { key: 'teamOwner', label: 'Team Owner' },
    { key: 'manager', label: 'Manager' },
    { key: 'runbookUrl', label: 'Runbook' },
    { key: 'slackChannelName', label: 'Slack Channel' },
    { key: 'escalationMatrix', label: 'Escalation Matrix' },
  ];
  return fields
    .map((f) => {
      const missing = rows.filter((r) => isBlankOrNA(r[f.key])).length;
      return { label: f.label, value: missing, pct: Math.round((missing / total) * 100) };
    })
    .sort((a, b) => b.value - a.value);
};

// Tallies every name appearing anywhere in every certificate's escalation
// matrix, surfacing who's carrying the most L1/L2/L3 load fleet-wide.
const computeEscalationLoad = (rows) => {
  const counts = new Map();
  rows.forEach((row) => {
    parseEscalationMatrix(row.escalationMatrix).forEach((contact) => {
      const key = (contact.name || '').trim();
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
  });
  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
};

// AWS accounts ranked by how many critical/expired certs they hold - a
// prioritization list for account owners, not just an inventory count.
const computeAccountRisk = (rows) => {
  const byAccount = new Map();
  rows.forEach((row) => {
    const acct = row.accountId ? String(row.accountId) : 'Unspecified';
    if (!byAccount.has(acct)) byAccount.set(acct, { account: acct, total: 0, atRisk: 0 });
    const entry = byAccount.get(acct);
    entry.total += 1;
    const { label } = getCertStatus(getDaysLeft(row.expiryDate));
    if (label === 'Critical' || label === 'Expired') entry.atRisk += 1;
  });
  return Array.from(byAccount.values())
    .filter((a) => a.atRisk > 0)
    .sort((a, b) => b.atRisk - a.atRisk || b.total - a.total);
};

// Certificates whose backing row hasn't been touched in the longest time,
// per CANDIDATE_TIMESTAMP_FIELDS - reuses the same field-guessing logic
// getLatestRowTimestamp relies on, so both stay in sync if the real
// attribute name is ever confirmed and simplified.
const computeStaleCerts = (rows) => {
  const withTimestamp = rows
    .map((row) => {
      let ts = null;
      for (const field of CANDIDATE_TIMESTAMP_FIELDS) {
        if (row[field]) {
          const parsed = parseValidDate(row[field]);
          if (parsed) { ts = parsed; break; }
        }
      }
      return { row, ts };
    })
    .filter((entry) => entry.ts);
  return withTimestamp.sort((a, b) => a.ts - b.ts);
};

// Soonest-to-expire certificates, for the Dashboard's quick-glance list.
const computeSoonestToExpire = (rows, limit = 5) =>
  [...rows]
    .filter((row) => parseValidDate(row.expiryDate))
    .sort((a, b) => getDaysLeft(a.expiryDate) - getDaysLeft(b.expiryDate))
    .slice(0, limit);


// --- FILTER LOGIC ---
// Operators offered by the per-column filter rules in the Filters popover.
// 'notEquals' keeps its original id because that is what the rule state already
// stores, even though it used to be mislabelled in the UI as "doesn't contain".
const FILTER_OPERATORS = [
  { value: 'contains', label: 'contains' },
  { value: 'notContains', label: 'does not contain' },
  { value: 'equals', label: 'equal to' },
  { value: 'notEquals', label: 'not equal to' },
  { value: 'isEmpty', label: 'is empty' },
  { value: 'isNotEmpty', label: 'is not empty' },
];

// These two test the cell itself rather than compare it against something, so
// they apply with no operand typed.
const VALUELESS_OPERATORS = ['isEmpty', 'isNotEmpty'];

// A rule only narrows the results once it has an operand - unless its operator
// needs none. Used both by the filtering below and by the active-filter count.
export const isFilterRuleActive = (rule) =>
  VALUELESS_OPERATORS.includes(rule.operator) || (rule.value ?? '').trim().length > 0;

// Rule ids only need to be unique within a single rules array (they're used
// as React keys and for add/remove/update lookups). A module-level mutable
// counter made that harder to reason about across hook instances, tests, and
// HMR reloads in dev - this factory hands each caller (each useCertificateView
// instance, or a test) its own private, closure-scoped sequence instead.
const createRuleIdGenerator = () => {
  let counter = 0;
  return () => `rule-${++counter}`;
};
const emptyFilterRule = (nextId) => ({ id: nextId(), column: 'domainName', operator: 'contains', value: '' });

// Dropdown options are derived from the data rather than hardcoded, since the
// actual set of values (environments, providers, teams, managers) lives in the
// backend and shouldn't be guessed here.
const uniqueSortedValues = (rows, field) =>
  Array.from(new Set(rows.map((row) => row[field]).filter(Boolean))).sort();

// Pure filtering logic, extracted so it can be unit-tested with plain data
// arrays - no rendering, no DOM, no mocking fetch. The component calls this
// inside a useMemo; tests call it directly. Keep this function free of any
// React/DOM concerns so it stays trivial to test.
export const filterCertificates = (rows, filters) => {
  const {
    searchText = '',
    selectedProviders = [],
    selectedTeams = [],
    selectedManagers = [],
    selectedStatuses = [],
    selectedEnvironments = [],
    selectedTypes = [],
    filterRules = [],
  } = filters;

  return rows.filter((row) => {
    const domainName = row.domainName || '';
    const appName = row.app || '';
    const team = row.teamOwner || '';
    const mgr = row.manager || '';
    const acctId = row.accountId ? String(row.accountId) : '';
    const provider = row.certProvider || '';
    const search = searchText.toLowerCase();

    const matchesSearch =
      domainName.toLowerCase().includes(search) ||
      appName.toLowerCase().includes(search) ||
      team.toLowerCase().includes(search) ||
      mgr.toLowerCase().includes(search) ||
      acctId.toLowerCase().includes(search) ||
      provider.toLowerCase().includes(search);

    const matchesProvider = selectedProviders.length === 0 || selectedProviders.includes(row.certProvider);
    const matchesTeam = selectedTeams.length === 0 || selectedTeams.includes(row.teamOwner);
    const matchesManager = selectedManagers.length === 0 || selectedManagers.includes(row.manager);
    const matchesEnvironment = selectedEnvironments.length === 0 || selectedEnvironments.includes(row.environment);
    const matchesType = selectedTypes.length === 0 || selectedTypes.includes(row.type);

    const daysLeft = getDaysLeft(row.expiryDate);
    const { label: status } = getCertStatus(daysLeft);
    const matchesStatus = selectedStatuses.length === 0 || selectedStatuses.includes(status);

    const matchesCustomRules = filterRules.every((rule) => {
      if (!isFilterRuleActive(rule)) return true;

      let rawVal = row[rule.column];
      if (typeof rawVal === 'boolean') rawVal = rawVal ? 'On' : 'Off';

      // Null-safe rather than falsy-safe: a legitimate 0 must not be reported
      // as an empty cell by the isEmpty / isNotEmpty operators.
      const rowValue = rawVal === null || rawVal === undefined ? '' : String(rawVal).toLowerCase();
      const targetValue = (rule.value ?? '').trim().toLowerCase();

      switch (rule.operator) {
        case 'isEmpty':
          return rowValue.length === 0;
        case 'isNotEmpty':
          return rowValue.length > 0;
        case 'equals':
          return rowValue === targetValue;
        case 'notEquals':
          return rowValue !== targetValue;
        case 'notContains':
          return !rowValue.includes(targetValue);
        case 'contains':
        default:
          return rowValue.includes(targetValue);
      }
    });

    return matchesSearch && matchesProvider && matchesTeam && matchesStatus && matchesManager && matchesEnvironment && matchesType && matchesCustomRules;
  });
};


// --- SHAREABLE VIEW URL ---
// ======================================================
// SHAREABLE VIEWS
//
// The whole filter state round-trips through the query string so a narrowed
// view can be bookmarked or pasted into a ticket, and survives a reload.
//
// Anything read back out of the URL is untrusted input, so it is parsed
// defensively: column/operator/status values must appear in their
// allowlists, free-text values are length-capped, and the number of entries
// is bounded. Parsed values are only ever compared as strings by
// filterCertificates - nothing here is evaluated or used to build a path.
// ======================================================
const URL_PARAM = {
  search: 'q',
  environments: 'env',
  types: 'type',
  providers: 'provider',
  teams: 'team',
  managers: 'manager',
  statuses: 'status',
  rule: 'rule',
  density: 'density',
};

const KNOWN_DENSITY_VALUES = DENSITY_OPTIONS.map((option) => option.value);

const MAX_URL_VALUE_LENGTH = 120;
const MAX_URL_ENTRIES = 50;
const RULE_SEPARATOR = '~';

const KNOWN_STATUS_VALUES = STATUS_FILTER_OPTIONS.map((option) => option.value);
const KNOWN_FILTER_COLUMNS = FILTERABLE_COLUMNS.map((column) => column.value);
const KNOWN_FILTER_OPERATORS = FILTER_OPERATORS.map((operator) => operator.value);

const readUrlList = (params, key, allowlist) => {
  const values = params
    .getAll(key)
    .map((entry) => entry.trim().slice(0, MAX_URL_VALUE_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_URL_ENTRIES);
  const allowed = allowlist ? values.filter((value) => allowlist.includes(value)) : values;
  return Array.from(new Set(allowed));
};

const readUrlRules = (params, nextId) =>
  params
    .getAll(URL_PARAM.rule)
    .slice(0, MAX_URL_ENTRIES)
    .map((entry) => {
      // Only the first two separators are structural; the rest belong to the
      // value, which may legitimately contain a tilde.
      const [column, operator, ...valueParts] = entry.split(RULE_SEPARATOR);
      if (!KNOWN_FILTER_COLUMNS.includes(column)) return null;
      if (!KNOWN_FILTER_OPERATORS.includes(operator)) return null;
      return {
        id: nextId(),
        column,
        operator,
        value: valueParts.join(RULE_SEPARATOR).slice(0, MAX_URL_VALUE_LENGTH),
      };
    })
    .filter((rule) => rule !== null && isFilterRuleActive(rule));

// `nextId` defaults to a fresh generator so this stays a pure, directly
// testable function for anyone calling it outside a hook (unit tests,
// storybook, etc.) without having to thread a generator through by hand.
export const readViewFromSearch = (search, nextId = createRuleIdGenerator()) => {
  const params = new URLSearchParams(search || '');
  const density = params.get(URL_PARAM.density);
  return {
    searchText: (params.get(URL_PARAM.search) || '').slice(0, MAX_URL_VALUE_LENGTH),
    environments: readUrlList(params, URL_PARAM.environments),
    types: readUrlList(params, URL_PARAM.types),
    providers: readUrlList(params, URL_PARAM.providers),
    teams: readUrlList(params, URL_PARAM.teams),
    managers: readUrlList(params, URL_PARAM.managers),
    statuses: readUrlList(params, URL_PARAM.statuses, KNOWN_STATUS_VALUES),
    rules: readUrlRules(params, nextId),
    // Anything outside the allowlist falls back to the default rather than
    // being passed through to the grid as an unknown row height.
    density: KNOWN_DENSITY_VALUES.includes(density) ? density : DEFAULT_DENSITY,
  };
};

export const buildViewSearch = (view) => {
  const params = new URLSearchParams();
  const appendAll = (key, values) => values.forEach((value) => params.append(key, value));

  if (view.searchText.trim()) params.set(URL_PARAM.search, view.searchText.trim());
  appendAll(URL_PARAM.environments, view.environments);
  appendAll(URL_PARAM.types, view.types);
  appendAll(URL_PARAM.providers, view.providers);
  appendAll(URL_PARAM.teams, view.teams);
  appendAll(URL_PARAM.managers, view.managers);
  appendAll(URL_PARAM.statuses, view.statuses);
  // The default density is implied by its absence, so a shared link only
  // carries it when the sender actually changed it.
  if (view.density && view.density !== DEFAULT_DENSITY) params.set(URL_PARAM.density, view.density);
  view.rules
    .filter(isFilterRuleActive)
    .forEach((rule) =>
      params.append(URL_PARAM.rule, [rule.column, rule.operator, rule.value].join(RULE_SEPARATOR))
    );

  return params.toString();
};


// --- CSV EXPORT ---
// ======================================================
// CSV EXPORT
//
// Cells are quoted and embedded quotes doubled per RFC 4180. Values that a
// spreadsheet would treat as a formula are prefixed with an apostrophe, so a
// domain or channel name stored as "=HYPERLINK(...)" cannot execute when the
// export is opened in Excel or Sheets.
// ======================================================
const CSV_FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

const toCsvCell = (value) => {
  let text;
  if (value === null || value === undefined) text = '';
  else if (typeof value === 'boolean') text = value ? 'On' : 'Off';
  else text = String(value);

  const guarded = CSV_FORMULA_TRIGGERS.some((trigger) => text.startsWith(trigger)) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
};

export const buildCsv = (rows, exportColumns) => {
  const header = exportColumns.map((column) => toCsvCell(column.label)).join(',');
  const body = rows.map((row) => exportColumns.map((column) => toCsvCell(row[column.field])).join(','));
  return [header, ...body].join('\r\n');
};

// The grid column that renders the runbook button is keyed 'runbook', while
// the URL itself lives on 'runbookUrl'. Without this the export column would
// come out empty.
const CSV_FIELD_ALIASES = { runbook: 'runbookUrl' };

// Exports exactly what is on screen: the given rows, in the current column
// order, with hidden columns left out. Returns the number of exported rows.
const downloadRowsAsCsv = ({ rows, columns, visibilityModel, filenamePrefix = 'cert-registry' }) => {
  if (rows.length === 0) return 0;

  const exportColumns = columns
    .filter((column) => visibilityModel[column.field] !== false)
    .map((column) => ({
      field: CSV_FIELD_ALIASES[column.field] || column.field,
      label: column.headerName,
    }));

  const csv = buildCsv(rows, exportColumns);
  // Leading BOM so Excel opens UTF-8 domains and names correctly.
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);

  return rows.length;
};


// --- API (edit API_BASE_URL and API_KEY here) ---
// ======================================================
// CERT REGISTRY API
//
// Every network call the app makes lives here, so endpoints and auth are in
// one place instead of scattered through components.
//
// SECURITY NOTE: API_KEY is embedded directly in this frontend bundle,
// which means anyone who opens browser DevTools -> Sources (or just views
// the built JS file) can read it in plaintext. This isnt a real secret
// once it ships to a browser - it only adds friction against casual
// scraping, not against anyone who actually looks. If this key grants
// meaningful access (e.g. beyond simple rate-limiting), consider moving
// write operations behind an authenticated backend-for-frontend, or at
// minimum restrict this key's usage plan tightly in API Gateway (IP
// allowlist / low rate limit) so a leaked key can't be abused broadly.
// ======================================================
const API_BASE_URL = 'https://eexsud7.execute-api.us-east-1.amazonaws.com';
const AGGREGATED_DATA_ENDPOINT = `${API_BASE_URL}/AggregatedData`;
const PREFERENCES_ENDPOINT = `${API_BASE_URL}/Preferences`;

const API_KEY = 'NDkjfbnhfjfdsfdfeefe';

// `accountId` arriving as a JSON *number* rather than a string is lossy past
// Number.MAX_SAFE_INTEGER (2^53-1): JSON.parse() has already rounded it by
// the time this code runs, so there is no way to recover the original value
// client-side - this can only truly be fixed by the API sending accountId as
// a string. What the frontend CAN do is detect the corruption instead of
// silently propagating it, and refuse to submit a write built from a value
// that's already wrong rather than risk updating the wrong account.
const isUnsafeNumericAccountId = (accountId) =>
  typeof accountId === 'number' && !Number.isSafeInteger(accountId);

// Reads the whole registry. The caller passes an AbortSignal so an in-flight
// request can be superseded by a newer one.
const fetchCertificates = async ({ signal } = {}) => {
  const response = await fetch(AGGREGATED_DATA_ENDPOINT, {
    headers: { 'x-api-key': API_KEY },
    signal
  });
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return response.json();
};

// Pure network/business logic for a single toggle update, decoupled from
// React state. Takes a fetch implementation as a parameter (dependency
// injection) so tests can pass a mock fetch and assert on the request body
// and the returned outcome, without rendering any component or the DataGrid.
//
// Returns one of three shapes:
//   { outcome: 'success', data }
//   { outcome: 'conflict' }              - backend returned 409 (optimistic lock lost)
//   { outcome: 'error', error }          - network failure or non-2xx/409 response
const updateCertPreference = async (fetchImpl, apiKey, { accountId, domainCert, field, value, previousValue }) => {
  try {
    const response = await fetchImpl(PREFERENCES_ENDPOINT, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify({ accountId, domainCert, field, value, previousValue })
    });

    if (response.status === 409) {
      return { outcome: 'conflict' };
    }

    if (!response.ok) {
      return { outcome: 'error', error: new Error(`API responded with status: ${response.status}`) };
    }

    const data = await response.json();
    return { outcome: 'success', data };
  } catch (error) {
    return { outcome: 'error', error };
  }
};


// --- HOOKS ---
// Debounces a fast-changing value (typically search text) so expensive
// consumers - here, a full filterCertificates() pass over every row - don't
// re-run on every keystroke. Returns the lagged value; the caller keeps using
// the live value for the input itself, so typing never feels delayed.
function useDebouncedValue(value, delay = 200) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// Transient, non-blocking user feedback: { severity, message, key }. The key
// forces the Snackbar to restart its timer when one notice replaces another.
function useNotice() {
  const [notice, setNotice] = useState(null);

  const showNotice = useCallback(
    (severity, message) => setNotice({ severity, message, key: Date.now() }),
    []
  );

  const clearNotice = useCallback(() => setNotice(null), []);

  return { notice, showNotice, clearNotice };
}


// ======================================================
// Owns the certificate collection: loading it, refreshing it, and writing
// alerting preferences back with an optimistic update.
//
// `onNotice(severity, message)` is used for user-facing failures; it must be a
// stable callback, because toggleAlerting is memoised against it and the grid's
// column definitions depend on that identity.
// ======================================================
function useCertificates({ onNotice }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(() => new Date());
  const [fetchError, setFetchError] = useState(null);

  // Keeps a live reference to the latest 'rows' without needing 'rows' itself
  // in toggleAlerting's dependency array. Without this, toggleAlerting (and the
  // 'columns' memo that depends on it) would be recreated on every single
  // row update, forcing the whole DataGrid to re-render each toggle/refresh.
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  // Tracks the in-flight certificate request so a newly started one can cancel
  // the previous. Without this, two overlapping refreshes resolve in whatever
  // order the network returns them, and a slow earlier response can overwrite
  // the newer data that is already on screen.
  const inFlightFetchRef = useRef(null);

  const loadCertificates = useCallback(async () => {
    // Supersede any request still in flight, so only the most recent one is
    // allowed to write to state.
    inFlightFetchRef.current?.abort();
    const controller = new AbortController();
    inFlightFetchRef.current = controller;

    setLoading(true);
    setFetchError(null);
    try {
      const data = await fetchCertificates({ signal: controller.signal });
      setRows(data);

      // Detect (not repair - see isUnsafeNumericAccountId comment above)
      // rows whose accountId already lost precision before this code ever
      // saw it, so it shows up in the console/telemetry instead of only
      // surfacing later as a blocked write on whatever row a user happens
      // to touch.
      const unsafeAccountRows = data.filter((row) => isUnsafeNumericAccountId(row.accountId));
      if (unsafeAccountRows.length > 0) {
        console.warn(
          `${unsafeAccountRows.length} row(s) have an accountId beyond Number.MAX_SAFE_INTEGER - ` +
          'the value is already corrupted by JSON parsing and the API should send accountId as a string. ' +
          'Affected domains:', unsafeAccountRows.slice(0, 10).map((r) => r.domainName)
        );
      }

      const latestFromData = getLatestRowTimestamp(data);
      if (latestFromData) {
        setLastUpdated(latestFromData);
      } else {
        // No recognized timestamp field found on any row - falls back to
        // fetch time so the UI still shows *something*, but this means
        // "Last Updated" is showing when the browser fetched, not when
        // DynamoDB actually last wrote the data. Check the console warning
        // below and confirm the real field name if this fires.
        console.warn(
          'No recognized timestamp field found on fetched rows - "Last Updated" is showing fetch time, not the actual DynamoDB write time. Add the real field name to CANDIDATE_TIMESTAMP_FIELDS.'
        );
        setLastUpdated(new Date());
      }
    } catch (error) {
      // A newer request (or unmount) cancelled this one. It is not a failure,
      // and the request that replaced it owns the loading state from here.
      if (error.name === 'AbortError') return;

      console.error('Error fetching certificates from API Gateway:', error);
      setFetchError("Couldn't load certificates from the registry. Please try refreshing.");
    } finally {
      if (inFlightFetchRef.current === controller) {
        inFlightFetchRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadCertificates();
    return () => inFlightFetchRef.current?.abort();
  }, [loadCertificates]);

  const toggleAlerting = useCallback(async (id, field) => {
    const rowToUpdate = rowsRef.current.find((r) => r.id === id);
    if (!rowToUpdate) return;

    // Guard against rows missing either key attribute. Without this,
    // a missing 'Domain#cert' silently drops out of JSON.stringify
    // (undefined values are omitted), and the backend fails with the
    // same confusing KeyError we hit before - just for a new reason.
    const domainCert = rowToUpdate['Domain#cert'];
    if (!rowToUpdate.accountId || !domainCert) {
      console.error('Row is missing accountId or Domain#cert, cannot update:', rowToUpdate);
      onNotice('warning', 'This row is missing required data and could not be updated.');
      return;
    }

    // accountId already lost precision before this code ran (see
    // isUnsafeNumericAccountId above) - submitting it would write alerting
    // preferences against a different, wrong account. Block the write
    // rather than silently corrupt someone else's account's settings.
    if (isUnsafeNumericAccountId(rowToUpdate.accountId)) {
      console.error('Refusing to update - accountId exceeds safe integer precision:', rowToUpdate);
      onNotice('error', "This certificate's account ID can't be safely represented and was not updated. Contact the platform team.");
      return;
    }

    const previousValue = !!rowToUpdate[field];
    const newValue = !previousValue;
    const nowIso = new Date().toISOString();

    setRows((prevRows) =>
      prevRows.map((row) => (row.id === id ? { ...row, [field]: newValue } : row))
    );

    const result = await updateCertPreference(fetch, API_KEY, {
      accountId: rowToUpdate.accountId,
      domainCert,
      field,
      value: newValue,
      previousValue
    });

    const revert = () =>
      setRows((prevRows) =>
        prevRows.map((row) => (row.id === id ? { ...row, [field]: rowToUpdate[field] } : row))
      );

    if (result.outcome === 'conflict') {
      onNotice('warning', 'This preference was changed by someone else in the meantime. Refreshing the latest data now.');
      revert();
      loadCertificates();
      return;
    }

    if (result.outcome === 'error') {
      console.error('Failed to save toggle state to database:', result.error);
      revert();
      onNotice('error', 'Failed to update alerting preferences. The switch has been reverted.');
      return;
    }

    // This toggle just wrote to DynamoDB successfully, so "now" genuinely
    // is the latest write time - update both the displayed timestamp and
    // the row's own timestamp field, so a subsequent full refresh (which
    // recomputes from getLatestRowTimestamp) stays consistent with what's
    // shown immediately after this toggle.
    setLastUpdated(new Date());
    setRows((prevRows) =>
      prevRows.map((row) => (row.id === id ? { ...row, updatedAt: nowIso } : row))
    );
  }, [loadCertificates, onNotice]);

  return { rows, loading, lastUpdated, fetchError, refresh: loadCertificates, toggleAlerting };
}


// ======================================================
// Owns everything about "what the user is currently looking at": the search
// box, the five dropdowns, the per-column rules, row density, and the derived
// filter result. The view is mirrored into the query string so it can be
// bookmarked or shared.
// ======================================================
function useCertificateView(rows) {
  // Each hook instance owns its own rule-id sequence rather than sharing a
  // module-level counter - keeps id generation local to this view, so two
  // mounted instances (or two test runs) never share or race on the same
  // counter, and HMR reloading this module doesn't leave a stale count behind.
  const nextRuleId = useRef(createRuleIdGenerator()).current;

  // Restores a shared or bookmarked view. Parsed once on mount; from then on
  // the URL follows the state rather than the other way round.
  const [initialView] = useState(() => readViewFromSearch(window.location.search, nextRuleId));

  const [searchText, setSearchText] = useState(initialView.searchText);
  const [selectedProviders, setSelectedProviders] = useState(initialView.providers);
  const [selectedTeams, setSelectedTeams] = useState(initialView.teams);
  const [selectedStatuses, setSelectedStatuses] = useState(initialView.statuses);
  const [selectedManagers, setSelectedManagers] = useState(initialView.managers);
  const [selectedEnvironments, setSelectedEnvironments] = useState(initialView.environments);
  const [selectedTypes, setSelectedTypes] = useState(initialView.types);
  const [filterRules, setFilterRules] = useState(
    initialView.rules.length > 0 ? initialView.rules : [emptyFilterRule(nextRuleId)]
  );
  const [density, setDensity] = useState(initialView.density);

  // The search box itself must stay instantly responsive (it's bound directly
  // to searchText below), but re-running filterCertificates() over the full
  // row set on every keystroke is wasted work once the dataset gets large -
  // measured at 15-60ms per pass on a 10,000-row set. Only the value handed
  // to the filter is debounced; nothing about typing itself feels different.
  const debouncedSearchText = useDebouncedValue(searchText, 200);

  // Mirrors the current view into the query string. replaceState rather than
  // pushState, so typing in the search box doesn't bury the back button under
  // one history entry per keystroke.
  useEffect(() => {
    const query = buildViewSearch({
      searchText,
      environments: selectedEnvironments,
      types: selectedTypes,
      providers: selectedProviders,
      teams: selectedTeams,
      managers: selectedManagers,
      statuses: selectedStatuses,
      rules: filterRules,
      density,
    });
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}`;
    window.history.replaceState(null, '', nextUrl);
  }, [searchText, selectedEnvironments, selectedTypes, selectedProviders, selectedTeams, selectedManagers, selectedStatuses, filterRules, density]);

  const options = useMemo(
    () => ({
      environments: uniqueSortedValues(rows, 'environment'),
      types: uniqueSortedValues(rows, 'type'),
      providers: uniqueSortedValues(rows, 'certProvider'),
      teams: uniqueSortedValues(rows, 'teamOwner'),
      managers: uniqueSortedValues(rows, 'manager'),
    }),
    [rows]
  );

  const filteredRows = useMemo(
    () =>
      filterCertificates(rows, {
        searchText: debouncedSearchText,
        selectedProviders,
        selectedTeams,
        selectedManagers,
        selectedStatuses,
        selectedEnvironments,
        selectedTypes,
        filterRules,
      }),
    [rows, debouncedSearchText, selectedProviders, selectedTeams, selectedStatuses, selectedManagers, selectedEnvironments, selectedTypes, filterRules]
  );

  const addFilterRule = useCallback(
    () => setFilterRules((prev) => [...prev, emptyFilterRule(nextRuleId)]),
    [nextRuleId]
  );

  const removeFilterRule = useCallback(
    (id) => setFilterRules((prev) => prev.filter((rule) => rule.id !== id)),
    []
  );

  const resetFilterRules = useCallback(
    () => setFilterRules([emptyFilterRule(nextRuleId)]),
    [nextRuleId]
  );

  const updateFilterRule = useCallback(
    (id, field, value) =>
      setFilterRules((prev) =>
        prev.map((rule) => {
          if (rule.id !== id) return rule;
          const updated = { ...rule, [field]: value };
          // Switching to "is empty" / "is not empty" discards any operand typed
          // under the previous operator, so the disabled input can't show a stale
          // value that no longer affects the results.
          if (field === 'operator' && VALUELESS_OPERATORS.includes(value)) updated.value = '';
          return updated;
        })
      ),
    []
  );

  const resetAllFilters = useCallback(() => {
    setSearchText('');
    setSelectedProviders([]);
    setSelectedTeams([]);
    setSelectedStatuses([]);
    setSelectedManagers([]);
    setSelectedEnvironments([]);
    setSelectedTypes([]);
    setFilterRules([emptyFilterRule()]);
  }, []);

  const hasActiveFilters =
    Boolean(searchText) ||
    selectedProviders.length > 0 ||
    selectedTeams.length > 0 ||
    selectedStatuses.length > 0 ||
    selectedManagers.length > 0 ||
    selectedEnvironments.length > 0 ||
    selectedTypes.length > 0 ||
    filterRules.some(isFilterRuleActive);

  // Count of active filter groups, shown as a badge on the Filters button.
  const activeFilterCount =
    (searchText ? 1 : 0) +
    (selectedEnvironments.length > 0 ? 1 : 0) +
    (selectedTypes.length > 0 ? 1 : 0) +
    (selectedProviders.length > 0 ? 1 : 0) +
    (selectedTeams.length > 0 ? 1 : 0) +
    (selectedManagers.length > 0 ? 1 : 0) +
    (selectedStatuses.length > 0 ? 1 : 0) +
    filterRules.filter(isFilterRuleActive).length;

  // True when the status dropdown holds exactly the given bucket(s) - used by
  // the KPI cards to show themselves as the active quick filter.
  const matchesStatusSelection = useCallback(
    (wanted) =>
      selectedStatuses.length === wanted.length && wanted.every((status) => selectedStatuses.includes(status)),
    [selectedStatuses]
  );

  // One chip per applied value, each individually removable, so it's always
  // visible what is narrowing the table without reopening every dropdown.
  const activeFilterChips = useMemo(() => {
    const chips = [];

    if (searchText.trim()) {
      chips.push({
        key: 'search',
        group: 'Search',
        label: `"${searchText.trim()}"`,
        onDelete: () => setSearchText(''),
      });
    }

    const pushValues = (group, values, setter, resolveLabel) =>
      values.forEach((value) =>
        chips.push({
          key: `${group}:${value}`,
          group,
          label: resolveLabel ? resolveLabel(value) : value,
          onDelete: () => setter(values.filter((entry) => entry !== value)),
        })
      );

    pushValues('Type', selectedTypes, setSelectedTypes);
    pushValues('Environment', selectedEnvironments, setSelectedEnvironments);
    pushValues('Provider', selectedProviders, setSelectedProviders);
    pushValues('Team', selectedTeams, setSelectedTeams);
    pushValues('Manager', selectedManagers, setSelectedManagers);
    pushValues('Status', selectedStatuses, setSelectedStatuses, (value) =>
      (STATUS_FILTER_OPTIONS.find((option) => option.value === value) || {}).label || value
    );

    filterRules.filter(isFilterRuleActive).forEach((rule) => {
      const column = FILTERABLE_COLUMNS.find((entry) => entry.value === rule.column);
      const operator = FILTER_OPERATORS.find((entry) => entry.value === rule.operator);
      const operatorLabel = (operator ? operator.label : rule.operator).toLowerCase();
      chips.push({
        key: `rule:${rule.id}`,
        group: column ? column.label : rule.column,
        label: VALUELESS_OPERATORS.includes(rule.operator)
          ? operatorLabel
          : `${operatorLabel} "${rule.value}"`,
        onDelete: () =>
          setFilterRules((prev) => {
            const next = prev.filter((entry) => entry.id !== rule.id);
            // The rule editor always needs at least one row to edit.
            return next.length > 0 ? next : [emptyFilterRule()];
          }),
      });
    });

    return chips;
  }, [searchText, selectedEnvironments, selectedTypes, selectedProviders, selectedTeams, selectedManagers, selectedStatuses, filterRules]);

  return {
    searchText,
    setSearchText,
    selectedProviders,
    setSelectedProviders,
    selectedTeams,
    setSelectedTeams,
    selectedStatuses,
    setSelectedStatuses,
    selectedManagers,
    setSelectedManagers,
    selectedEnvironments,
    setSelectedEnvironments,
    selectedTypes,
    setSelectedTypes,
    filterRules,
    setFilterRules,
    // Density is a display preference, not a filter - deliberately left out of
    // resetAllFilters so clearing filters doesn't also resize the rows.
    density,
    setDensity,
    addFilterRule,
    removeFilterRule,
    updateFilterRule,
    resetFilterRules,
    resetAllFilters,
    options,
    filteredRows,
    hasActiveFilters,
    activeFilterCount,
    activeFilterChips,
    matchesStatusSelection,
  };
}


// ======================================================
// Owns every derived figure the Dashboard and Metrics views render. Reads
// only from the same `rows` collection useCertificates already fetches - no
// new endpoints, no new state of its own - and recomputes via useMemo only
// when `rows` changes, same as summarizeCertificates/getCertsNeedingAttention
// do for the header and KPI strip.
// ======================================================
function useCertificateInsights(rows, activeView) {
  const onDashboard = activeView === 'dashboard';
  const onMetrics = activeView === 'metrics';

  const statusBreakdown = useMemo(() => (onDashboard ? computeStatusBreakdown(rows) : []), [rows, onDashboard]);
  const monthlyExpiry = useMemo(() => (onDashboard ? computeMonthlyExpiry(rows) : []), [rows, onDashboard]);
  const providerCounts = useMemo(() => (onDashboard ? countBy(rows, (r) => r.certProvider) : []), [rows, onDashboard]);
  const environmentRisk = useMemo(() => (onDashboard ? computeEnvironmentRisk(rows) : []), [rows, onDashboard]);
  const alertingMatrix = useMemo(() => (onDashboard ? computeAlertingMatrix(rows) : { full: 0, partial: 0, none: 0, total: 0 }), [rows, onDashboard]);
  const soonestToExpire = useMemo(() => (onDashboard ? computeSoonestToExpire(rows) : []), [rows, onDashboard]);

  const teamRisk = useMemo(() => (onMetrics ? computeTeamRisk(rows) : []), [rows, onMetrics]);
  const managerCounts = useMemo(() => (onMetrics ? countBy(rows, (r) => r.manager) : []), [rows, onMetrics]);
  const renewalCounts = useMemo(() => (onMetrics ? countBy(rows, (r) => r.renewalFrequency) : []), [rows, onMetrics]);
  const accountCounts = useMemo(() => (onMetrics ? countBy(rows, (r) => (r.accountId ? String(r.accountId) : null)) : []), [rows, onMetrics]);
  const missingMetadata = useMemo(() => (onMetrics ? computeMissingMetadata(rows) : []), [rows, onMetrics]);
  const escalationLoad = useMemo(() => (onMetrics ? computeEscalationLoad(rows) : []), [rows, onMetrics]);
  const accountRisk = useMemo(() => (onMetrics ? computeAccountRisk(rows) : []), [rows, onMetrics]);
  const staleCerts = useMemo(() => (onMetrics ? computeStaleCerts(rows) : []), [rows, onMetrics]);

  return {
    statusBreakdown,
    monthlyExpiry,
    providerCounts,
    environmentRisk,
    alertingMatrix,
    soonestToExpire,
    teamRisk,
    managerCounts,
    renewalCounts,
    accountCounts,
    missingMetadata,
    escalationLoad,
    accountRisk,
    staleCerts,
  };
}


// --- COMMON COMPONENTS ---
// Both search boxes in the app (the toolbar one over all certificates, and the
// one inside every filter dropdown) share this shell: bordered field, leading
// magnifier, and a clear button that appears once there is something to clear.
const SIZES = {
  medium: { height: 38, radius: '10px', px: 1.5, gap: 1, iconSize: 19, clearIconSize: 15 },
  small: { height: 34, radius: '8px', px: 1.25, gap: 0.75, iconSize: 17, clearIconSize: 14 },
};

function SearchField({
  value,
  onChange,
  onClear,
  placeholder,
  ariaLabel,
  clearAriaLabel = 'Clear search',
  clearTooltip,
  autoFocus = false,
  size = 'medium',
  width,
  onKeyDown,
  sx,
}) {
  const metrics = SIZES[size] || SIZES.medium;

  const clearButton = (
    <IconButton
      size="small"
      onClick={onClear}
      aria-label={clearAriaLabel}
      sx={{ p: 0.25, color: 'text.secondary' }}
    >
      <CloseIcon sx={{ fontSize: metrics.clearIconSize }} />
    </IconButton>
  );

  return (
    <Box
      onKeyDown={onKeyDown}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: metrics.gap,
        px: metrics.px,
        height: metrics.height,
        width,
        borderRadius: metrics.radius,
        bgcolor: SUBTLE_BG,
        border: '1px solid',
        borderColor: SUBTLE_BORDER,
        transition: 'border-color 0.15s, box-shadow 0.15s, background-color 0.15s',
        '&:hover': { borderColor: 'grey.400' },
        '&:focus-within': {
          bgcolor: SUBTLE_BG,
          borderColor: 'primary.main',
          boxShadow: FOCUS_RING,
          '& .MuiSvgIcon-root': { color: 'primary.main' },
        },
        ...sx
      }}
    >
      <SearchIcon sx={{ fontSize: metrics.iconSize, color: 'text.secondary' }} />
      <InputBase
        autoFocus={autoFocus}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        fullWidth
        sx={{ fontFamily: FONT_SANS, fontSize: TS.body, fontWeight: 400, lineHeight: 1.55, color: (t) => '#000000'}}
        inputProps={{ 'aria-label': ariaLabel }}
      />
      {Boolean(value) && (
        clearTooltip ? (
          <Tooltip title={clearTooltip} arrow>{clearButton}</Tooltip>
        ) : (
          clearButton
        )
      )}
    </Box>
  );
}



// A single unexpected value in a renderCell (a malformed escalation matrix, an
// object where a string was expected) would otherwise unmount the whole tree
// and leave a blank white page with nothing but a console stack trace.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled error in Cert Registry UI:', error, info?.componentStack);
    this.setState({ error, errorInfo: info });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 3,
          bgcolor: 'background.default'
        }}
      >
        <Box sx={{ ...SURFACE_SX, maxWidth: 640, width: '100%', textAlign: 'center', p: 4, borderRadius: '16px' }}>
          <ErrorOutlineIcon sx={{ fontSize: 44, color: 'error.main', mb: 1.5 }} />
          <Typography variant="h6" sx={{ mb: 1 }}>
            Something went wrong
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            The certificate registry hit an unexpected error and couldn&apos;t finish rendering.
          </Typography>
          {this.state.error && (
            <Box
              component="pre"
              sx={{
                textAlign: 'left',
                p: 2,
                borderRadius: '8px',
                bgcolor: (t) => 'grey.100',
                color: 'error.main',
                fontSize: TS.body,
                fontFamily: FONT_MONO,
                overflowX: 'auto',
                maxHeight: 220,
                mb: 3,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              {this.state.error.toString()}
              {this.state.errorInfo?.componentStack}
            </Box>
          )}
          <Button variant="contained" startIcon={<RefreshIcon />} onClick={() => window.location.reload()}>
            Reload page
          </Button>
        </Box>
      </Box>
    );
  }
}



// --- LAYOUT ---
// Long lists belong in the table, not in a dropdown; the panel shows the worst
// few and hands the rest over to the grid.
const MAX_VISIBLE_ALERTS = 6;

function AlertRow({ alert, onSelect, divider }) {
  const open = () => onSelect(alert.id);

  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        px: 2,
        py: 1.25,
        cursor: 'pointer',
        ...(divider ? { borderBottom: '1px solid', borderColor: 'divider' } : null),
        '&:hover': { bgcolor: SUBTLE_BG },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 }
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          noWrap
          sx={{ fontFamily: FONT_MONO, fontSize: TS.body, fontWeight: 600, color: 'text.primary' }}
        >
          {alert.domainName}
        </Typography>
        <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
          {alert.teamOwner ? `${alert.teamOwner} \u00B7 ` : ''}{formatDaysLeft(alert.daysLeft)}
        </Typography>
      </Box>
      <StatusPill colorKey={alert.status.color} label={alert.status.label} dense />
      <ArrowForwardIosIcon sx={{ fontSize: 11, color: 'text.disabled', flexShrink: 0 }} />
    </Box>
  );
}

// Bell in the header. The badge is the number of certificates that actually
// need action, and every row opens that certificate's detail drawer.
function NotificationsButton({ alerts, loading, onSelectCert, onShowAll }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const close = () => setAnchorEl(null);

  const count = alerts.length;
  const visible = alerts.slice(0, MAX_VISIBLE_ALERTS);

  let label = 'Notifications: nothing needs attention';
  if (count === 1) label = 'Notifications: 1 certificate needs attention';
  else if (count > 1) label = `Notifications: ${count} certificates need attention`;

  return (
    <>
      <Tooltip title={label} arrow>
        <IconButton
          size="small"
          aria-label={label}
          aria-haspopup="dialog"
          onClick={(e) => setAnchorEl(e.currentTarget)}
          sx={(t) => ({ color: t.palette.shell.text, width: TOPBAR_ACTION_SIZE, height: TOPBAR_ACTION_SIZE, '&:hover': { bgcolor: t.palette.shell.hover, color: t.palette.shell.textStrong } })}
        >
          <Badge
            color="error"
            badgeContent={loading ? 0 : count}
            max={99}
            sx={{ '& .MuiBadge-badge': { fontSize: TS.sm, fontWeight: 700, height: 16, minWidth: 16 } }}
          >
            <NotificationsNoneIcon sx={{ fontSize: 17 }} />
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          popper: ZOOM_AWARE_POPPER_PROPS,
          paper: {
            sx: { ...FLOATING_PANEL_SX, mt: 1, width: 392, maxWidth: 'calc(100vw - 32px)', overflow: 'hidden' }
          }
        }}
      >
        <Box
          sx={{
            px: 2,
            py: 1.5,
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 1,
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: SUBTLE_BG
          }}
        >
          <Typography variant="subtitle2" sx={{ color: 'text.primary' }}>Needs attention</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {loading ? 'Loading...' : `Expired or expiring within ${ATTENTION_WINDOW_DAYS} days`}
          </Typography>
        </Box>

        {count === 0 ? (
          <Box sx={{ px: 3, py: 3.5, textAlign: 'center' }}>
            <TaskAltIcon sx={{ fontSize: 30, color: loading ? 'text.disabled' : 'success.main', mb: 1 }} />
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
              {loading ? 'Checking the registry...' : 'Everything is in good shape'}
            </Typography>
            {!loading && (
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
                No certificates expire in the next {ATTENTION_WINDOW_DAYS} days.
              </Typography>
            )}
          </Box>
        ) : (
          <>
            <Box sx={{ maxHeight: 340, overflowY: 'auto' }}>
              {visible.map((alert, idx) => (
                <AlertRow
                  key={alert.id}
                  alert={alert}
                  divider={idx < visible.length - 1}
                  onSelect={(id) => {
                    close();
                    onSelectCert(id);
                  }}
                />
              ))}
            </Box>

            <Box sx={{ px: 1, py: 0.75, borderTop: '1px solid', borderColor: 'divider', bgcolor: SUBTLE_BG }}>
              <Button
                fullWidth
                size="small"
                onClick={() => {
                  close();
                  onShowAll();
                }}
                sx={{ fontWeight: 600 }}
              >
                {`View all ${count} in the table`}
              </Button>
            </Box>
          </>
        )}
      </Popover>
    </>
  );
}



// "Ada Lovelace" -> "AL". Falls back to a single letter for mononyms.
const initialsOf = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

// Anchors the right end of the header. `user` is optional: until sign-in is
// wired up there is no name to show, so the avatar carries a person glyph and
// the menu holds only actions that genuinely work.
function UserMenu({ user, onRefresh, onResetView, onSignOut }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const close = () => setAnchorEl(null);
  // Presentation default - real user hookup lives outside this UI layer.
  const displayUser = user || { name: 'A. Osei', role: 'Platform SRE', email: null };

  const run = (action) => () => {
    close();
    action();
  };

  const items = [
    { label: 'Refresh data', icon: <RefreshIcon sx={{ fontSize: 17 }} />, onClick: onRefresh },
    { label: 'Reset filters to default', icon: <RestartAltIcon sx={{ fontSize: 17 }} />, onClick: onResetView },
  ];

  return (
    <>
      <Tooltip title="Account and view actions" arrow>
        <Box
          role="button"
          tabIndex={0}
          aria-haspopup="menu"
          aria-label={`Account menu for ${displayUser.name}`}
          onClick={(e) => setAnchorEl(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setAnchorEl(e.currentTarget);
            }
          }}
          sx={(t) => ({
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            pl: 0.5,
            pr: 0.875,
            py: 0.25,
            borderRadius: '10px',
            cursor: 'pointer',
            border: '1px solid transparent',
            transition: 'background-color 0.15s, border-color 0.15s',
            '&:hover': { bgcolor: t.palette.shell.hover, borderColor: t.palette.shell.border },
            '&:focus-visible': { outline: `2px solid ${t.palette.primary.main}`, outlineOffset: 2 },
          })}
        >
          <Avatar
            sx={{
              width: TOPBAR_AVATAR_SIZE,
              height: TOPBAR_AVATAR_SIZE,
              fontSize: TS.sm,
              fontWeight: 700,
              background: CARE_WORDMARK_GRADIENT,
              color: '#FFFFFF',
              border: 'none',
            }}
          >
            {initialsOf(displayUser.name)}
          </Avatar>
          <Box sx={{ display: { xs: 'none', md: 'flex' }, flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.15 }}>
            <Typography sx={(t) => ({ fontSize: TS.body, fontWeight: 600, color: t.palette.shell.textStrong, lineHeight: 1.2 })}>
              {displayUser.name}
            </Typography>
            <Typography sx={(t) => ({ fontSize: TS.body, color: t.palette.shell.text, lineHeight: 1.2 })}>
              {displayUser.role || displayUser.email || 'Registry viewer'}
            </Typography>
          </Box>
          <ExpandMoreIcon sx={{ fontSize: 17, color: 'text.secondary', ml: 0.25 }} />
        </Box>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ popper: ZOOM_AWARE_POPPER_PROPS, paper: { sx: { ...FLOATING_PANEL_SX, mt: 1, p: 0.5, minWidth: 248 } } }}
      >
        <Box sx={{ px: 1.75, pt: 1, pb: 1.25, mb: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>{displayUser.name}</Typography>
          {displayUser.role && (
            <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>{displayUser.role}</Typography>
          )}
        </Box>

        {items.map((item) => (
          <MenuItem key={item.label} onClick={run(item.onClick)} sx={{ gap: 1.25, py: 0.875 }}>
            <Box sx={{ display: 'flex', color: 'text.secondary' }}>{item.icon}</Box>
            <Typography variant="body2">{item.label}</Typography>
          </MenuItem>
        ))}

        {onSignOut && (
          <>
            <Divider sx={{ my: 0.5 }} />
            <MenuItem onClick={run(onSignOut)} sx={{ gap: 1.25, py: 0.875, color: 'error.main' }}>
              <Box sx={{ display: 'flex' }}><LogoutIcon sx={{ fontSize: 17 }} /></Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>Sign out</Typography>
            </MenuItem>
          </>
        )}
      </Menu>
    </>
  );
}



// ======================================================
// APP SHELL - Top Navigation Only Layout
// ======================================================

const NAV_ITEMS = [
  { key: 'repository', label: 'Repository', icon: AssignmentIcon, breadcrumb: 'Repository', title: 'Certificate Repository', subtitle: 'Browse, filter, and manage every certificate under the registry.' },
  { key: 'dashboard',  label: 'Dashboard',  icon: DashboardIcon,  breadcrumb: 'Dashboard', title: 'Registry Dashboard',    subtitle: 'Health, expiry pressure, and coverage across your fleet.' },
  { key: 'metrics',    label: 'Metrics',    icon: AssessmentIcon, breadcrumb: 'Metrics',   title: 'Ownership & Metadata Metrics', subtitle: 'Drill into team, manager, and account-level risk.' },
];

// --- KEYBOARD SHORTCUTS HELP MODAL ---
function KeyboardShortcutsHelp({ open, onClose }) {
  const shortcuts = [
    { key: 'Cmd K / Ctrl K', label: 'Open Command Palette' },
    { key: '/', label: 'Focus quick search field' },
    { key: '1 / 2 / 3', label: 'Switch view (Repository / Dashboard / Metrics)' },
    { key: 'R', label: 'Refresh registry data' },
    { key: 'Esc', label: 'Close drawer or overlay' },
    { key: '?', label: 'Show this keyboard shortcuts menu' },
  ];

  return (
    <Dialog open={open} onClose={onClose} slotProps={{ paper: { sx: { borderRadius: '16px', p: 1, maxWidth: 440, width: '100%', bgcolor: 'background.paper' } } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Keyboard Shortcuts</Typography>
        <IconButton size="small" onClick={onClose} aria-label="Close shortcuts help"><CloseIcon fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {shortcuts.map((s) => (
            <Box key={s.key} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.875, borderBottom: '1px dashed', borderColor: 'divider' }}>
              <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500 }}>{s.label}</Typography>
              <Chip label={s.key} size="small" sx={{ fontFamily: FONT_MONO, fontWeight: 700, bgcolor: (t) => 'grey.100', color: 'text.primary', border: '1px solid', borderColor: 'divider' }} />
            </Box>
          ))}
        </Box>
      </DialogContent>
    </Dialog>
  );
}

// --- COMMAND PALETTE MODAL ---
function CommandPalette({ open, onClose, rows, onNavigate, onSelectCert, onRefresh, onResetView, onExportCsv, onOpenShortcutsHelp }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Unique per mounted instance, so ids on the listbox/options never collide
  // with anything else on the page (or a second palette instance in tests).
  const paletteId = useId();
  const listboxId = `${paletteId}-listbox`;
  const optionId = (item) => `${paletteId}-option-${item.id}`;

  // Filtering `rows` (potentially thousands) on every keystroke is the same
  // cost as the main toolbar search; debounce it the same way. Nav/action
  // items are tiny fixed arrays, so they stay on the live `query` for
  // instant feedback - only the row scan lags.
  const debouncedQuery = useDebouncedValue(query, 200);

  const navItems = useMemo(() => [
    { type: 'nav', id: 'nav-repo', label: 'Go to Repository', category: 'Navigation', icon: <AssignmentIcon sx={{ fontSize: 18 }} />, action: () => onNavigate('repository') },
    { type: 'nav', id: 'nav-dash', label: 'Go to Dashboard', category: 'Navigation', icon: <DashboardIcon sx={{ fontSize: 18 }} />, action: () => onNavigate('dashboard') },
    { type: 'nav', id: 'nav-metr', label: 'Go to Metrics', category: 'Navigation', icon: <AssessmentIcon sx={{ fontSize: 18 }} />, action: () => onNavigate('metrics') },
  ], [onNavigate]);

  const actionItems = useMemo(() => [
    { type: 'action', id: 'act-refresh', label: 'Refresh Registry Data', category: 'Actions', icon: <RefreshIcon sx={{ fontSize: 18 }} />, action: onRefresh },
    { type: 'action', id: 'act-reset', label: 'Reset All Filters', category: 'Actions', icon: <RestartAltIcon sx={{ fontSize: 18 }} />, action: onResetView },
    { type: 'action', id: 'act-export', label: 'Export Filtered Data as CSV', category: 'Actions', icon: <FileDownloadOutlinedIcon sx={{ fontSize: 18 }} />, action: onExportCsv },
    { type: 'action', id: 'act-help', label: 'View Keyboard Shortcuts', category: 'Actions', icon: <TagIcon sx={{ fontSize: 18 }} />, action: onOpenShortcutsHelp },
  ], [onRefresh, onResetView, onExportCsv, onOpenShortcutsHelp]);

  const certItems = useMemo(() => {
    if (!debouncedQuery.trim()) return [];
    const q = debouncedQuery.toLowerCase();
    return rows
      .filter((r) =>
        (r.domainName || '').toLowerCase().includes(q) ||
        (r.app || '').toLowerCase().includes(q) ||
        (r.teamOwner || '').toLowerCase().includes(q) ||
        (r.manager || '').toLowerCase().includes(q)
      )
      .slice(0, 8)
      .map((r) => ({
        type: 'cert',
        id: `cert-${r.id}`,
        label: r.domainName,
        sublabel: `${r.teamOwner || 'No team'} \u00B7 ${r.app || 'No app'}`,
        category: 'Certificates',
        icon: <ShieldOutlinedIcon sx={{ fontSize: 18 }} />,
        action: () => onSelectCert(r.id),
      }));
  }, [rows, debouncedQuery, onSelectCert]);

  const allFiltered = useMemo(() => {
    if (!query.trim()) return [...navItems, ...actionItems];
    const q = query.toLowerCase();
    const filteredNav = navItems.filter((i) => i.label.toLowerCase().includes(q));
    const filteredAct = actionItems.filter((i) => i.label.toLowerCase().includes(q));
    return [...filteredNav, ...filteredAct, ...certItems];
  }, [query, navItems, actionItems, certItems]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const executeItem = (item) => {
    onClose();
    if (item && item.action) item.action();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, allFiltered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + allFiltered.length) % Math.max(1, allFiltered.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (allFiltered[selectedIndex]) {
        executeItem(allFiltered[selectedIndex]);
      }
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', pt: { xs: 4, md: 10 } }}
    >
      <Slide in={open} direction="down">
        <Paper
          elevation={12}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          sx={{
            width: 600,
            maxWidth: 'calc(100vw - 32px)',
            borderRadius: '16px',
            overflow: 'hidden',
            border: '1px solid',
            borderColor: 'divider',
            outline: 'none',
            bgcolor: 'background.paper',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
            <SearchIcon sx={{ color: 'text.secondary', mr: 1.5, fontSize: 22 }} />
            <InputBase
              autoFocus
              fullWidth
              role="combobox"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={allFiltered[selectedIndex] ? optionId(allFiltered[selectedIndex]) : undefined}
              aria-label="Search commands and certificates"
              placeholder="Type a command or search certificates..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              sx={{ fontSize: TS.lg, fontWeight: 500 }}
            />
            <Chip label="ESC" size="small" onClick={onClose} sx={{ height: 20, fontSize: TS.xs, fontFamily: FONT_MONO, cursor: 'pointer' }} />
          </Box>

          <Box role="listbox" id={listboxId} aria-label="Command palette results" sx={{ maxHeight: 380, overflowY: 'auto', p: 1 }}>
            {allFiltered.length === 0 ? (
              <Box sx={{ py: 4, textAlign: 'center' }}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>No matching commands or certificates</Typography>
              </Box>
            ) : (
              allFiltered.map((item, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <Box
                    key={item.id}
                    id={optionId(item)}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => executeItem(item)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      px: 2,
                      py: 1.25,
                      borderRadius: '10px',
                      cursor: 'pointer',
                      bgcolor: isSelected ? (t) => alpha(t.palette.primary.main, 0.08) : 'transparent',
                      transition: 'background-color 0.12s ease',
                    }}
                  >
                    <Box sx={{ color: isSelected ? 'primary.main' : 'text.secondary', display: 'flex' }}>{item.icon}</Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: isSelected ? 700 : 500, color: 'text.primary' }}>
                        {item.label}
                      </Typography>
                      {item.sublabel && (
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                          {item.sublabel}
                        </Typography>
                      )}
                    </Box>
                    <Chip label={item.category} size="small" sx={{ height: 18, fontSize: TS.xs, bgcolor: (t) => 'grey.100', color: 'text.secondary' }} />
                  </Box>
                );
              })
            )}
          </Box>
          <Box sx={{ px: 2, py: 1, bgcolor: (t) => 'grey.50', borderTop: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>Use up/down to navigate, Enter to select</Typography>
            <Typography variant="caption" sx={{ fontFamily: FONT_MONO, fontWeight: 700, ...CARE_GRADIENT_TEXT_SX }}>CARE Command Center</Typography>
          </Box>
        </Paper>
      </Slide>
    </Modal>
  );
}

const TOPBAR_HEIGHT = 57;
const TOPBAR_SHIELD = { w: 31, h: 34 };
const TOPBAR_NAV_ICON = 15;
const TOPBAR_ACTION_SIZE = 31;
const TOPBAR_AVATAR_SIZE = 25;
const TOPBAR_NAV_FONT = TS.lg;
const TOPBAR_TAGLINE_FONT = '0.7125rem'; // eyebrow under wordmark — one step below prior size

// Top bar shares the soft navy tint with KPI tabs and grid headers.
const TOPBAR_SURFACE = { bg: TABLE_HEADER_BG, border: TABLE_HEADER_BORDER };

// One accent (navy) carries the brand in the chrome; teal is reserved for the
// shield mark alone, so the bar never competes with page content for attention.
const NAV_BRAND = {
  navy: '#0B3D6E',
  navyMuted: '#475569',
  inactive: '#64748B',
  activeIcon: '#0B3D6E',
  inactiveIcon: '#94A3B8',
};

// Full-height underline tabs grouped as one control — short centred pipes between
// items, matching the grid column header separators.
function TopNavTabs({ activeView, onNavigate }) {
  const idleText = NAV_BRAND.inactive;

  return (
    <Box
      component="nav"
      aria-label="Primary"
      sx={{
        display: 'inline-flex',
        alignItems: 'stretch',
        height: '100%',
        gap: 0,
      }}
    >
      {NAV_ITEMS.map((item) => {
        const active = activeView === item.key;
        const Icon = item.icon;
        return (
          <Button
            key={item.key}
            onClick={() => onNavigate(item.key)}
            aria-current={active ? 'page' : undefined}
            disableRipple
            startIcon={
              <Icon
                sx={{
                  fontSize: TOPBAR_NAV_ICON,
                  color: active ? BRAND_TEAL_LIGHT : NAV_BRAND.inactiveIcon,
                  transition: 'color 0.16s ease',
                }}
              />
            }
            sx={{
              position: 'relative',
              height: '100%',
              minWidth: 0,
              px: 2.25,
              borderRadius: 0,
              textTransform: 'none',
              fontFamily: FONT_SANS,
              fontSize: TOPBAR_NAV_FONT,
              fontWeight: active ? 700 : 500,
              letterSpacing: '0.01em',
              ...(active ? CARE_GRADIENT_TEXT_SX : { color: idleText }),
              bgcolor: active ? alpha(NAV_BRAND.navy, 0.08) : 'transparent',
              whiteSpace: 'nowrap',
              transition: 'color 0.16s ease, background-color 0.16s ease',
              '& .MuiButton-startIcon': { mr: 0.875, ml: 0 },
              // Short centred pipe between tabs — same pattern as the grid headers.
              '&:not(:last-of-type)::before': {
                content: '""',
                position: 'absolute',
                right: 0,
                top: '50%',
                transform: 'translateY(-50%)',
                width: '1px',
                height: 15,
                backgroundColor: TABLE_HEADER_BORDER,
                pointerEvents: 'none',
              },
              '&::after': {
                content: '""',
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: 2.5,
                borderRadius: '2px 2px 0 0',
                background: CARE_WORDMARK_GRADIENT,
                opacity: active ? 1 : 0,
                transition: 'opacity 0.16s ease',
              },
              '&:hover': {
                bgcolor: alpha(NAV_BRAND.navy, 0.04),
                color: active ? undefined : NAV_BRAND.navyMuted,
              },
              '&:active': { transform: 'none' },
            }}
          >
            {item.label}
          </Button>
        );
      })}
    </Box>
  );
}
function CarePortalShieldLogo() {
  return (
    <Box
      sx={{
        width: TOPBAR_SHIELD.w,
        height: TOPBAR_SHIELD.h,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      aria-hidden
    >
      <svg viewBox="0 0 64 72" width={TOPBAR_SHIELD.w} height={TOPBAR_SHIELD.h} fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="careShieldFill" x1="32" y1="4" x2="32" y2="68" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#1A6BB5" />
            <stop offset="45%" stopColor="#0B3D6E" />
            <stop offset="100%" stopColor="#062847" />
          </linearGradient>
          <linearGradient id="careShieldRim" x1="10" y1="8" x2="54" y2="64" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#5EB8E8" />
            <stop offset="100%" stopColor={BRAND_TEAL} />
          </linearGradient>
        </defs>
        <path
          d="M32 4L56 14.5V36.5C56 52.5 45.5 63.5 32 68C18.5 63.5 8 52.5 8 36.5V14.5L32 4Z"
          fill="url(#careShieldFill)"
          stroke="url(#careShieldRim)"
          strokeWidth="2.5"
        />
        {/* Interior is deliberately coarse: the mark renders at 30px, so the
            document gets two thick rules and one seal instead of fine detail
            that would smear into grey at this scale. */}
        <rect x="21" y="21" width="22" height="27" rx="2.5" fill="#FFFFFF" fillOpacity="0.96" />
        <line x1="26" y1="28" x2="38" y2="28" stroke="#0B3D6E" strokeWidth="2.6" strokeLinecap="round" />
        <line x1="26" y1="35" x2="34" y2="35" stroke="#0B3D6E" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="38" cy="43" r="7" fill={BRAND_TEAL} stroke="#FFFFFF" strokeWidth="2" />
        <path d="M34.8 43.2L37 45.6L41.3 40.8" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Box>
  );
}

// Left branding block. Two tiers only: the wordmark, and the expansion as a
// small uppercase eyebrow beneath it. The full name drops its trailing
// "- Portal" because the wordmark directly above already says it.
function CarePortalBrandBlock({ sx: sxProp = {} }) {
  const brandNavy = NAV_BRAND.navy;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        minWidth: 0,
        flexShrink: 0,
        ...sxProp,
      }}
    >
      <CarePortalShieldLogo />
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.625, lineHeight: 1.15 }}>
          {/* The one place FONT_BRAND is allowed. */}
          <Typography
            component="span"
            sx={{
              fontFamily: FONT_BRAND,
              fontSize: TOPBAR_NAV_FONT,
              fontWeight: 800,
              letterSpacing: '0.045em',
              ...CARE_GRADIENT_TEXT_SX,
            }}
          >
            CARE
          </Typography>
          <Typography
            component="span"
            sx={{
              fontFamily: FONT_BRAND,
              fontSize: TOPBAR_NAV_FONT,
              fontWeight: 700,
              color: brandNavy,
              letterSpacing: '0.01em',
            }}
          >
            Portal
          </Typography>
        </Box>
        <Typography
          component="div"
          sx={{
            display: { xs: 'none', lg: 'block' },
            fontFamily: FONT_SANS,
            fontSize: TOPBAR_TAGLINE_FONT,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: brandNavy,
            lineHeight: 1.25,
            mt: 0.5,
            whiteSpace: 'nowrap',
          }}
        >
          Certificate Automation &amp; Registry Ecosystem - Portal
        </Typography>
      </Box>
    </Box>
  );
}

function TopBar({
  activeView,
  onNavigate,
  alerts,
  alertsLoading,
  onSelectCert,
  onShowAllAlerts,
  onRefresh,
  onResetView,
  onOpenCommandPalette,
  onOpenShortcutsHelp,
  user,
}) {
  return (
    <Box
      component="header"
      sx={(t) => ({
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: TOPBAR_HEIGHT,
        bgcolor: TOPBAR_SURFACE.bg,
        color: t.palette.text.primary,
        borderBottom: '1px solid',
        borderColor: TOPBAR_SURFACE.border,
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0, 1fr) auto', md: 'minmax(0, 1fr) auto minmax(0, 1fr)' },
        alignItems: 'stretch',
        columnGap: 2,
        pl: { xs: 2, md: 3 },
        pr: { xs: 1.5, md: 2 },
        zIndex: 15,
      })}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, justifySelf: 'start' }}>
        <CarePortalBrandBlock />
      </Box>

      {/* Equal 1fr side columns center the nav against the viewport rather than
          against the leftover space, so it stays put as the brand or the
          actions cluster changes width. */}
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          alignItems: 'stretch',
          justifySelf: 'center',
          minWidth: 0,
          gridColumn: { md: 2 },
          gridRow: 1,
        }}
      >
        <TopNavTabs activeView={activeView} onNavigate={onNavigate} />
      </Box>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.25,
          flexShrink: 0,
          justifySelf: 'end',
          gridColumn: { xs: 2, md: 3 },
          gridRow: 1,
        }}
      >
        <NotificationsButton
          alerts={alerts}
          loading={alertsLoading}
          onSelectCert={onSelectCert}
          onShowAll={onShowAllAlerts}
        />

        <Box
          aria-hidden
          sx={{ width: '1px', height: 19, mx: 0.75, bgcolor: TABLE_HEADER_BORDER, flexShrink: 0 }}
        />

        <UserMenu user={user} onRefresh={onRefresh} onResetView={onResetView} />
      </Box>
    </Box>
  );
}

function LastSyncedCard({ lastUpdated, loading, onRefresh }) {
  return (
    <Box
      sx={(t) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        py: 1.25,
        borderRadius: '12px',
        border: '1px solid',
        borderColor: t.palette.divider,
        bgcolor: t.palette.background.paper,
        boxShadow: t.shadows[1],
        flexShrink: 0,
      })}
    >
      <Box
        aria-hidden
        sx={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          bgcolor: loading ? 'warning.main' : 'success.main',
          flexShrink: 0,
          boxShadow: loading ? 'none' : '0 0 0 3px rgba(5,150,105,0.18)',
        }}
      />
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: TS.sm, color: 'text.disabled', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600, lineHeight: 1.2 }}>
          Last synced
        </Typography>
        <Typography sx={{ fontSize: TS.body, color: 'text.primary', fontWeight: 600, fontFamily: FONT_MONO, lineHeight: 1.3 }}>
          {lastUpdated.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </Typography>
      </Box>
      <Tooltip title={loading ? 'Refreshing...' : 'Refresh data'} arrow>
        <span style={{ display: 'inline-flex' }}>
          <IconButton
            size="small"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh data"
            sx={(t) => ({
              border: '1px solid',
              borderColor: t.palette.divider,
              borderRadius: '8px',
              color: 'text.secondary',
              '&:hover': { bgcolor: alpha(PRIMARY_MAIN, 0.06), borderColor: 'primary.main', color: 'primary.main' },
            })}
          >
            {loading ? <CircularProgress size={14} thickness={5} /> : <RefreshIcon sx={{ fontSize: 16 }} />}
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
}

function Shell({
  activeView,
  onNavigate,
  alerts,
  alertsLoading,
  onSelectCert,
  onShowAllAlerts,
  onRefresh,
  onResetView,
  onOpenCommandPalette,
  onOpenShortcutsHelp,
  user,
  headerAside = null,
  children,
}) {
  const activeItem = NAV_ITEMS.find((i) => i.key === activeView) || NAV_ITEMS[0];

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <TopBar
        activeView={activeView}
        onNavigate={onNavigate}
        alerts={alerts}
        alertsLoading={alertsLoading}
        onSelectCert={onSelectCert}
        onShowAllAlerts={onShowAllAlerts}
        onRefresh={onRefresh}
        onResetView={onResetView}
        onOpenCommandPalette={onOpenCommandPalette}
        onOpenShortcutsHelp={onOpenShortcutsHelp}
        user={user}
      />
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          ml: 0,
          mt: `${TOPBAR_HEIGHT}px`,
          minWidth: 0,
        }}
      >
        <Box sx={{ px: PAGE_PX, pt: 2.5, pb: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <Box>
            {/* Breadcrumb, not a second banner: the trailing segment carries
                the weight and the parent stays muted. */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Typography sx={{ fontFamily: FONT_SANS, fontSize: { xs: '1.125rem', md: '1.3125rem' }, fontWeight: 400, color: 'text.secondary', lineHeight: 1.2 }}>
                Certificate
              </Typography>
              <Typography sx={{ fontFamily: FONT_SANS, fontSize: { xs: '1.125rem', md: '1.3125rem' }, fontWeight: 400, color: 'text.disabled', lineHeight: 1.2 }}>
                /
              </Typography>
              <Typography component="h1" sx={{ fontFamily: FONT_SANS, fontSize: { xs: '1.25rem', md: '1.375rem' }, fontWeight: 700, color: PRIMARY_MAIN, lineHeight: 1.2, letterSpacing: '-0.015em' }}>
                {activeItem.breadcrumb}
              </Typography>
            </Box>
            <Typography sx={{ color: 'text.secondary', fontSize: TS.body, mt: 0.5 }}>
              {activeItem.subtitle}
            </Typography>
          </Box>

          {headerAside}
        </Box>
        {children}
      </Box>
    </Box>
  );
}


// ======================================================

// KPI strip above the table. The counts are always whole-registry figures, so
// they stay meaningful while the table itself is filtered; clicking a card
// applies the matching status filter.
function StatsBar({ summary, loading, selectedStatuses, onSelectStatuses, matchesStatusSelection }) {
  const tints = useTints();
  // Status tab counts derived from the same summary the KPI cards used.
  const total = summary.total;
  const counts = {
    Good: summary.good,
    Warning: summary.warning,
    Critical: summary.critical,
    Expired: summary.expired,
  };

  const TAB_DEFS = [
    { key: 'all',      label: 'All',      count: total,           statuses: [],           icon: null },
    { key: 'good',     label: 'Good',     count: counts.Good,     statuses: ['Good'],     icon: <TaskAltIcon sx={{ fontSize: 16, color: tints.status.success.dot }} /> },
    { key: 'warning',  label: 'Warning',  count: counts.Warning,  statuses: ['Warning'],  icon: <WarningAmberIcon sx={{ fontSize: 16, color: tints.status.warning.dot }} /> },
    { key: 'critical', label: 'Critical', count: counts.Critical, statuses: ['Critical'], icon: <ErrorOutlineIcon sx={{ fontSize: 16, color: tints.status.error.dot }} /> },
    { key: 'expired',  label: 'Expired',  count: counts.Expired,  statuses: ['Expired'],  icon: <HourglassBottomOutlinedIcon sx={{ fontSize: 16, color: tints.expired.dot }} /> },
  ];

  const isActiveTab = (tab) => {
    if (tab.statuses.length === 0) return selectedStatuses.length === 0;
    return matchesStatusSelection(tab.statuses);
  };

  return (
    <Box sx={{ mx: PAGE_PX, mt: 2 }}>
      {/* Status filter tabs */}
      <Box sx={(t) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        p: 0.5,
        borderRadius: '12px',
        border: '1px solid',
        borderColor: t.palette.divider,
        bgcolor: t.palette.background.paper,
        boxShadow: t.shadows[1],
        flexWrap: 'wrap',
      })}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexWrap: 'wrap' }}>
          {TAB_DEFS.map((tab) => {
            const active = isActiveTab(tab);
            return (
              <Button
                key={tab.key}
                disableRipple
                onClick={() => onSelectStatuses(active ? [] : tab.statuses)}
                aria-pressed={active}
                sx={(t) => ({
                  minWidth: 0,
                  px: 1.5,
                  py: 0.875,
                  gap: 0.75,
                  borderRadius: '999px',
                  fontFamily: FONT_SANS,
                  color: active ? PRIMARY_MAIN : 'text.secondary',
                  bgcolor: active ? '#E8F0F9' : 'transparent',
                  border: active ? '1px solid' : '1px solid transparent',
                  borderColor: active ? '#C7DBEE' : 'transparent',
                  fontSize: TS.body,
                  fontWeight: active ? 700 : 500,
                  letterSpacing: 0,
                  boxShadow: active ? t.shadows[1] : 'none',
                  '&:hover': {
                    color: active ? PRIMARY_MAIN : 'text.primary',
                    bgcolor: active ? alpha(PRIMARY_MAIN, 0.12) : alpha(PRIMARY_MAIN, 0.05),
                  },
                })}
              >
                {tab.icon && (
                  <Box component="span" sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    {tab.icon}
                  </Box>
                )}
                <Box component="span">{tab.label}</Box>
                <Box component="span" sx={{
                  fontFamily: FONT_MONO,
                  fontSize: TS.md,
                  color: active ? PRIMARY_MAIN : 'text.secondary',
                  fontWeight: 600,
                  ml: 0.25,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {loading ? '-' : tab.count.toLocaleString()}
                </Box>
              </Button>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}

// --- DOMAIN CELL WITH 1-CLICK COPY ---
function DomainCell({ value, onCopy }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e) => {
    e.stopPropagation();
    if (!value) return;
    // navigator.clipboard.writeText returns a Promise - it must be awaited
    // (or .then/.catch'd) to know whether the copy actually succeeded.
    // Previously this fired-and-forgot the promise, so a rejected write
    // (denied permission, insecure context, no Clipboard API at all) still
    // showed "Copied!" to the user. Success and failure are now reported
    // through the same onCopy callback so the caller can show an honest
    // message either way rather than always assuming success.
    if (!navigator.clipboard?.writeText) {
      onCopy?.(value, { success: false });
      return;
    }
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true);
        onCopy?.(value, { success: true });
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
        onCopy?.(value, { success: false });
      }
    );
  };

  return (
    <Box sx={{ ...CELL_FLEX_SX, minWidth: 0, gap: 1, position: 'relative', width: '100%', alignItems: 'center' }}>
      <Tooltip title={value || ''} placement="top-start" arrow>
        <Typography
          noWrap
          sx={{ fontFamily: FONT_SANS, fontSize: TS.body, fontWeight: 600, letterSpacing: 0, color: (t) => '#111827', flex: 1, minWidth: 0 }}
        >
          {value}
        </Typography>
      </Tooltip>
      <Tooltip title={copied ? 'Copied!' : 'Copy domain'} arrow placement="top">
        <IconButton
          size="small"
          onClick={handleCopy}
          sx={{
            p: 0.25,
            opacity: copied ? 1 : 0,
            transition: 'opacity 0.15s ease, transform 0.15s ease',
            '.MuiDataGrid-row:hover &': { opacity: 1 },
            color: copied ? 'success.main' : 'text.secondary',
            '&:hover': { bgcolor: (t) => alpha(t.palette.primary.main, 0.08) },
          }}
        >
          {copied ? <CheckIcon sx={{ fontSize: 14 }} /> : <ContentCopyIcon sx={{ fontSize: 13 }} />}
        </IconButton>
      </Tooltip>
    </Box>
  );
}



// --- FILTERS ---
// Keys the dropdown itself should keep handling while focus sits in the search
// field. Everything else is swallowed so the menu's built-in type-ahead doesn't
// grab the characters being typed and jump the focus onto an option.
const MENU_NAVIGATION_KEYS = ['Escape', 'Tab', 'ArrowDown', 'ArrowUp', 'Enter'];

// Select clones option props (role, selected, aria-selected, and click/keydown
// handlers) onto every child it renders, including this one. role/selected are
// dropped so the search row isn't announced as a selectable option; the cloned
// handlers are forwarded, because Select invokes the row's own onKeyDown
// through them.
const FilterSearchRow = React.forwardRef(function FilterSearchRow(props, ref) {
  const { role, selected, 'aria-selected': ariaSelected, ...boxProps } = props;
  return <Box ref={ref} {...boxProps} />;
});

// Multi-select filter dropdown with a type-to-narrow search box pinned to the
// top of the option list. Accepts either plain strings or {value,label} pairs
// and reports selections through onValueChange, so callers keep passing their
// existing state setters and the filtering logic stays untouched.
function FilterMultiSelect({ label, options, value, onValueChange, minWidth = 150, emptyText }) {
  const [query, setQuery] = useState('');

  const normalizedOptions = useMemo(
    () => options.map((option) => (typeof option === 'string' ? { value: option, label: option } : option)),
    [options]
  );

  const visibleOptions = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (trimmed.length === 0) return normalizedOptions;
    return normalizedOptions.filter((option) => option.label.toLowerCase().includes(trimmed));
  }, [normalizedOptions, query]);

  const noOptionsText = emptyText || `No ${label.toLowerCase()} values found`;
  const isSearching = query.trim().length > 0;
  const allVisibleSelected =
    visibleOptions.length > 0 && visibleOptions.every((option) => value.includes(option.value));

  const selectAllVisible = () =>
    onValueChange(Array.from(new Set([...value, ...visibleOptions.map((option) => option.value)])));

  return (
    <Select
      multiple
      size="small"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      displayEmpty
      // Reset the query on close so reopening always shows the full list.
      onClose={() => setQuery('')}
      renderValue={(selected) => (selected.length === 0 ? `${label}: All` : `${label} (${selected.length})`)}
      MenuProps={{
        disableScrollLock: true,
        anchorOrigin: { vertical: 'bottom', horizontal: 'left' },
        transformOrigin: { vertical: 'top', horizontal: 'left' },
        // Let the search field own the focus instead of the option list.
        autoFocus: false,
        slotProps: {
          popper: ZOOM_AWARE_POPPER_PROPS,
          paper: {
            sx: {
              mt: 0.75,
              maxHeight: 420,
              minWidth: 264,
              borderRadius: '12px',
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: (t) => t.shadows[8]
            }
          },
          list: { sx: { pt: 0 } }
        }
      }}
      sx={{ minWidth, height: 38, fontFamily: FONT_SANS, fontSize: TS.body, fontWeight: 400, lineHeight: 1.55, color: (t) => '#000000', bgcolor: 'background.paper' }}
    >
      <FilterSearchRow
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          px: 1,
          pt: 1,
          pb: 1,
          bgcolor: 'background.paper',
          borderBottom: '1px solid',
          borderColor: 'divider'
        }}
      >
        <SearchField
          size="small"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery('')}
          placeholder={`Search ${label.toLowerCase()}...`}
          ariaLabel={`Search ${label} options`}
          clearAriaLabel="Clear option search"
          onKeyDown={(e) => {
            if (!MENU_NAVIGATION_KEYS.includes(e.key)) e.stopPropagation();
          }}
        />

        {/* Makes the size of the list explicit, so it's obvious when the list
            is scrolled part-way and when a search is hiding values. */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mt: 0.75, pl: 0.5 }}>
          <Typography variant="body2" sx={{ fontFamily: FONT_SANS, fontSize: TS.body, color: (t) => 'rgb(75, 85, 99)', whiteSpace: 'nowrap' }}>
            {isSearching
              ? `${visibleOptions.length} of ${normalizedOptions.length}`
              : `${normalizedOptions.length} ${normalizedOptions.length === 1 ? 'value' : 'values'}`}
            {value.length > 0 ? ` \u00B7 ${value.length} selected` : ''}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
            {!allVisibleSelected && visibleOptions.length > 1 && (
              <Button
                size="small"
                onClick={selectAllVisible}
                sx={{ minWidth: 0, px: 0.75, py: 0, fontFamily: FONT_SANS, fontSize: TS.body, fontWeight: 600, color: 'primary.main' }}
              >
                {isSearching ? 'Select these' : 'Select all'}
              </Button>
            )}
            {value.length > 0 && (
              <Button
                size="small"
                onClick={() => onValueChange([])}
                sx={{ minWidth: 0, px: 0.75, py: 0, fontFamily: FONT_SANS, fontSize: TS.body, fontWeight: 400, color: (t) => 'rgb(75, 85, 99)'}}
              >
                Clear
              </Button>
            )}
          </Box>
        </Box>
      </FilterSearchRow>

      {normalizedOptions.length === 0 ? (
        <MenuItem disabled dense>
          <Typography variant="body2" sx={{ fontFamily: FONT_SANS, fontSize: TS.body, color: (t) => 'rgb(75, 85, 99)'}}>{noOptionsText}</Typography>
        </MenuItem>
      ) : visibleOptions.length === 0 ? (
        <MenuItem disabled dense>
          <Typography variant="body2" sx={{ fontFamily: FONT_SANS, fontSize: TS.body, color: (t) => 'rgb(75, 85, 99)'}}>No matches for "{query.trim()}"</Typography>
        </MenuItem>
      ) : (
        visibleOptions.map((option) => (
          <MenuItem key={option.value} value={option.value} dense sx={{ py: 0.375 }}>
            <Checkbox size="small" checked={value.includes(option.value)} sx={{ mr: 0.5, p: 0.5 }} />
            <Typography variant="body2" sx={{ fontFamily: FONT_SANS, fontSize: TS.body, fontWeight: 400, lineHeight: 1.55, color: (t) => 'rgb(75, 85, 99)'}}>{option.label}</Typography>
          </MenuItem>
        ))
      )}
    </Select>
  );
}



// The rule row is three underlined fields; they share this treatment so the
// column picker, the operator picker and the value input stay in step.
const RULE_FIELD_SX = {
  fontFamily: FONT_SANS,
  fontSize: TS.body,
  fontWeight: 500,
  borderBottom: '1px solid',
  borderColor: 'divider',
  pb: 0.5,
  '&:hover': { borderColor: 'text.secondary' },
  '&.Mui-focused': { borderColor: 'primary.main', borderBottomWidth: '2px' }
};

function RuleSelect({ width, value, options, onChange }) {
  return (
    <Select
      variant="standard"
      size="small"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disableUnderline
      sx={{ ...RULE_FIELD_SX, width }}
    >
      {options.map((option) => (
        <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
      ))}
    </Select>
  );
}

const COLUMN_HEADINGS = [
  { label: 'Column', width: 170 },
  { label: 'Operator', width: 140 },
  { label: 'Value', flexGrow: 1 },
];

// Advanced per-column rules, ANDed together. Rendered as a popover anchored to
// the Filters button in the control bar.
function FilterRulesPopover({ anchorEl, onClose, rules, onAddRule, onRemoveRule, onUpdateRule, onResetRules }) {
  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{
        popper: ZOOM_AWARE_POPPER_PROPS,
        paper: {
          sx: {
            p: 0,
            width: 660,
            maxWidth: 'calc(100vw - 32px)',
            mt: 1,
            boxShadow: (t) => t.shadows[8],
            borderRadius: '14px',
            border: '1px solid',
            borderColor: 'divider',
            overflow: 'hidden'
          }
        }
      }}
    >
      <div style={{ paddingTop: 20, paddingBottom: 16, paddingLeft: 28, paddingRight: 24 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <FilterListIcon sx={{ fontSize: 17, color: BRAND_TEAL_LIGHT }} />
          <Typography variant="subtitle2" sx={{ fontFamily: FONT_SANS, fontWeight: 700, color: 'text.primary' }}>Filter certificates</Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5, mb: 1, pr: '40px' }}>
          {COLUMN_HEADINGS.map((heading) => (
            <Typography
              key={heading.label}
              variant="caption"
              sx={{
                fontFamily: FONT_SANS,
                fontSize: TS.body,
                fontWeight: 700,
                color: 'text.secondary',
                width: heading.width,
                flexGrow: heading.flexGrow,
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}
            >
              {heading.label}
            </Typography>
          ))}
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          {rules.map((rule, index) => {
            const needsNoValue = VALUELESS_OPERATORS.includes(rule.operator);
            return (
              <React.Fragment key={rule.id}>
                {index > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', py: 0.5 }}>
                    <Chip
                      label="AND"
                      size="small"
                      sx={{ height: 18, fontFamily: FONT_SANS, fontSize: TS.sm, fontWeight: 700, bgcolor: SUBTLE_BG_STRONG, color: 'text.secondary' }}
                    />
                  </Box>
                )}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5, pr: 1.5, py: 1 }}>
                  <RuleSelect
                    width={170}
                    value={rule.column}
                    options={FILTERABLE_COLUMNS}
                    onChange={(value) => onUpdateRule(rule.id, 'column', value)}
                  />

                  <RuleSelect
                    width={160}
                    value={rule.operator}
                    options={FILTER_OPERATORS}
                    onChange={(value) => onUpdateRule(rule.id, 'operator', value)}
                  />

                  <InputBase
                    placeholder={needsNoValue ? 'No value needed' : 'Filter value'}
                    disabled={needsNoValue}
                    value={rule.value}
                    onChange={(e) => onUpdateRule(rule.id, 'value', e.target.value)}
                    sx={{
                      ...RULE_FIELD_SX,
                      flexGrow: 1,
                      transition: 'border-color 0.15s, border-width 0.15s',
                      '&:hover:not(.Mui-focused)': { borderColor: 'text.secondary' },
                      '&.Mui-disabled': { borderColor: 'divider' },
                      '& .MuiInputBase-input.Mui-disabled': {
                        color: 'text.secondary',
                        WebkitTextFillColor: 'unset',
                        fontStyle: 'italic'
                      }
                    }}
                  />

                  <IconButton
                    size="small"
                    onClick={() => onRemoveRule(rule.id)}
                    disabled={rules.length === 1}
                    aria-label="Remove filter rule"
                    sx={{ p: 0.5, color: 'text.secondary', '&:hover': { color: 'text.primary', bgcolor: 'transparent' } }}
                  >
                    <CloseIcon fontSize="small" sx={{ fontSize: TS.xl }} />
                  </IconButton>
                </Box>
              </React.Fragment>
            );
          })}
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2.5, pr: 1.5 }}>
          <Button
            size="small"
            startIcon={<AddIcon sx={{ fontSize: TS.xl }} />}
            onClick={onAddRule}
            sx={{ fontFamily: FONT_SANS, color: 'primary.main', fontWeight: 600, fontSize: TS.body, px: 1, '&:hover': { bgcolor: 'transparent', textDecoration: 'underline' } }}
          >
            Add filter
          </Button>
          <Button
            size="small"
            startIcon={<DeleteIcon sx={{ fontSize: TS.xl }} />}
            onClick={onResetRules}
            sx={{ fontFamily: FONT_SANS, color: 'text.secondary', fontWeight: 600, fontSize: TS.body, px: 1, '&:hover': { bgcolor: 'transparent', textDecoration: 'underline', color: 'text.primary' } }}
          >
            Remove all
          </Button>
        </Box>
      </div>
    </Popover>
  );
}



// One chip per applied filter value, each individually removable, so what is
// narrowing the table is visible without reopening every dropdown.
function ActiveFilterChips({ chips, onClearAll }) {
  if (chips.length === 0) return null;

  return (
    <Box
      sx={(t) => ({
        px: 1.5,
        py: 1.25,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 0.875,
        borderTop: '1px solid',
        borderColor: t.palette.divider,
        bgcolor: t.palette.grey[50],
      })}
    >
      <Typography
        variant="caption"
        sx={{ fontFamily: FONT_SANS, fontSize: TS.sm, fontWeight: 600, color: 'text.secondary', letterSpacing: 0, mr: 0.5 }}
      >
        Applied
      </Typography>

      {chips.map((chip) => (
        <Chip
          key={chip.key}
          size="small"
          onDelete={chip.onDelete}
          deleteIcon={<CloseIcon sx={{ fontSize: 14 }} />}
          label={
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontFamily: FONT_SANS, fontSize: TS.body }}>
              <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                {chip.group}
              </Box>
              <Box component="span" sx={{ fontWeight: 700, color: PRIMARY_MAIN }}>
                {chip.label}
              </Box>
            </Box>
          }
          sx={{
            height: 26,
            maxWidth: 320,
            bgcolor: alpha(PRIMARY_MAIN, 0.06),
            border: '1px solid',
            borderColor: alpha(PRIMARY_MAIN, 0.18),
            '& .MuiChip-deleteIcon': {
              color: 'text.secondary',
              '&:hover': { color: 'error.main' }
            }
          }}
        />
      ))}

      <Button
        size="small"
        onClick={onClearAll}
        sx={{ ml: 'auto', fontFamily: FONT_SANS, color: 'error.main', fontWeight: 600, fontSize: TS.body, '&:hover': { bgcolor: alpha(ERROR_MAIN, 0.06) } }}
      >
        Clear all
      </Button>
    </Box>
  );
}



// Sticky control bar above the table: advanced rules, free-text search, the
// five value dropdowns, column visibility, and now export.
function FilterBar({ view, columnVisibilityModel, onToggleColumn, onExportCsv, exportDisabled }) {
  const [anchorElFilter, setAnchorElFilter] = useState(null);
  const [anchorElColumns, setAnchorElColumns] = useState(null);

  // All six filters stay on one row - the bar wraps to a second line at
  // narrower widths rather than hiding controls behind a menu.
  const dropdowns = [
    { label: 'Status', options: STATUS_FILTER_OPTIONS, value: view.selectedStatuses, onValueChange: view.setSelectedStatuses, minWidth: 140 },
    { label: 'Provider', options: view.options.providers, value: view.selectedProviders, onValueChange: view.setSelectedProviders, minWidth: 140, emptyText: 'No providers found' },
    { label: 'Environment', options: view.options.environments, value: view.selectedEnvironments, onValueChange: view.setSelectedEnvironments, minWidth: 155 },
    { label: 'Team', options: view.options.teams, value: view.selectedTeams, onValueChange: view.setSelectedTeams, minWidth: 135, emptyText: 'No teams found' },
    { label: 'Manager', options: view.options.managers, value: view.selectedManagers, onValueChange: view.setSelectedManagers, minWidth: 145, emptyText: 'No managers found' },
    { label: 'Type', options: view.options.types, value: view.selectedTypes, onValueChange: view.setSelectedTypes, minWidth: 125, emptyText: 'No types found' },
  ];

  return (
    <Box
      sx={{
        px: 1.5,
        py: 1.25,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1,
        alignItems: 'center',
      }}
    >
      <SearchField
        value={view.searchText}
        onChange={(e) => view.setSearchText(e.target.value)}
        onClear={() => view.setSearchText('')}
        placeholder="Filter certificates by domain, team, manager, app..."
        ariaLabel="Search certificates"
        clearTooltip="Clear search"
        width={400}
      />

      {dropdowns.map((dropdown) => (
        <FilterMultiSelect key={dropdown.label} {...dropdown} />
      ))}

      {view.hasActiveFilters && (
        <Button
          variant="text"
          size="small"
          startIcon={<CloseIcon sx={{ fontSize: 15 }} />}
          onClick={view.resetAllFilters}
          sx={{ height: 36, color: 'error.main', fontWeight: 600, '&:hover': { bgcolor: alpha(ERROR_MAIN, 0.06) } }}
        >
          Clear
        </Button>
      )}

      <Box sx={{ flexGrow: 1 }} />

      {/* Right toolbar group */}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <Tooltip title={exportDisabled ? 'Nothing to export' : 'Download the filtered rows as CSV'} arrow>
          <span>
            <Button
              variant="outlined"
              size="small"
              startIcon={<FileDownloadOutlinedIcon sx={{ fontSize: 17 }} />}
              onClick={onExportCsv}
              disabled={exportDisabled}
              sx={(t) => ({
                height: 38,
                px: 1.5,
                borderRadius: '8px',
                fontFamily: FONT_SANS,
                fontSize: TS.body,
                fontWeight: 400,
                lineHeight: 1.55,
                textTransform: 'none',
                bgcolor: 'background.paper',
                color: '#000000',
                borderColor: t.palette.divider,
                '&:hover': {
                  bgcolor: alpha(PRIMARY_MAIN, 0.04),
                  borderColor: 'grey.400',
                },
                '&.Mui-disabled': {
                  bgcolor: 'background.paper',
                  color: 'text.disabled',
                  borderColor: t.palette.divider,
                }
              })}
            >
              Export CSV
            </Button>
          </span>
        </Tooltip>

        <Badge
          badgeContent={view.activeFilterCount}
          color="primary"
          overlap="rectangular"
          sx={{ '& .MuiBadge-badge': { fontSize: TS.sm, fontWeight: 700, height: 17, minWidth: 17 } }}
        >
          <Button
            variant="outlined"
            startIcon={<FilterListIcon sx={{ fontSize: 17 }} />}
            size="small"
            onClick={(e) => setAnchorElFilter(e.currentTarget)}
            sx={(t) => ({
              height: 38,
              px: 1.5,
              borderRadius: '8px',
              fontFamily: FONT_SANS,
              fontSize: TS.body,
              fontWeight: 400,
              lineHeight: 1.55,
              textTransform: 'none',
              bgcolor: 'background.paper',
              color: '#000000',
              borderColor: t.palette.divider,
              '&:hover': {
                bgcolor: alpha(PRIMARY_MAIN, 0.04),
                borderColor: 'grey.400',
              },
            })}
          >
            Filters
          </Button>
        </Badge>

        <Button
          variant="outlined"
          startIcon={<ViewColumnIcon sx={{ fontSize: 17 }} />}
          size="small"
          onClick={(e) => setAnchorElColumns(e.currentTarget)}
          sx={(t) => ({
            height: 38,
            px: 1.5,
            borderRadius: '8px',
            fontFamily: FONT_SANS,
            fontSize: TS.body,
            fontWeight: 400,
            lineHeight: 1.55,
            textTransform: 'none',
            bgcolor: 'background.paper',
            color: '#000000',
            borderColor: t.palette.divider,
            '&:hover': {
              bgcolor: alpha(PRIMARY_MAIN, 0.04),
              borderColor: 'grey.400',
            },
          })}
        >
          Columns
        </Button>
      </Box>

      <FilterRulesPopover
        anchorEl={anchorElFilter}
        onClose={() => setAnchorElFilter(null)}
        rules={view.filterRules}
        onAddRule={view.addFilterRule}
        onRemoveRule={view.removeFilterRule}
        onUpdateRule={view.updateFilterRule}
        onResetRules={view.resetFilterRules}
      />

      <Menu
        anchorEl={anchorElColumns}
        open={Boolean(anchorElColumns)}
        onClose={() => setAnchorElColumns(null)}
        slotProps={{ popper: ZOOM_AWARE_POPPER_PROPS, paper: { sx: { ...FLOATING_PANEL_SX, p: 1, minWidth: 248, maxHeight: 460 } } }}
      >
        <Typography
          variant="caption"
          sx={{ display: 'block', px: 2, py: 0.75, fontFamily: FONT_SANS, fontSize: TS.body, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em' }}
        >
          Show / hide columns
        </Typography>
        {OPTIONAL_COLUMNS.map(({ field, label }) => (
          <MenuItem key={field} onClick={() => onToggleColumn(field)}>
            <Checkbox checked={!!columnVisibilityModel[field]} size="small" tabIndex={-1} disableRipple />
            <Typography variant="body2" sx={{ ml: 1, fontFamily: FONT_SANS, fontSize: TS.body, fontWeight: 500 }}>{label}</Typography>
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}



// --- GRID ---
const CELL_FLEX_SX = { display: 'flex', alignItems: 'center', height: '100%' };

// Monospaced, truncated text - used for identifiers (channel names, account
// ids) where character alignment matters more than prose readability.
function MonoCell({ value, fontSize = '0.8125rem', color = (t) => '#111827', tabularNums = false }) {
  return (
    <Typography
      noWrap
      sx={{ fontFamily: FONT_MONO, fontSize, fontWeight: 400, color, fontVariantNumeric: tabularNums ? 'tabular-nums' : 'normal' }}
    >
      {value}
    </Typography>
  );
}

// Both alerting columns are a switch plus an On/Off label, and both must stop
// the click from also opening the detail drawer.
const renderToggleCell = (field, ariaLabel, onToggle) => (params) => (
  <Box sx={{ ...CELL_FLEX_SX, gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
    <Switch
      size="small"
      checked={!!params.value}
      onChange={() => onToggle(params.row.id, field)}
      // v9 dropped `inputProps` from Switch; it has to go through slotProps or
      // the toggle ends up with no accessible name at all.
      slotProps={{ input: { 'aria-label': ariaLabel } }}
    />
    <Typography sx={{ fontFamily: FONT_SANS, fontSize: TS.xs, fontWeight: 700, letterSpacing: '0.06em', ...(params.value ? CARE_GRADIENT_TEXT_SX : { color: 'text.secondary' }) }}>
      {params.value ? 'ON' : 'OFF'}
    </Typography>
  </Box>
);


// Env pill. A component rather than an inline renderer so it can read the
// active mode through useTints - a renderCell callback can't hold hooks.
function EnvPill({ value }) {
  const tints = useTints();
  const key = String(value).toUpperCase();
  const tint = tints.env[key] || tints.env.DEV;
  return (
    <Box sx={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      px: 1.25,
      height: 22,
      borderRadius: '999px',
      bgcolor: tint.bg,
      color: tint.fg,
      border: '1px solid',
      borderColor: tint.border,
      fontFamily: FONT_MONO,
      fontSize: TS.sm,
      fontWeight: 700,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
    }}>
      {key}
    </Box>
  );
}

const renderEnvCell = (params) => (params.value ? <EnvPill value={params.value} /> : null);



// Grid column definitions. Built through a factory so the cell renderers can
// close over the row handlers while the definitions themselves stay outside the
// page component.
// Column headers. Sentence case at 12px rather than 10.6px uppercase with
// letter-spacing: uppercase + tracking is what forced "RENEWAL FRE..." to
// truncate, and it reads slower. Same width now fits the whole label.
const renderHeaderWithTooltip = (title, tooltipText) => () => (
  <Tooltip title={tooltipText || title} placement="top" arrow>
    <Typography
      noWrap
      sx={{
        fontFamily: FONT_SANS,
        // Same 13px as the cells below, held apart by weight rather than by
        // being smaller. A header set below the body size reads as a footnote
        // to the data instead of a label for it.
        fontSize: TS.body,
        fontWeight: 600,
        letterSpacing: 0,
        color: 'text.secondary',
        cursor: 'pointer',
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      {title}
    </Typography>
  </Tooltip>
);

const createCertificateColumns = ({ onToggle, onOpenRunbook, onCopyDomain }) => [
  {
    field: 'domainName',
    headerName: 'Domain name',
    description: 'Domain Name',
    renderHeader: renderHeaderWithTooltip('Domain name', 'Domain Name'),
    flex: 1,
    minWidth: 170,
    sortable: true,
    renderCell: (params) => <DomainCell value={params.value} onCopy={onCopyDomain} />
  },
  {
    field: 'certProvider',
    headerName: 'Provider',
    description: 'Certificate Provider',
    renderHeader: renderHeaderWithTooltip('Provider', 'Certificate Provider'),
    flex: 1,
    minWidth: 170,
    renderCell: (params) => (
      <Typography noWrap sx={{ fontFamily: FONT_SANS, fontSize: TS.body, fontWeight: 400, letterSpacing: 0, color: (t) => '#111827'}}>
        {displayValue(params.value)}
      </Typography>
    )
  },
  {
    field: 'expiryDate',
    headerName: 'Expiry date',
    description: 'Expiry Date & Days Left',
    renderHeader: renderHeaderWithTooltip('Expiry date', 'Expiry Date & Days Left'),
    flex: 1,
    minWidth: 170,
    renderCell: (params) => {
      if (!params.value) return null;
      const expiry = parseValidDate(params.value);
      if (!expiry) {
        return (
          <Typography sx={{ fontFamily: FONT_SANS, fontSize: TS.body, fontWeight: 400, letterSpacing: 0, color: 'text.disabled' }}>
            {displayValue(params.value)}
          </Typography>
        );
      }
      const daysLeft = getDaysLeft(params.value);
      const { color } = getCertStatus(daysLeft);
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', gap: 0.375 }}>
          <Typography sx={{ fontFamily: FONT_SANS, fontSize: TS.body, fontWeight: 400, letterSpacing: 0, color: (t) => '#111827', fontVariantNumeric: 'tabular-nums' }}>
            {formatShortDate(expiry)}
          </Typography>
          <StatusPill colorKey={color} label={formatDaysLeft(daysLeft)} dense />
        </Box>
      );
    }
  },
  {
    field: 'renewalFrequency',
    headerName: 'Renewal frequency',
    description: 'Renewal Frequency',
    renderHeader: renderHeaderWithTooltip('Renewal frequency', 'Renewal Frequency'),
    flex: 1,
    minWidth: 170,
    renderCell: (params) => (
      <Typography noWrap sx={{ fontFamily: FONT_SANS, fontSize: TS.body, fontWeight: 400, letterSpacing: 0, color: (t) => '#111827'}}>
        {displayValue(params.value)}
      </Typography>
    )
  },
  {
    field: 'teamOwner',
    headerName: 'Team owner',
    description: 'Team Owner',
    renderHeader: renderHeaderWithTooltip('Team owner', 'Team Owner'),
    flex: 1,
    minWidth: 170,
    renderCell: (params) => (
      <Typography noWrap sx={{ fontFamily: FONT_SANS, fontSize: TS.body, fontWeight: 400, letterSpacing: 0, color: (t) => '#111827'}}>
        {displayValue(params.value)}
      </Typography>
    )
  },
  {
    field: 'manager',
    headerName: 'Manager',
    description: 'Engineering Manager',
    renderHeader: renderHeaderWithTooltip('Manager', 'Engineering Manager'),
    flex: 1,
    minWidth: 170,
    renderCell: (params) => (
      <Typography noWrap sx={{ fontFamily: FONT_SANS, fontSize: TS.body, fontWeight: 400, letterSpacing: 0, color: (t) => '#111827'}}>
        {displayValue(params.value)}
      </Typography>
    )
  },
  {
    field: 'escalationMatrix',
    headerName: 'Escalation',
    description: 'Escalation Matrix Contacts',
    renderHeader: renderHeaderWithTooltip('Escalation', 'Escalation Matrix (L1 / L2 / L3)'),
    flex: 1,
    minWidth: 170,
    renderCell: (params) => {
      const contacts = parseEscalationMatrix(params.value);
      if (contacts.length === 0) {
        return <Typography sx={{ fontFamily: FONT_SANS, fontSize: TS.body, fontWeight: 300, color: 'text.disabled' }}>-</Typography>;
      }
      const fullText = contacts.map((c) => `${c.level}:${c.name}`).join('; ');
      return (
        <Tooltip title={fullText} placement="top-start" arrow>
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              borderRadius: '5px',
              border: '1px solid',
              borderColor: (t) => '#CBD5E1',
              bgcolor: (t) => '#F1F5F9',
              overflow: 'hidden',
              maxWidth: '100%',
              height: 22,
            }}
          >
            <Typography
              noWrap
              sx={{
                fontFamily: FONT_SANS,
                fontSize: TS.xs,
                fontWeight: 500,
                color: (t) => '#1E293B',
                px: 0.75,
              }}
            >
              {fullText}
            </Typography>
          </Box>
        </Tooltip>
      );
    }
  },

  {
    field: 'slackAlerting',
    headerName: 'Slack alerting',
    description: 'Slack Alerting Status',
    renderHeader: renderHeaderWithTooltip('Slack alerting', 'Slack Alerting Status'),
    flex: 1,
    minWidth: 170,
    renderCell: renderToggleCell('slackAlerting', 'Toggle Slack alerting', onToggle)
  },
  {
    field: 'slackChannelName',
    headerName: 'Slack channel',
    description: 'Slack Channel Name',
    renderHeader: renderHeaderWithTooltip('Slack channel', 'Slack Channel Name'),
    flex: 1,
    minWidth: 170,
    renderCell: (params) => {
      if (!params.value || params.value === EM_DASH) {
        return <Typography sx={{ fontFamily: FONT_SANS, fontSize: TS.body, fontWeight: 300, color: 'text.disabled' }}>-</Typography>;
      }
      const raw = String(params.value);
      const display = raw.startsWith('#') ? raw : `#${raw}`;
      return (
        <Tooltip title={display} placement="top-start" arrow>
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              borderRadius: '5px',
              border: '1px solid',
              borderColor: (t) => '#CBD5E1',
              bgcolor: (t) => '#F1F5F9',
              overflow: 'hidden',
              maxWidth: '100%',
              height: 22,
            }}
          >
            <Typography
              noWrap
              sx={{
                fontFamily: FONT_SANS,
                fontSize: TS.xs,
                fontWeight: 500,
                color: (t) => '#1E293B',
                px: 0.75,
              }}
            >
              {display}
            </Typography>
          </Box>
        </Tooltip>
      );
    }
  },

  {
    field: 'pagerDutyAlerting',
    headerName: 'PagerDuty',
    description: 'PagerDuty Alerting Status',
    renderHeader: renderHeaderWithTooltip('PagerDuty', 'PagerDuty Alerting Status'),
    flex: 1,
    minWidth: 170,
    renderCell: renderToggleCell('pagerDutyAlerting', 'Toggle PagerDuty alerting', onToggle)
  },
  {
    field: 'app',
    headerName: 'App',
    description: 'Application Name',
    renderHeader: renderHeaderWithTooltip('App', 'Application Name'),
    flex: 1,
    minWidth: 170,
    renderCell: (params) => (
      <Typography noWrap sx={{ fontFamily: FONT_SANS, fontSize: TS.body, fontWeight: 400, letterSpacing: 0, color: (t) => '#111827'}}>
        {displayValue(params.value)}
      </Typography>
    )
  },
  {
    field: 'ci',
    headerName: 'CI',
    description: 'Configuration Item / CI',
    renderHeader: renderHeaderWithTooltip('CI', 'Configuration Item / CI'),
    flex: 1,
    minWidth: 170,
    renderCell: (params) => (
      <Typography noWrap sx={{ fontFamily: FONT_SANS, fontSize: TS.body, fontWeight: 400, letterSpacing: 0, color: (t) => '#111827'}}>
        {displayValue(params.value)}
      </Typography>
    )
  },
  {
    field: 'type',
    headerName: 'Type',
    description: 'Certificate Type',
    renderHeader: renderHeaderWithTooltip('Type', 'Certificate Type'),
    flex: 1,
    minWidth: 170,
    renderCell: (params) => (
      <Typography noWrap sx={{ fontFamily: FONT_SANS, fontSize: TS.body, fontWeight: 400, color: (t) => '#111827'}}>
        {displayValue(params.value)}
      </Typography>
    )
  },
  {
    field: 'environment',
    headerName: 'Environment',
    description: 'Deployment Environment',
    renderHeader: renderHeaderWithTooltip('Environment', 'Deployment Environment'),
    flex: 1,
    minWidth: 170,
    renderCell: renderEnvCell
  },
  {
    field: 'accountId',
    headerName: 'Account ID',
    description: 'Cloud Account ID',
    renderHeader: renderHeaderWithTooltip('Account ID', 'Cloud Account ID'),
    flex: 1,
    minWidth: 170,
    renderCell: (params) => (params.value ? <MonoCell value={params.value} tabularNums /> : null)
  },
  {
    field: 'runbook',
    headerName: 'Runbook',
    description: 'Runbook Documentation',
    renderHeader: renderHeaderWithTooltip('Runbook', 'Runbook Documentation'),
    flex: 1,
    minWidth: 170,
    sortable: false,
    renderCell: (params) => {
      const open = (e) => {
        e.stopPropagation();
        onOpenRunbook(params.row.runbookUrl);
      };
      return (
        <Box
          role="button"
          tabIndex={0}
          onClick={open}
          onKeyDown={(e) => { if (e.key === 'Enter') open(e); }}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            px: 1,
            height: 24,
            borderRadius: '6px',
            cursor: 'pointer',
            color: 'primary.main',
            border: '1px solid',
            borderColor: alpha(PRIMARY_MAIN, 0.22),
            bgcolor: alpha(PRIMARY_MAIN, 0.05),
            transition: 'all 0.15s ease',
            '&:hover': { bgcolor: alpha(PRIMARY_MAIN, 0.11), borderColor: 'primary.main' },
            '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 }
          }}
        >
          <Typography sx={{ fontFamily: FONT_SANS, fontSize: TS.body, fontWeight: 600 }}>View</Typography>
          <OpenInNewIcon sx={{ fontSize: 13 }} />
        </Box>
      );
    }
  }
];


// Replaces the grid's default footer with a rows-per-page picker and numbered
// pagination that match the rest of the design system.
function CertFooterPagination() {
  const apiRef = useGridApiContext();
  const { page, pageSize } = useGridSelector(apiRef, gridPaginationModelSelector);
  const pageCount = useGridSelector(apiRef, gridPageCountSelector);
  const rowCount = useGridSelector(apiRef, gridRowCountSelector);

  const start = rowCount === 0 ? 0 : page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, rowCount);

  return (
    <GridFooterContainer
      sx={{
        bgcolor: 'grey.50',
        borderColor: '#C7DBEE',
        minHeight: 45,
        px: 2,
        py: 1.2,
        boxSizing: 'border-box',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        {/* aria-live announces this to screen readers whenever it changes -
            a filter narrowing the set, a sort triggering a page reset, or a
            page change - none of which otherwise had any non-visual signal. */}
        <Typography
          variant="body2"
          aria-live="polite"
          aria-atomic="true"
          sx={{ color: 'text.secondary', fontWeight: 600, fontSize: TS.body }}
        >
          Showing {start}-{end} of {rowCount} certificates
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500, fontSize: TS.body }}>Rows per page</Typography>
            <Select
              native
              size="small"
              value={pageSize}
              onChange={(e) => apiRef.current.setPageSize(Number(e.target.value))}
              inputProps={{ 'aria-label': 'Rows per page' }}
              sx={{
                height: 26,
                fontSize: TS.body,
                minWidth: 64,
                bgcolor: 'background.paper',
                borderRadius: '6px',
                // Native <select> uses the browser menu — avoids MUI Popper, which
                // misaligns when html { zoom } is applied (UI_SCALE).
                '& .MuiNativeSelect-select': { py: 0.25, pl: 1, pr: 3 },
              }}
            >
              {ROWS_PER_PAGE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </Select>
          </Box>

          <Pagination
            color="primary"
            shape="rounded"
            size="small"
            count={pageCount}
            page={page + 1}
            onChange={(event, value) => apiRef.current.setPage(value - 1)}
            sx={{
              '& .MuiPaginationItem-root': {
                fontSize: TS.body,
                fontWeight: 600,
                borderRadius: '6px',
                color: 'text.secondary',
                minWidth: 23,
                height: 23,
                margin: '0 2px',
                '&:hover': { bgcolor: SUBTLE_BG_STRONG }
              },
              '& .MuiPaginationItem-root.Mui-selected': {
                color: '#FFFFFF',
                background: CARE_BAR_GRADIENT,
                boxShadow: 'none',
                '&:hover': { background: CARE_WORDMARK_GRADIENT },
              },
              '& .MuiPaginationItem-ellipsis': {
                 border: 'none',
                 bgcolor: 'transparent',
                 color: 'text.secondary',
              }
            }}
          />
        </Box>
      </Box>
    </GridFooterContainer>
  );
}

// Shown inside the DataGrid area while certificates are being fetched from the
// API Gateway, so the empty grid doesn't read as "broken" during the fetch.
function CertLoadingOverlay() {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        gap: 1.75,
        color: 'text.secondary',
        bgcolor: (t) => alpha(t.palette.background.paper, 0.82),
        backdropFilter: 'blur(2px)',
      }}
    >
      <Box sx={{ position: 'relative', display: 'inline-flex' }}>
        <CircularProgress size={40} thickness={3} sx={{ color: 'primary.main' }} />
        <ShieldOutlinedIcon
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: 17,
            color: 'primary.main'
          }}
        />
      </Box>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
          Loading certificates from registry...
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
          This usually takes a few seconds
        </Typography>
      </Box>
    </Box>
  );
}

// Empty state for the grid - friendlier than a bare "no rows" string.
function CertNoRowsOverlay() {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 0.75,
        py: 6,
        px: 3,
      }}
    >
      {/* The icon carries the state on its own - the bordered grey pill it used
          to sit in added a frame without adding meaning. */}
      <InboxOutlinedIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 0.5 }} />
      <Typography sx={{ fontSize: TS.lg, fontWeight: 600, color: 'text.primary' }}>
        No certificates match this view
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 360, textAlign: 'center' }}>
        Every certificate is filtered out. Clear a filter above, or widen your search
        to bring rows back.
      </Typography>
    </Box>
  );
}


const CERT_GRID_SX = (t) => ({
  border: 'none',
  fontSize: TS.body,
  minHeight: 260,
  '--DataGrid-rowBorderColor': t.palette.divider,
  '--DataGrid-t-header-background-base': TABLE_HEADER_BG,
  '--DataGrid-t-color-foreground-accent': TABLE_HEADER_TEXT,
  '& .MuiDataGrid-row': { cursor: 'pointer', transition: 'background-color 0.12s ease' },
  '& .MuiDataGrid-columnHeaders, & .MuiDataGrid-columnHeader': {
    backgroundColor: `${TABLE_HEADER_BG} !important`,
    color: TABLE_HEADER_TEXT,
    borderBottom: '1px solid',
    borderColor: TABLE_HEADER_BORDER,
  },
  '& .MuiDataGrid-columnHeaderTitleContainer': {
    overflow: 'visible',
  },
  '& .MuiDataGrid-columnHeaderTitle, & .MuiDataGrid-columnHeaderTitleContainerContent': {
    fontFamily: FONT_SANS,
    fontWeight: 600,
    fontSize: TS.body,
    letterSpacing: 0,
    color: `${TABLE_HEADER_TEXT} !important`,
    whiteSpace: 'nowrap',
    overflow: 'visible',
  },
  '& .MuiDataGrid-iconButtonContainer .MuiSvgIcon-root, & .MuiDataGrid-sortIcon': {
    color: `${TABLE_HEADER_TEXT} !important`,
  },
  // -- Column separators.
  //
  // A short, vertically centred pipe rather than a full-height border. Rules
  // that run edge-to-edge through the header AND the cells turn a data table
  // into a spreadsheet grid: sixteen boxed columns, every cell outlined, and
  // the eye has to work past the chrome to reach the values. Insetting the
  // divider to ~40% of the header height reads as the pipe it is meant to be,
  // and the rows below stay open.
  //
  // MUI's separator element is ALSO the drag handle for column resizing, so it
  // must stay in the DOM with its hit area intact - `display: none` here is what
  // silently disabled drag-to-resize. Only its glyph is hidden, and only at
  // rest: hovering a header fades it in so the handle is discoverable.
  '& .MuiDataGrid-columnSeparator': {
    visibility: 'visible',
    color: 'transparent',
  },
  '& .MuiDataGrid-iconSeparator': {
    opacity: 0,
    transition: 'opacity 0.15s ease',
  },
  '& .MuiDataGrid-columnHeader:hover .MuiDataGrid-iconSeparator': {
    opacity: 1,
    color: t.palette.grey[400],
  },
  '& .MuiDataGrid-columnSeparator--resizable': { cursor: 'col-resize' },
  '& .MuiDataGrid-columnHeader': { position: 'relative', px: 1.75 },
  '& .MuiDataGrid-columnHeader:not(:last-of-type)::after': {
    content: '""',
    position: 'absolute',
    right: 0,
    top: '50%',
    transform: 'translateY(-50%)',
    width: '1px',
    height: 18,
    backgroundColor: TABLE_HEADER_BORDER,
    pointerEvents: 'none',
  },
  '& .MuiDataGrid-cell': {
    fontFamily: FONT_SANS,
    fontSize: TS.body,
    fontWeight: 400,
    letterSpacing: '0.005em',
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale',
    color: (t) => '#111827',
    borderBottom: '1px solid',
    borderColor: t.palette.divider,
    display: 'flex',
    alignItems: 'center',
    px: 1.75
  },
  // --- STICKY FIRST COLUMN (DOMAIN NAME) ---
  // Its right edge is a soft shadow only, no hard border: the shadow is the
  // functional part (it signals content scrolling underneath), and dropping the
  // border keeps this divider consistent with the centred pipes above.
  '& .MuiDataGrid-columnHeader[data-field="domainName"]': {
    position: 'sticky',
    left: 0,
    zIndex: 4,
    bgcolor: `${TABLE_HEADER_BG} !important`,
    boxShadow: '4px 0 8px -4px rgba(16,24,40,0.10)',
  },
  '& .MuiDataGrid-cell[data-field="domainName"]': {
    position: 'sticky',
    left: 0,
    zIndex: 3,
    bgcolor: '#FFFFFF',
    boxShadow: '4px 0 8px -4px rgba(16,24,40,0.10)',
  },
  '& .MuiDataGrid-row:hover .MuiDataGrid-cell[data-field="domainName"], & .MuiDataGrid-row.Mui-hovered .MuiDataGrid-cell[data-field="domainName"]': {
    bgcolor: '#F8FAFC',
  },
  '& .cert-row-selected .MuiDataGrid-cell[data-field="domainName"], & .cert-row-selected:hover .MuiDataGrid-cell[data-field="domainName"]': {
    bgcolor: '#EFF6FF',
  },
  '& .MuiDataGrid-row:hover, & .MuiDataGrid-row.Mui-hovered': {
    bgcolor: '#F8FAFC',
  },
  '& .cert-row-selected, & .cert-row-selected:hover': { bgcolor: ROW_SELECTED_BG },
  '& .MuiDataGrid-footerContainer': {
    borderTop: '1px solid',
    borderColor: '#C7DBEE',
    bgcolor: 'grey.50',
    minHeight: 45,
    boxSizing: 'border-box',
    overflow: 'visible',
  },
  '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within': { outline: 'none' },
  '& .MuiDataGrid-columnHeader:focus, & .MuiDataGrid-columnHeader:focus-within': { outline: 'none' },
  '& .MuiDataGrid-overlayWrapper': {
    left: '0 !important',
    right: '0 !important',
    width: '100% !important',
  },
  '& .MuiDataGrid-overlayWrapperInner': {
    bgcolor: 'background.paper',
    width: '100% !important',
    maxWidth: '100% !important',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// Suppresses the DataGrid's built-in loading overlay (it centers only in the
// scroll viewport, which looks off-center when a column is pinned). The grid
// wrapper renders CertLoadingOverlay over the full table instead.
function GridLoadingOverlayPlaceholder() {
  return null;
}

const GRID_SLOTS = {
  footer: CertFooterPagination,
  loadingOverlay: GridLoadingOverlayPlaceholder,
  noRowsOverlay: CertNoRowsOverlay
};

// The table itself: perfectly clean with the obsolete bar stripped out.
function CertificateGrid({
  rows,
  columns,
  loading,
  columnVisibilityModel,
  onColumnVisibilityModelChange,
  selectedCertId,
  onRowClick,
  density = DEFAULT_DENSITY,
}) {
  const { rowHeight } = resolveDensity(density);

  return (
    <Box sx={{ width: '100%' }}>
      <Box sx={{ width: '100%', position: 'relative' }}>
        {loading && <LinearProgress sx={{ height: 2 }} />}
        {loading && (
          <Box sx={{ position: 'absolute', inset: 0, zIndex: 10 }}>
            <CertLoadingOverlay />
          </Box>
        )}
        <DataGrid
          autoHeight
          loading={loading}
          disableColumnMenu
          rows={rows}
          columns={columns}
          pageSizeOptions={ROWS_PER_PAGE_OPTIONS}
          initialState={{
            pagination: { paginationModel: { pageSize: DEFAULT_ROWS_PER_PAGE } },
            pinnedColumns: { left: ['domainName'] }
          }}
          rowHeight={rowHeight}
          columnHeaderHeight={46}
          // MUI's own default overscan is a few hundred px; 4000px meant every
          // column effectively rendered off-screen too, which defeats column
          // virtualization on a 17-column grid. Lowered to a still-generous
          // buffer that keeps horizontal scroll smooth without pre-rendering
          // the whole row. Re-profile with React DevTools if sticky-column /
          // pinned-column scroll ever feels janky at this value.
          columnBufferPx={200}
          disableRowSelectionOnClick
          onRowClick={onRowClick}
          getRowClassName={(params) => (params.row.id === selectedCertId ? 'cert-row-selected' : '')}
          columnVisibilityModel={columnVisibilityModel}
          onColumnVisibilityModelChange={onColumnVisibilityModelChange}
          slots={GRID_SLOTS}
          slotProps={{
            footer: { size: 'small' }
          }}
          sx={CERT_GRID_SX}
        />
      </Box>
    </Box>
  );
}



// --- DETAIL PANEL ---
// Label on the left, value on the right, with a dashed separator between rows.
function DetailRow({ label, value }) {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 2,
        py: 1.375,
        borderBottom: '1px dashed',
        borderColor: 'divider',
        '&:last-of-type': { borderBottom: 'none' }
      }}
    >
      <Typography
        sx={{
          fontSize: TS.body,
          fontWeight: 500,
          color: 'text.secondary',
          flexShrink: 0,
          letterSpacing: '0.01em',
          fontFamily: FONT_SANS,
        }}
      >
        {label}
      </Typography>
      <Box sx={{ textAlign: 'right', minWidth: 0 }}>{value}</Box>
    </Box>
  );
}

// Consistent emphasis for the right-hand value of a DetailRow.
function DetailValue({ children, mono = false }) {
  // Callers pass raw row fields, which are frequently absent. Normalising here
  // means an unset field reads as a dash instead of collapsing to a blank row.
  const isPrimitive = children === null || children === undefined || typeof children !== 'object';
  const content = isPrimitive ? displayValue(children) : children;
  const isPlaceholder = content === EM_DASH;

  return (
    <Typography
      sx={{
        fontSize: isPlaceholder ? '0.8125rem' : '0.875rem',
        fontWeight: isPlaceholder ? 400 : 600,
        color: isPlaceholder ? 'text.disabled' : 'text.primary',
        fontFamily: mono && !isPlaceholder ? FONT_MONO : FONT_SANS,
        wordBreak: 'break-word',
        letterSpacing: mono && !isPlaceholder ? '0.02em' : 0,
        lineHeight: 1.5,
      }}
    >
      {content}
    </Typography>
  );
}

// Card wrapper used to group related fields inside the detail drawer.
function DetailSection({ title, icon, children }) {
  return (
    <Box
      sx={{
        mb: 2,
        borderRadius: '12px',
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        overflow: 'hidden'
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          py: 1.25,
          bgcolor: SUBTLE_BG,
          borderBottom: '1px solid',
          borderColor: 'divider'
        }}
      >
        {icon}
        <Typography
          variant="caption"
          sx={{ textTransform: 'uppercase', color: 'text.secondary', fontWeight: 700 }}
        >
          {title}
        </Typography>
      </Box>
      <Box sx={{ px: 2, py: 1 }}>{children}</Box>
    </Box>
  );
}

// Every section header icon is the same size and tone.
const sectionIcon = (Icon) => <Icon sx={{ fontSize: 16, color: 'text.secondary' }} />;

// Renders a list of { field, label, mono } entries straight from a row.
function DetailFieldRows({ cert, fields }) {
  return fields.map(({ field, label, mono }) => (
    <DetailRow key={field} label={label} value={<DetailValue mono={mono}>{cert[field]}</DetailValue>} />
  ));
}


// One row of the Alerts tab: what the channel is, where it goes, and its switch.
function AlertChannelRow({ icon, title, subtitle, subtitleVariant = 'description', checked, onChange, divider = false }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        py: 1.5,
        ...(divider ? { borderBottom: '1px dashed', borderColor: 'divider' } : null)
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
        {icon}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{title}</Typography>
          <Typography
            variant="body2"
            sx={
              subtitleVariant === 'name'
                ? { fontWeight: 600, wordBreak: 'break-word' }
                : { color: 'text.secondary' }
            }
          >
            {subtitle}
          </Typography>
        </Box>
      </Box>
      <Switch
        checked={checked}
        onChange={onChange}
        slotProps={{ input: { 'aria-label': `${title} alerts` } }}
      />
    </Box>
  );
}

function EscalationTimeline({ contacts }) {
  if (contacts.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: 'text.secondary', py: 1.5 }}>
        No escalation contacts configured.
      </Typography>
    );
  }

  return (
    <Box sx={{ py: 1 }}>
      {contacts.map((contact, idx) => {
        const isLast = idx === contacts.length - 1;
        return (
          <Box key={`${contact.name}-${idx}`} sx={{ display: 'flex', alignItems: 'stretch', gap: 1.75 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <Box
                sx={{
                  width: 28,
                  height: 28,
                  flexShrink: 0,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  fontSize: TS.body,
                  fontWeight: 700
                }}
              >
                {contact.level}
              </Box>
              {!isLast && <Box sx={{ flex: 1, width: '2px', minHeight: 18, bgcolor: SUBTLE_BG_STRONG, my: 0.5 }} />}
            </Box>
            <Box sx={{ pb: isLast ? 0 : 2, pt: 0.375, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, textTransform: 'capitalize', wordBreak: 'break-word' }}>
                {contact.name}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Escalation level {contact.level}
              </Typography>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

// Right-hand drawer with everything known about one certificate, plus the two
// alerting switches.
function CertificateDetailPanel({ cert, onClose, onToggle, onOpenRunbook }) {
  const [tab, setTab] = useState(0);
  const tints = useTints();

  // The panel instance persists across certificates (clicking cert B while
  // the drawer is already open on cert A doesn't remount this component), so
  // without this the drawer used to stay parked on whatever tab cert A was
  // showing - e.g. opening cert B already on its "Runbook" tab because that's
  // where the previous certificate happened to be left.
  useEffect(() => {
    setTab(0);
  }, [cert?.id]);

  if (!cert) return null;

  const expiry = parseValidDate(cert.expiryDate);
  const daysLeft = getDaysLeft(cert.expiryDate);
  const status = getCertStatus(daysLeft);
  const escalation = parseEscalationMatrix(cert.escalationMatrix);

  return (
    <Drawer
      anchor="right"
      open={Boolean(cert)}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: 468 }, bgcolor: SUBTLE_BG, backgroundImage: 'none' } } }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 3,
          pt: 2.5,
          pb: 0,
          bgcolor: 'background.paper',
          borderBottom: '1px solid',
          borderColor: 'divider'
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, minWidth: 0 }}>
            <Box
              sx={{
                width: 36,
                height: 36,
                flexShrink: 0,
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                ...CARE_GRADIENT_SURFACE_SX,
                border: '1px solid',
                borderColor: alpha(BRAND_TEAL_LIGHT, 0.28),
              }}
            >
              <PublicOutlinedIcon sx={{ fontSize: 19, color: BRAND_TEAL_LIGHT }} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase' }}>
                Certificate
              </Typography>
              <Typography
                sx={{
                  fontSize: TS.lg,
                  fontWeight: 700,
                  fontFamily: FONT_SANS,
                  wordBreak: 'break-all',
                  lineHeight: 1.35,
                  ...CARE_GRADIENT_TEXT_SX,
                }}
              >
                {cert.domainName}
              </Typography>
            </Box>
          </Box>
          <IconButton size="small" onClick={onClose} aria-label="Close details" sx={{ mt: -0.5 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        <Tabs
          value={tab}
          onChange={(e, v) => setTab(v)}
          variant="scrollable"
          scrollButtons={false}
          sx={{
            mt: 2,
            minHeight: 38,
            '& .MuiTabs-indicator': { height: 2.5, borderRadius: '3px 3px 0 0', background: CARE_WORDMARK_GRADIENT },
            '& .MuiTab-root': {
              minHeight: 38,
              py: 0.5,
              px: 1.5,
              fontSize: TS.body,
              fontWeight: 600,
              textTransform: 'none',
              color: 'text.secondary',
              '&.Mui-selected': { ...CARE_GRADIENT_TEXT_SX },
            }
          }}
        >
          {DETAIL_TABS.map((label) => (
            <Tab key={label} label={label} />
          ))}
        </Tabs>
      </Box>

      {/* Body */}
      <Box sx={{ px: 2.5, py: 2.5, overflowY: 'auto', flex: 1 }}>
        {tab === 0 && (
          <>
            {/* Expiry hero - status-tinted countdown card */}
            {(() => {
              const tint = daysLeft < 0
                ? tints.expired
                : status.color === 'error'
                  ? tints.status.error
                  : status.color === 'warning'
                    ? tints.status.warning
                    : tints.status.success;
              const absDays = Math.abs(daysLeft);
              const isExpired = daysLeft < 0;
              return (
                <Box
                  sx={{
                    mb: 2,
                    borderRadius: '16px',
                    border: '1px solid',
                    borderColor: tint.border,
                    bgcolor: tint.bg,
                    overflow: 'hidden',
                    position: 'relative',
                  }}
                >
                  {/* Subtle top accent line */}
                  <Box sx={{ height: 4, bgcolor: tint.dot, borderRadius: '16px 16px 0 0' }} />

                  <Box sx={{ px: 2.5, pt: 2, pb: 2.25 }}>
                    {/* Top row: label + status badge */}
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                      <Typography
                        sx={{
                          fontSize: TS.xs,
                          fontWeight: 700,
                          letterSpacing: '0.10em',
                          textTransform: 'uppercase',
                          color: tint.fg,
                          opacity: 0.75,
                          fontFamily: FONT_SANS,
                        }}
                      >
                        {isExpired ? 'Certificate Expired' : 'Time Remaining'}
                      </Typography>
                      <StatusPill colorKey={status.color} label={status.label} />
                    </Box>

                    {expiry ? (
                      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2 }}>
                        {/* Big countdown number */}
                        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                          <Typography
                            sx={{
                              fontSize: TS.hero,
                              fontWeight: 800,
                              fontFamily: FONT_MONO,
                              color: tint.dot,
                              lineHeight: 1,
                              fontVariantNumeric: 'tabular-nums',
                              letterSpacing: '-0.03em',
                            }}
                          >
                            {absDays}
                          </Typography>
                          <Typography
                            sx={{
                              fontSize: TS.xl,
                              fontWeight: 600,
                              fontFamily: FONT_SANS,
                              color: tint.fg,
                              opacity: 0.80,
                              lineHeight: 1,
                              pb: 0.25,
                            }}
                          >
                            {absDays === 1 ? 'day' : 'days'}{isExpired ? ' ago' : ' left'}
                          </Typography>
                        </Box>

                        {/* Expiry date block */}
                        <Box sx={{ textAlign: 'right' }}>
                          <Typography
                            sx={{
                              fontSize: TS.xs,
                              fontWeight: 600,
                              letterSpacing: '0.08em',
                              textTransform: 'uppercase',
                              color: tint.fg,
                              opacity: 0.65,
                              fontFamily: FONT_SANS,
                            }}
                          >
                            Expiry date
                          </Typography>
                          <Typography
                            sx={{
                              fontSize: TS.lg,
                              fontWeight: 700,
                              fontFamily: FONT_SANS,
                              color: tint.fg,
                              fontVariantNumeric: 'tabular-nums',
                              lineHeight: 1.3,
                            }}
                          >
                            {formatShortDate(expiry)}
                          </Typography>
                        </Box>
                      </Box>
                    ) : (
                      <Typography sx={{ fontSize: TS.md, color: tint.fg, opacity: 0.75 }}>
                        No expiry date recorded
                      </Typography>
                    )}
                  </Box>
                </Box>
              );
            })()}

            <DetailSection title="Certificate" icon={sectionIcon(ShieldOutlinedIcon)}>
              <DetailFieldRows cert={cert} fields={OVERVIEW_CERT_FIELDS} />
            </DetailSection>

            <DetailSection title="Ownership" icon={sectionIcon(AccountCircleIcon)}>
              <DetailFieldRows cert={cert} fields={OVERVIEW_OWNERSHIP_FIELDS} />
              <DetailRow
                label="Runbook"
                value={
                  <Typography
                    variant="body2"
                    onClick={() => onOpenRunbook(cert.runbookUrl)}
                    sx={{
                      color: 'primary.main',
                      fontWeight: 600,
                      cursor: 'pointer',
                      '&:hover': { textDecoration: 'underline' }
                    }}
                  >
                    View Runbook
                  </Typography>
                }
              />
            </DetailSection>

            <DetailSection title="Alerting Configuration" icon={sectionIcon(NotificationsActiveOutlinedIcon)}>
              <DetailRow
                label="Slack Alerting"
                value={<StatusPill colorKey={cert.slackAlerting ? 'success' : 'warning'} label={cert.slackAlerting ? 'Enabled' : 'Disabled'} dense />}
              />
              <DetailRow
                label="PagerDuty Alerting"
                value={<StatusPill colorKey={cert.pagerDutyAlerting ? 'success' : 'warning'} label={cert.pagerDutyAlerting ? 'Enabled' : 'Disabled'} dense />}
              />
            </DetailSection>

            <Button
              variant="outlined"
              startIcon={<EditIcon sx={{ fontSize: 16 }} />}
              onClick={() => setTab(2)}
              sx={{ mt: 0.5, width: '100%', height: 40 }}
            >
              Edit Alerting
            </Button>
          </>
        )}

        {tab === 1 && (
          <DetailSection title="Escalation Path" icon={sectionIcon(AltRouteOutlinedIcon)}>
            <EscalationTimeline contacts={escalation} />
          </DetailSection>
        )}

        {tab === 2 && (
          <DetailSection title="Alert Channels" icon={sectionIcon(NotificationsActiveOutlinedIcon)}>
            <AlertChannelRow
              icon={<TagIcon sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />}
              title="Slack Alerting"
              subtitle={cert.slackChannelName}
              subtitleVariant="name"
              checked={cert.slackAlerting}
              onChange={() => onToggle(cert.id, 'slackAlerting')}
              divider
            />
            <AlertChannelRow
              icon={<NotificationsActiveOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />}
              title="PagerDuty Alerting"
              subtitle="Escalates per on-call schedule"
              checked={cert.pagerDutyAlerting}
              onChange={() => onToggle(cert.id, 'pagerDutyAlerting')}
            />
          </DetailSection>
        )}

        {tab === 3 && (
          <DetailSection title="All Details" icon={sectionIcon(AssignmentIcon)}>
            <DetailFieldRows cert={cert} fields={DETAIL_FIELDS} />
          </DetailSection>
        )}

        {tab === 4 && (
          <Box sx={{ ...SURFACE_SX, p: 3, borderRadius: '14px', textAlign: 'center' }}>
            <Box
              sx={{
                width: 48,
                height: 48,
                mx: 'auto',
                mb: 1.5,
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: alpha(PRIMARY_MAIN, 0.09)
              }}
            >
              <MenuBookOutlinedIcon sx={{ fontSize: 24, color: 'primary.main' }} />
            </Box>
            <Typography variant="subtitle1" sx={{ color: 'text.primary', mb: 0.5 }}>Runbook</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2.5 }}>
              Step-by-step renewal and rollback instructions for {cert.domainName}.
            </Typography>
            <Button
              variant="contained"
              endIcon={<OpenInNewIcon sx={{ fontSize: 16 }} />}
              onClick={() => onOpenRunbook(cert.runbookUrl)}
              sx={{ width: '100%', height: 40 }}
            >
              Open Runbook
            </Button>
          </Box>
        )}
      </Box>
    </Drawer>
  );
}





// Lightweight placeholder while a lazy-loaded view chunk downloads.
function ViewFallback() {
  return (
    <Box sx={{ px: PAGE_PX, py: 6, display: 'flex', justifyContent: 'center' }}>
      <CircularProgress size={32} thickness={4} />
    </Box>
  );
}

// --- MAIN PAGE ---
// Banner shown in place of data when the registry can't be reached at all.
function FetchErrorBanner({ message, onRetry, retryDisabled }) {
  const tint = useTints().status.error;
  return (
    <Box
      sx={{
        mx: PAGE_PX,
        mt: 2.5,
        px: 2.5,
        py: 1.75,
        display: 'flex',
        alignItems: 'center',
        gap: 1.75,
        bgcolor: tint.bg,
        border: '1px solid',
        borderColor: tint.border,
        borderLeft: '4px solid',
        borderLeftColor: 'error.main',
        borderRadius: '12px',
        boxShadow: (t) => t.shadows[1],
      }}
    >
      <ErrorOutlineIcon sx={{ fontSize: 22, color: 'error.main', flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle2" sx={{ color: tint.fg }}>
          Unable to load the registry
        </Typography>
        <Typography variant="body2" sx={{ color: tint.fg, opacity: 0.85 }}>
          {message}
        </Typography>
      </Box>
      {/* Neutral outlined, not filled red: retrying is the safest action on
          screen, and destructive styling for it reads as a warning. */}
      <Button
        size="small"
        variant="outlined"
        startIcon={<RefreshIcon sx={{ fontSize: 16 }} />}
        onClick={onRetry}
        disabled={retryDisabled}
        sx={{ flexShrink: 0, bgcolor: 'background.paper' }}
      >
        Retry
      </Button>
    </Box>
  );
}

// Composes the page: header, filter bar, applied filters, KPI strip, table and
// detail drawer. State lives in the two hooks below; this component only wires
// them to the presentational pieces.
function CertRegistryPage() {
  const { notice, showNotice, clearNotice } = useNotice();
  const { rows, loading, lastUpdated, fetchError, refresh, toggleAlerting } = useCertificates({ onNotice: showNotice });
  const view = useCertificateView(rows);
  const { setSelectedStatuses } = view;

  // Which of the three header nav sections is showing. Repository keeps all
  // existing filter/grid behavior; Dashboard and Metrics are read-only views
  // computed from the same `rows` via useCertificateInsights below.
  const [activeView, setActiveView] = useState('repository');
  const insights = useCertificateInsights(rows, activeView);

  const [columnVisibilityModel, setColumnVisibilityModel] = useState(() => ({ ...DEFAULT_COLUMN_VISIBILITY }));
  const [selectedCertId, setSelectedCertId] = useState(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);

  // Copy domain callback
  const handleCopyDomain = useCallback((domain, { success = true } = {}) => {
    if (success) {
      showNotice('info', `Copied ${domain} to clipboard.`);
    } else {
      showNotice('error', `Couldn't copy ${domain} - your browser blocked clipboard access.`);
    }
  }, [showNotice]);

  // Global keyboard shortcuts listener
  useEffect(() => {
    // True while any MUI overlay - a filter dropdown's Menu, a Popover (user
    // menu, notifications, filter rules), or the Drawer - is mounted. Popover,
    // Menu, and Drawer are all built on Modal internally, so this one check
    // catches all of them. Single-key shortcuts (bare digits, "r", "?", "/")
    // are suppressed while any of these are open, since they don't live on an
    // <input> and would otherwise fire "behind" whatever overlay the user is
    // actually interacting with - e.g. pressing "1" while the Team filter
    // dropdown was open used to silently switch the active view underneath it.
    // Cmd/Ctrl+K is intentionally exempt: toggling the command palette is
    // expected to work as a global override even with something else open.
    const hasOpenOverlay = () =>
      Boolean(document.querySelector('.MuiModal-root, .MuiPopover-root, .MuiMenu-root'));

    const handleKeyDown = (e) => {
      // Ignore if user is inside an input, textarea, or contentEditable element
      const tag = e.target.tagName?.toUpperCase();
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
        return;
      }

      if (isInput || hasOpenOverlay()) return;

      if (e.key === '/') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      } else if (e.key === '?') {
        e.preventDefault();
        setShortcutsHelpOpen((prev) => !prev);
      } else if (e.key === '1') {
        setActiveView('repository');
      } else if (e.key === '2') {
        setActiveView('dashboard');
      } else if (e.key === '3') {
        setActiveView('metrics');
      } else if (e.key.toLowerCase() === 'r') {
        refresh();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [refresh]);

  const selectedCert = useMemo(
    () => rows.find((row) => row.id === selectedCertId) || null,
    [rows, selectedCertId]
  );

  const summary = useMemo(() => summarizeCertificates(rows), [rows]);

  // Feeds the header bell. Derived from every row, not the filtered set, so a
  // narrowed view can't hide an expiring certificate from the alert count.
  const alerts = useMemo(() => getCertsNeedingAttention(rows), [rows]);

  const handleOpenRunbook = useCallback((url) => {
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const handleSelectCert = useCallback((id) => setSelectedCertId(id), []);

  // "View all" on the alert panel hands the list over to the table - jumping
  // to Repository first in case it's triggered from Dashboard or Metrics.
  const handleShowAllAlerts = useCallback(() => {
    setActiveView('repository');
    setSelectedStatuses(ATTENTION_STATUSES);
  }, [setSelectedStatuses]);

  const columns = useMemo(
    () => createCertificateColumns({ onToggle: toggleAlerting, onOpenRunbook: handleOpenRunbook, onCopyDomain: handleCopyDomain }),
    [toggleAlerting, handleOpenRunbook, handleCopyDomain]
  );

  const handleRowClick = useCallback((params) => handleSelectCert(params.row.id), [handleSelectCert]);
  const handleCloseDetail = useCallback(() => setSelectedCertId(null), []);

  const handleToggleColumn = useCallback(
    (field) => setColumnVisibilityModel((prev) => ({ ...prev, [field]: !prev[field] })),
    []
  );

  const handleExportCsv = useCallback(() => {
    const exported = downloadRowsAsCsv({
      rows: view.filteredRows,
      columns,
      visibilityModel: columnVisibilityModel,
    });
    if (exported === 0) return;
    showNotice('success', `Exported ${exported.toLocaleString()} row${exported === 1 ? '' : 's'} to CSV.`);
  }, [view.filteredRows, columns, columnVisibilityModel, showNotice]);



  return (
    <Shell
      activeView={activeView}
      onNavigate={setActiveView}
      alerts={alerts}
      alertsLoading={loading}
      onSelectCert={handleSelectCert}
      onShowAllAlerts={handleShowAllAlerts}
      onRefresh={refresh}
      onResetView={view.resetAllFilters}
      onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      onOpenShortcutsHelp={() => setShortcutsHelpOpen(true)}
      headerAside={
        activeView === 'repository' ? (
          <LastSyncedCard lastUpdated={lastUpdated} loading={loading} onRefresh={refresh} />
        ) : null
      }
    >
      {activeView === 'repository' && (
        <>
          {fetchError && (
            <FetchErrorBanner message={fetchError} onRetry={refresh} retryDisabled={loading} />
          )}

          <StatsBar
            summary={summary}
            loading={loading}
            selectedStatuses={view.selectedStatuses}
            onSelectStatuses={view.setSelectedStatuses}
            matchesStatusSelection={view.matchesStatusSelection}
          />

          <Box sx={{ mx: PAGE_PX, mt: 1.5 }}>
            <Box
              sx={(t) => ({
                borderRadius: '12px',
                border: '1px solid',
                borderColor: t.palette.divider,
                bgcolor: FILTER_BAR_BG,
                boxShadow: t.shadows[1],
                overflow: 'visible',
              })}
            >
              <FilterBar
                view={view}
                columnVisibilityModel={columnVisibilityModel}
                onToggleColumn={handleToggleColumn}
                onExportCsv={handleExportCsv}
                exportDisabled={loading || view.filteredRows.length === 0}
              />

              <ActiveFilterChips chips={view.activeFilterChips} onClearAll={view.resetAllFilters} />
            </Box>
          </Box>

          <Box sx={{ mx: PAGE_PX, mt: 1.5, mb: 2.5 }}>
            <Box sx={{ ...SURFACE_SX, borderRadius: '14px', overflow: 'hidden' }}>
              <CertificateGrid
                rows={view.filteredRows}
                columns={columns}
                loading={loading}
                columnVisibilityModel={columnVisibilityModel}
                onColumnVisibilityModelChange={setColumnVisibilityModel}
                selectedCertId={selectedCertId}
                onRowClick={handleRowClick}
                density={view.density}
              />
            </Box>
          </Box>
        </>
      )}

      {activeView === 'dashboard' && (
        <Suspense fallback={<ViewFallback />}>
          <DashboardView rows={rows} insights={insights} loading={loading} onSelectCert={handleSelectCert} onStatusFilter={view.setSelectedStatuses} />
        </Suspense>
      )}

      {activeView === 'metrics' && (
        <Suspense fallback={<ViewFallback />}>
          <MetricsView insights={insights} onSelectCert={handleSelectCert} />
        </Suspense>
      )}

      <CertificateDetailPanel
        cert={selectedCert}
        onClose={handleCloseDetail}
        onToggle={toggleAlerting}
        onOpenRunbook={handleOpenRunbook}
      />

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        rows={rows}
        onNavigate={setActiveView}
        onSelectCert={handleSelectCert}
        onRefresh={refresh}
        onResetView={view.resetAllFilters}
        onExportCsv={handleExportCsv}
        onOpenShortcutsHelp={() => { setCommandPaletteOpen(false); setShortcutsHelpOpen(true); }}
      />

      <KeyboardShortcutsHelp
        open={shortcutsHelpOpen}
        onClose={() => setShortcutsHelpOpen(false)}
      />

      <Snackbar
        key={notice?.key}
        open={Boolean(notice)}
        autoHideDuration={6000}
        onClose={(event, reason) => {
          if (reason === 'clickaway') return;
          clearNotice();
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={clearNotice}
          severity={notice?.severity || 'info'}
          variant="filled"
          sx={{
            borderRadius: 2,
            boxShadow: (t) => t.shadows[8],
            fontSize: 13,
            fontWeight: 500,
            alignItems: 'center'
          }}
        >
          {notice?.message}
        </Alert>
      </Snackbar>
    </Shell>
  );
}



// --- APP ENTRY POINT ---

// This app is built for laptop/desktop use - dense data grid, keyboard
// shortcuts, a command palette - and isn't designed to work as a phone or
// small-tablet experience. Rather than ship a half-supported mobile layout,
// anything narrower than this is shown a static notice instead of the app.
// 1024px is a viewport-width gate (not a device/UA check): it reliably
// excludes phones and portrait tablets while still letting a touchscreen
// laptop through, which user-agent sniffing can't do reliably. It responds
// live to resizing, so shrinking a desktop browser below this width shows
// the same notice a phone would get.
const MIN_SUPPORTED_WIDTH = 1024;

function UnsupportedViewportNotice() {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2.5,
        px: 4,
        textAlign: 'center',
        bgcolor: '#F7F8FA',
      }}
    >
      <CarePortalShieldLogo />
      <Typography
        component="h1"
        sx={{ fontFamily: FONT_BRAND, fontSize: '1.375rem', fontWeight: 700, color: PRIMARY_MAIN }}
      >
        Best viewed on a larger screen
      </Typography>
      <Typography
        sx={{ fontFamily: FONT_SANS, fontSize: '0.9375rem', color: 'text.secondary', maxWidth: 420, lineHeight: 1.6 }}
      >
        The Cert Registry is designed for laptop and desktop screens and isn't
        currently supported on phones or small tablets. Please reopen this
        page on a larger display to continue.
      </Typography>
    </Box>
  );
}

// Light mode only. The theme is built once at module scope because there is no
// longer anything that can change it at runtime.
const APP_THEME = createAppTheme();

export default function App() {
  // Re-evaluates on every resize/orientation change, not just on load - so
  // dragging a desktop window narrower crosses back into "unsupported" the
  // same way loading the page narrow would.
  const isSupportedViewport = useMediaQuery(`(min-width:${MIN_SUPPORTED_WIDTH}px)`);

  return (
    <ThemeProvider theme={APP_THEME}>
      <CssBaseline />
      {isSupportedViewport ? (
        <ErrorBoundary>
          <CertRegistryPage />
        </ErrorBoundary>
      ) : (
        <UnsupportedViewportNotice />
      )}
    </ThemeProvider>
  );
}
