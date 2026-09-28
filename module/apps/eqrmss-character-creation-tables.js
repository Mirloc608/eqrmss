// ============================================================
// EQRMSS — Character Creation Tables (T-1.2 & T-1.3)
// ============================================================

import { rmssPotentialStat } from "../data/stats/rmss-potential-stat.js";

export function getStatValueFromPoints(points) {
  if (points <= 90) return points;
  
  const t12Map = {
    91: 91, 92: 92, 93: 93, 94: 94, 95: 95,
    96: 96, 97: 97, 98: 98, 99: 99, 100: 100, 
    101: 101
  };

  return t12Map[points] ?? Math.min(101, points);
}

/**
 * Potential stat for a temporary stat value.
 * Book rule (§15.1.1): roll d100, cross-index Table 15.1.1 against the
 * temporary stat. "—" cells yield the temporary stat itself.
 */
export async function calculatePotentialStat(tempVal) {
  const roll = await rollDiceExpression("1d100");
  const potentialVal = rmssPotentialStat(tempVal, roll);
  return Math.max(tempVal, potentialVal);
}

async function rollDiceExpression(expression) {
  const roll = new Roll(expression);
  await roll.evaluate();
  return roll.total;
}