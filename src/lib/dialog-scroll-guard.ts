'use client'

import type * as React from 'react'

/**
 * The "white dialog" killer.
 *
 * Root cause of the recurring recruiter report ("post krne samay logo dalte
 * hi page white ho jata hai"): a DialogContent styled `overflow-hidden` is
 * STILL a scroll container for Chrome's focus-scroll. When the OS file
 * picker opens from the logo <input type="file">, Chrome scrolls every
 * scrollable ancestor to reveal that input — including the outer
 * overflow-hidden dialog shell, pushing it ~1000px into the EMPTY region
 * below the form. The recruiter then stares at a blank white box: nothing
 * crashed, the DOM is intact, the dialog is simply scrolled past its own
 * content. Reloading/reopening "fixes" it, losing work confidence.
 *
 * Fix (two layers, applied to every non-scrolling dialog shell):
 *  1. Tailwind `overflow-clip` instead of `overflow-hidden` — a clipped
 *     element is NOT a scroll container, so Chrome can never programmatic-
 *     scroll it (supported in all evergreen browsers).
 *  2. This onScroll clamp as belt-and-braces for older engines: the moment
 *     anything tries to scroll the shell, it snaps back to 0,0 before a
 *     single blank frame can paint.
 *
 * Attach ONLY to dialog shells whose children scroll in their own inner
 * container (the inner overflow-y-auto scroller must stay free to scroll).
 */
export function clampDialogShellScroll(e: React.UIEvent<HTMLElement>): void {
  const el = e.currentTarget
  if (el.scrollTop !== 0) el.scrollTop = 0
  if (el.scrollLeft !== 0) el.scrollLeft = 0
}
