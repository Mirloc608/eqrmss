// ============================================================
// EQRMSS — Character Creation Tables (T-1.2 & T-1.3)
// ============================================================

export function getStatValueFromPoints(points) {
  if (points <= 90) return points;
  
  const t12Map = {
    91: 91, 92: 92, 93: 93, 94: 94, 95: 95,
    96: 96, 97: 97, 98: 98, 99: 99, 100: 100, 
    101: 101
  };

  return t12Map[points] ?? Math.min(101, points);
}

export async function calculatePotentialStat(tempVal, useFixedOption = false) {
  let potentialVal = tempVal;

  if (useFixedOption) {
    let fixedMod = 0;
    if (tempInRange(tempVal, 1, 24)) fixedMod = 45;
    else if (tempInRange(tempVal, 25, 34)) fixedMod = 39;
    else if (tempInRange(tempVal, 35, 44)) fixedMod = 34;
    else if (tempInRange(tempVal, 45, 54)) fixedMod = 28;
    else if (tempInRange(tempVal, 55, 64)) fixedMod = 22;
    else if (tempInRange(tempVal, 65, 74)) fixedMod = 17;
    else if (tempInRange(tempVal, 75, 84)) fixedMod = 11;
    else if (tempInRange(tempVal, 85, 94)) fixedMod = 6;
    else if (tempInRange(tempVal, 95, 101)) fixedMod = 3;

    potentialVal = tempVal + fixedMod;
  } else {
    let bonusRoll = 0;
    if (tempInRange(tempVal, 1, 24)) bonusRoll = await rollDiceExpression("50 + 5d10");
    else if (tempInRange(tempVal, 25, 34)) bonusRoll = await rollDiceExpression("40 + 5d10");
    else if (tempInRange(tempVal, 35, 44)) bonusRoll = await rollDiceExpression("40 + 4d10");
    else if (tempInRange(tempVal, 45, 54)) bonusRoll = await rollDiceExpression("50 + 5d10");
    else if (tempInRange(tempVal, 55, 64)) bonusRoll = await rollDiceExpression("60 + 4d10");
    else if (tempInRange(tempVal, 65, 74)) bonusRoll = await rollDiceExpression("70 + 3d10");
    else if (tempInRange(tempVal, 75, 84)) bonusRoll = await rollDiceExpression("80 + 2d10");
    else if (tempInRange(tempVal, 85, 94)) bonusRoll = await rollDiceExpression("90 + 1d10");
    else if (tempInRange(tempVal, 95, 101)) bonusRoll = await rollDiceExpression("95 + 1d5");

    potentialVal = tempVal + bonusRoll;
  }

  return Math.max(tempVal, potentialVal);
}

function tempInRange(val, min, max) {
  return val >= min && val <= max;
}

async function rollDiceExpression(expression) {
  const roll = new Roll(expression);
  await roll.evaluate();
  return roll.total;
}