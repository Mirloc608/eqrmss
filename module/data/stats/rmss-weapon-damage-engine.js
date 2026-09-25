export class RMSSWeaponDamageEngine {

  convertEQWeapon(eqWeapon) {
    return {
      baseDamage: eqWeapon.damage ?? 5,
      scale: eqWeapon.delay ? Math.max(1, eqWeapon.delay / 10) : 1,
      critRange: eqWeapon.critRange ?? 95,
      armorPiercing: eqWeapon.armorPiercing ?? 0
    };
  }

  computeDamage(attackMargin, weaponProfile) {
    const base = weaponProfile.baseDamage;
    const scale = weaponProfile.scale;
    return Math.max(1, Math.round(base + attackMargin * scale));
  }

  applyArmor(damage, armorValue, armorPiercing = 0) {
    return Math.max(0, damage - Math.max(0, armorValue - armorPiercing));
  }

  checkCritical(roll, weaponProfile) {
    return roll >= weaponProfile.critRange;
  }

  resolve(attackMargin, weaponProfile, armorValue, critRoll) {
    const raw = this.computeDamage(attackMargin, weaponProfile);
    const mitigated = this.applyArmor(raw, armorValue, weaponProfile.armorPiercing);
    const critical = this.checkCritical(critRoll, weaponProfile);

    return {
      damage: mitigated,
      critical,
      breakdown: { raw, mitigated, critRoll }
    };
  }
}
