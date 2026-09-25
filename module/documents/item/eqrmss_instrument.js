// ============================================================
// EQRMSS Instrument Item
//
// EverQuest - Rolemaster Standard System
//
// Bard instrument specialization.
//
// Supports:
//  - Bard performance
//  - Song amplification
//  - Instrument categories
//  - Song restrictions
//  - Pulse modifiers
//  - Range modifiers
//  - Mana efficiency
//  - Magical instruments
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

import {

    EQRMSSItem

}
from "./eqrmss_item.js";

export class EQRMSSInstrument extends EQRMSSItem
{

    // ========================================================
    // PREPARE DATA
    // ========================================================

    prepareDerivedData()
    {

        super.prepareDerivedData();

        this._ensureInstrumentData();

        this._prepareBonuses();

        this._prepareRestrictions();

    }

    // ========================================================
    // DEFAULT DATA
    // ========================================================

    _ensureInstrumentData()
    {

        this.system.instrument ??=
        {

            type:"string",

            skill:"instrument_use",

            instrumentSkill:null,

            songCategories:
            [],

            amplification:0,

            rangeBonus:0,

            pulseBonus:0,

            durationBonus:0,

            manaEfficiency:0,

            magical:false,

            enchantmentBonus:0,

            effects:[]

        };

    }

    // ========================================================
    // INSTRUMENT TYPE
    // ========================================================

    getInstrumentType()
    {

        return (

            this.system.instrument.type
            ??
            "string"

        );

    }

    setInstrumentType(
        type
    )
    {

        this.system.instrument.type =
            type;

    }

    // ========================================================
    // INSTRUMENT SKILL
    // ========================================================

    getInstrumentSkill()
    {

        return (

            this.system.instrument.instrumentSkill
            ??
            this.system.instrument.skill

        );

    }

    setInstrumentSkill(
        skill
    )
    {

        this.system.instrument.instrumentSkill =
            skill;

    }

    // ========================================================
    // SONG COMPATIBILITY
    // ========================================================

    getSongCategories()
    {

        return (

            this.system.instrument.songCategories
            ??
            []

        );

    }

    supportsSongCategory(
        category
    )
    {

        return (

            this.getSongCategories()
                .includes(
                    category
                )

        );

    }

    // ========================================================
    // BARD MODIFIERS
    // ========================================================

    _prepareBonuses()
    {

        this.system.instrument.amplification ??=
            0;

        this.system.instrument.rangeBonus ??=
            0;

        this.system.instrument.pulseBonus ??=
            0;

        this.system.instrument.durationBonus ??=
            0;

        this.system.instrument.manaEfficiency ??=
            0;

    }

    getAmplification()
    {

        return (

            this.system.instrument.amplification
            ??
            0

        );

    }

    getRangeBonus()
    {

        return (

            this.system.instrument.rangeBonus
            ??
            0

        );

    }

    getPulseBonus()
    {

        return (

            this.system.instrument.pulseBonus
            ??
            0

        );

    }

    getDurationBonus()
    {

        return (

            this.system.instrument.durationBonus
            ??
            0

        );

    }

    getManaEfficiency()
    {

        return (

            this.system.instrument.manaEfficiency
            ??
            0

        );

    }

    // ========================================================
    // MAGIC
    // ========================================================

    isMagical()
    {

        return (

            this.system.instrument.magical
            ===
            true

        );

    }

    getEnchantmentBonus()
    {

        return (

            this.system.instrument.enchantmentBonus
            ??
            0

        );

    }

    // ========================================================
    // RESTRICTIONS
    // ========================================================

    _prepareRestrictions()
    {

        this.system.instrument.songCategories ??=
            [];

    }

    canPlaySong(
        song
    )
    {

        if(
            !song
        )
        {
            return false;
        }

        const category =
            song.system.song.category;

        if(
            !this.getSongCategories().length
        )
        {
            return true;
        }

        return this.supportsSongCategory(
            category
        );

    }

    // ========================================================
    // SONG MODIFIER PACKAGE
    // ========================================================

    getPerformanceModifiers()
    {

        return {

            instrument:
                this.id,

            name:
                this.name,

            type:
                this.getInstrumentType(),

            amplification:
                this.getAmplification(),

            range:
                this.getRangeBonus(),

            pulse:
                this.getPulseBonus(),

            duration:
                this.getDurationBonus(),

            manaEfficiency:
                this.getManaEfficiency()

        };

    }

    // ========================================================
    // EQUIPMENT EFFECTS
    // ========================================================

    addInstrumentEffect(
        effect
    )
    {

        this.system.instrument.effects ??=
            [];

        this.system.instrument.effects.push(
            effect
        );

    }

    getInstrumentEffects()
    {

        return (

            this.system.instrument.effects
            ??
            []

        );

    }

    // ========================================================
    // COMMON INSTRUMENT HELPERS
    // ========================================================

    isString()
    {

        return this.getInstrumentType()
            ===
            "string";

    }

    isPercussion()
    {

        return this.getInstrumentType()
            ===
            "percussion";

    }

    isWind()
    {

        return this.getInstrumentType()
            ===
            "wind";

    }

    isBrass()
    {

        return this.getInstrumentType()
            ===
            "brass";

    }

    // ========================================================
    // DISPLAY
    // ========================================================

    getInstrumentSummary()
    {

        return {

            id:
                this.id,

            name:
                this.name,

            type:
                this.getInstrumentType(),

            amplification:
                this.getAmplification(),

            categories:
                this.getSongCategories()

        };

    }

    // ========================================================
    // EQUIP VALIDATION
    // ========================================================

    canEquip(
        actor
    )
    {

        if(
            !super.canEquip(actor)
        )
        {
            return false;
        }

        return true;

    }

}