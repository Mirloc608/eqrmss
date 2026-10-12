// ============================================================
// EQRMSS Hover Card Positioning (2026-10-12)
// ------------------------------------------------------------
// .cardtip popups are shown/hidden by pure CSS :hover, but an
// absolutely-positioned card gets clipped by the scrolling tab
// panels. This module positions the card with position:fixed
// (set in CSS), computed from the anchor's viewport rect:
// below the anchor, centered; flipped above when it would run
// off the bottom of the viewport; clamped horizontally.
// Called once per sheet render; safe to call repeatedly.
// ============================================================

const GAP = 8;
const MARGIN = 8;

function placeCard(anchor) {
    const card = anchor.querySelector(":scope > .cardtip");
    if (!card) return;
    // Measure while hidden so there is no first-paint flicker.
    card.style.visibility = "hidden";
    card.style.display = "block";
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const r = anchor.getBoundingClientRect();
    let left = r.left + (r.width / 2) - (cw / 2);
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - cw - MARGIN));
    let top = r.bottom + GAP;
    if (top + ch > window.innerHeight - MARGIN) {
        top = r.top - ch - GAP; // flip above
    }
    if (top < MARGIN) top = MARGIN;
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.style.visibility = "visible";
}

function clearCard(anchor) {
    const card = anchor.querySelector(":scope > .cardtip");
    if (!card) return;
    card.style.left = "";
    card.style.top = "";
    card.style.visibility = "";
    card.style.display = "";
}

export function activateCardtips(root) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll(".has-cardtip").forEach((anchor) => {
        anchor.addEventListener("mouseenter", () => placeCard(anchor));
        anchor.addEventListener("mouseleave", () => clearCard(anchor));
    });
}
