/**
 * EQRMSS Spellcasting Engine
 * Handles spell casting, resist rolls, mana consumption, and feedback.
 *
 * Location:
 * systems/eqrmss/module/utils/spells/spellcasting-engine.js
 */

export class EQRMSSSpellcastingEngine {

  /**
   * Cast a spell.
   * @param {Actor} actor - The caster
   * @param {Item} spell - The spell item
   */
  static async cast(actor, spell) {
    if (!actor || !spell) return;

    const system = spell.system ?? {};
    const manaCost = system.mana ?? 0;
    const castTime = system.castTime ?? 0;
    const resistType = system.resist ?? "magic";

    const actorMana = actor.system.mana?.current ?? 0;
    const actorResists = actor.system.resists ?? {};
    const resistValue = actorResists[resistType] ?? 0;

    // Not enough mana
    if (actorMana < manaCost) {
      ui.notifications.error(`${actor.name} does not have enough mana to cast ${spell.name}.`);
      return { failed: true, reason: "mana" };
    }

    // Resist roll
    const roll = new Roll("1d100").roll({ async: false }).total;
    const resisted = roll < resistValue;

    if (resisted) {
      ui.notifications.warn(`${spell.name} was resisted!`);
      return { failed: true, reason: "resisted", roll, resistValue };
    }

    // Deduct mana
    await actor.update({
      "system.mana.current": actorMana - manaCost
    });

    // Casting feedback
    ui.notifications.info(`${actor.name} casts ${spell.name}!`);

    return {
      failed: false,
      resisted: false,
      roll,
      resistValue,
      manaCost,
      castTime
    };
  }
}
