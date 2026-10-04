// ============================================================
// Arms Companion §4.13 UNUSUAL WEAPON STYLES.
//
// Using a weapon in a way it wasn't designed for. The GM sets
// the style on the weapon item:
//   - OB modification by how far the use departs from design:
//     relatively similar -10, differs but similar nature -30,
//     directly opposite -50.
//   - Optionally the critical type is converted (e.g. flat of
//     the blade delivers Krush criticals) and/or the severity
//     is shifted (e.g. slowed swings, reduced by one level).
// Switching the weapon's attack table entirely (§4.13 option
// 1) is done by editing the item's Attack Table field.
// ============================================================

export const STYLE_DEGREES = { similar: -10, differs: -30, opposite: -50 };

const SEVERITY_ORDER = ["A", "B", "C", "D", "E", "F"];
const CRIT_TYPE_CODES = new Set(["S", "P", "K", "G", "U", "T"]);

/** @returns {{degree: string|null, obMod: number, critType: string|null, severityShift: number}} */
export function unusualStyleOf(weaponItem) {
    const sys = weaponItem?.system ?? {};
    const degree = Object.hasOwn(STYLE_DEGREES, sys.styleDegree) ? sys.styleDegree : null;
    const critType = CRIT_TYPE_CODES.has(sys.styleCritType) ? sys.styleCritType : null;
    return {
        degree,
        obMod: degree ? STYLE_DEGREES[degree] : 0,
        critType,
        severityShift: Math.trunc(Number(sys.styleSeverityShift) || 0)
    };
}

/** Shift a severity letter; null when shifted below A (no critical). */
export function shiftSeverity(severity, shift) {
    const i = SEVERITY_ORDER.indexOf(severity);
    if (i < 0) return severity;
    const j = i + shift;
    if (j < 0) return null;
    return SEVERITY_ORDER[Math.min(SEVERITY_ORDER.length - 1, j)];
}
