// ============================================================
// EQRMSS Sheet Registration
// Foundry VTT V13 / V14 Compatible (ApplicationV2)
// ============================================================

import EQRMSSPlayerSheet from "../sheets/actors/eqrmss_player_sheet.js";
import EQRMSSItemSheet from "../sheets/items/eqrmss_item_sheet.js";
import EQRMSSArmorSheet from "../sheets/items/eqrmss_armor_sheet.js";
import EQRMSSTransportSheet from "../sheets/items/eqrmss_transport_sheet.js";
import EQRMSSWeaponSheet from "../sheets/items/eqrmss_weapon_sheet.js";
import EQRMSSHerbOrPoisonSheet from "../sheets/items/eqrmss_herb_or_poison_sheet.js";
import EQRMSSSpellSheet from "../sheets/spells/eqrmss_spell_sheet.js";
import EQRMSSSkillCategorySheet from "../sheets/skills/eqrmss_skill_category_sheet.js";
import EQRMSSSkillSheet from "../sheets/skills/eqrmss_skill_sheet.js";

export function registerEQRMSSSheets() {
    console.log("EQRMSS | Registering sheets");

    const DocumentSheetConfig = foundry.applications.apps.DocumentSheetConfig;

    // --- Actor Sheets ---
    DocumentSheetConfig.registerSheet(Actor, "eqrmss", EQRMSSPlayerSheet, {
        types: ["character", "npc"],
        label: "eqrmss.entity_sheet.player",
        makeDefault: true
    });

    // --- Item Sheets ---
    DocumentSheetConfig.registerSheet(Item, "eqrmss", EQRMSSItemSheet, {
        types: ["item"],
        label: "eqrmss.entity_sheet.item",
        makeDefault: true
    });

    DocumentSheetConfig.registerSheet(Item, "eqrmss", EQRMSSArmorSheet, {
        types: ["armor"],
        label: "eqrmss.entity_sheet.armor",
        makeDefault: true
    });

    DocumentSheetConfig.registerSheet(Item, "eqrmss", EQRMSSTransportSheet, {
        types: ["transport"],
        label: "eqrmss.entity_sheet.transport",
        makeDefault: true
    });

    DocumentSheetConfig.registerSheet(Item, "eqrmss", EQRMSSWeaponSheet, {
        types: ["weapon"],
        label: "eqrmss.entity_sheet.weapon",
        makeDefault: true
    });

    DocumentSheetConfig.registerSheet(Item, "eqrmss", EQRMSSHerbOrPoisonSheet, {
        types: ["herb_or_poison"],
        label: "eqrmss.entity_sheet.herb_or_poison",
        makeDefault: true
    });

    DocumentSheetConfig.registerSheet(Item, "eqrmss", EQRMSSSpellSheet, {
        types: ["spell"],
        label: "eqrmss.entity_sheet.spell",
        makeDefault: true
    });

    DocumentSheetConfig.registerSheet(Item, "eqrmss", EQRMSSSkillCategorySheet, {
        types: ["skill_category"],
        label: "eqrmss.entity_sheet.skill_category",
        makeDefault: true
    });

    DocumentSheetConfig.registerSheet(Item, "eqrmss", EQRMSSSkillSheet, {
        types: ["skill"],
        label: "eqrmss.entity_sheet.skill",
        makeDefault: true
    });

    console.info("EQRMSS | Sheets registered successfully");
}