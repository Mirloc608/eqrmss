"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.rmssStatBonus = rmssStatBonus;

/**
 * Full RMSS Stat Bonus Table (Rolemaster Standard System)
 */
function rmssStatBonus(value) {
  if (value <= 1) return -25;
  if (value <= 20) return -20;
  if (value <= 40) return -10;
  if (value <= 60) return 0;
  if (value <= 75) return +10;
  if (value <= 90) return +15;
  if (value <= 95) return +20;
  if (value <= 100) return +25;
  return +30;
}