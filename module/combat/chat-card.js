// ============================================================
// Parchment chat cards: combat chat output is wrapped in the
// parchment / medallion language of the player and NPC sheets
// (styles/eqrmss.css .eqrmss-card). Pure markup — styling
// lives in the stylesheet so cards stay light.
// ============================================================

/**
 * Wrap chat HTML in a themed card with a small eyebrow banner.
 * @param {string} eyebrow e.g. "Combat", "Cauterize", "Parry"
 * @param {string} inner trusted HTML built by the caller (already escaped)
 * @returns {string}
 */
export function combatCard(eyebrow, inner) {
    return `<div class="eqrmss-card"><div class="eqrmss-card-eyebrow">${eyebrow}</div><div class="eqrmss-card-body">${inner}</div></div>`;
}
