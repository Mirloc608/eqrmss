// ============================================================================
// RMSS Difficulty Tiers (user-supplied 2026-10-28)
// ============================================================================
//
// The standard 9-tier difficulty progression across the top columns of
// the RMSS maneuver tables (Moving Maneuver T-4.1, Static Maneuver
// T-4.3). General skill rolls use these tiers as a modifier on the roll:
// d100 + skill bonus + tier modifier, read against the maneuver table
// (100+ = success). Tradeskills do NOT use tiers — they roll a flat
// d100 against a scaled trivial with critical results at 01-05 / 96-100
// (see module/tradeskills/tradeskill-engine.js).
//
// The GM sets the difficulty when a roll is made (default Medium).
// ============================================================================

export const DIFFICULTY_TIERS = [
    { id: "routine",        name: "Routine",        modifier: 30 },
    { id: "easy",           name: "Easy",           modifier: 20 },
    { id: "light",          name: "Light",          modifier: 10 },
    { id: "medium",         name: "Medium",         modifier: 0 },
    { id: "hard",           name: "Hard",           modifier: -10 },
    { id: "very-hard",      name: "Very Hard",      modifier: -20 },
    { id: "extremely-hard", name: "Extremely Hard", modifier: -30 },
    { id: "sheer-folly",    name: "Sheer Folly",    modifier: -50 },
    { id: "absurd",         name: "Absurd",         modifier: -70 }
];

export const DEFAULT_DIFFICULTY_ID = "medium";

export function difficultyTier(id) {
    return DIFFICULTY_TIERS.find(t => t.id === id)
        ?? DIFFICULTY_TIERS.find(t => t.id === DEFAULT_DIFFICULTY_ID);
}

export function formatModifier(modifier) {
    const m = Number(modifier) || 0;
    return m >= 0 ? `+${m}` : `${m}`;
}

// Maneuver outcome bands for a modified total: 100+ succeeds on the
// maneuver tables; 75-99 is the partial-success band; below that fails.
// The GM reads narrative specifics off the table itself.
export function maneuverOutcome(total) {
    const t = Number(total) || 0;
    if (t >= 100) return { id: "success", label: "Success" };
    if (t >= 75) return { id: "partial", label: "Partial success" };
    return { id: "failure", label: "Failure" };
}

// Ask for the roll difficulty (DialogV2, following the cauterize idiom).
// Resolves to the chosen tier, or null when the prompt is cancelled.
// Falls back to Medium when no dialog API is available.
export async function promptDifficultyTier({ title = "Roll Difficulty", defaultId = DEFAULT_DIFFICULTY_ID } = {}) {
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    const promptFn = DialogV2?.input ?? DialogV2?.prompt;
    if (!promptFn) return difficultyTier(defaultId);
    const options = DIFFICULTY_TIERS.map(t =>
        `<option value="${t.id}"${t.id === defaultId ? " selected" : ""}>${t.name} (${formatModifier(t.modifier)})</option>`
    ).join("");
    try {
        const result = await promptFn.call(DialogV2, {
            window: { title },
            content: `
                <div class="form-group">
                    <label>Difficulty</label>
                    <select name="difficulty">${options}</select>
                </div>
                <p class="hint">The GM sets the difficulty. The roll total is d100 + skill bonus + difficulty modifier; 100+ succeeds.</p>`,
            ok: {
                label: "Roll",
                callback: (event, button, dialog) => {
                    const form = dialog?.element ?? button?.form;
                    return form?.querySelector?.('select[name="difficulty"]')?.value ?? defaultId;
                }
            }
        });
        if (result == null) return null;
        return difficultyTier(String(result));
    } catch (e) {
        console.warn("EQRMSS | Difficulty prompt failed.", e);
        return difficultyTier(defaultId);
    }
}
