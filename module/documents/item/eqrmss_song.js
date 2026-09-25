// ============================================================
// EQRMSS Song Item
//
// EverQuest - Rolemaster Standard System
//
// Bard Song specialization.
//
// Supports:
//  - Bard performance
//  - Song twisting
//  - Pulse effects
//  - Instrument requirements
//  - Song groups
//  - Duration
//  - Stacking rules
//  - Effects
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

import {

    EQRMSSItem

}
from "./eqrmss_item.js";

export class EQRMSSSong extends EQRMSSItem
{

    // ========================================================
    // DATA PREPARATION
    // ========================================================

    prepareDerivedData()
    {

        super.prepareDerivedData();

        this._ensureSongData();

        this._preparePulse();

        this._prepareEffects();

    }

    // ========================================================
    // DEFAULT DATA
    // ========================================================

    _ensureSongData()
    {

        this.system.song ??=
        {

            level:1,

            category:"general",

            songGroup:"general",

            bardLine:"",

            performanceSkill:
                "bard_performance",

            instrument:null,

            instrumentRequired:false,

            pulse:6,

            duration:

            {

                value:0,

                unit:"rounds"

            },

            target:"group",

            range:0,

            manaCost:0,

            songType:"beneficial",

            twistPriority:0,

            stackGroup:null,

            effects:[]

        };

    }

    // ========================================================
    // BASIC INFORMATION
    // ========================================================

    getLevel()
    {

        return (

            this.system.song.level
            ??
            1

        );

    }

    getCategory()
    {

        return (

            this.system.song.category
            ??
            "general"

        );

    }

    getSongGroup()
    {

        return (

            this.system.song.songGroup
            ??
            "general"

        );

    }

    getBardLine()
    {

        return (

            this.system.song.bardLine
            ??
            ""

        );

    }

    // ========================================================
    // PERFORMANCE
    // ========================================================

    getPerformanceSkill()
    {

        return (

            this.system.song.performanceSkill
            ??
            "bard_performance"

        );

    }

    getTwistPriority()
    {

        return (

            this.system.song.twistPriority
            ??
            0

        );

    }

    // ========================================================
    // INSTRUMENT REQUIREMENTS
    // ========================================================

    requiresInstrument()
    {

        return (

            this.system.song.instrumentRequired
            ===
            true

        );

    }

    getRequiredInstrument()
    {

        return (

            this.system.song.instrument
            ??
            null

        );

    }

    canPlayWithInstrument(
        instrument
    )
    {

        if(
            !this.requiresInstrument()
        )
        {
            return true;
        }

        if(
            !instrument
        )
        {
            return false;
        }

        return (

            instrument.getInstrumentType()
            ===
            this.getRequiredInstrument()

        );

    }

    // ========================================================
    // PULSE SYSTEM
    // ========================================================

    _preparePulse()
    {

        this.system.song.pulse ??=
            6;

    }

    getPulse()
    {

        return (

            this.system.song.pulse
            ??
            6

        );

    }

    getDuration()
    {

        return (

            this.system.song.duration
            ??
            {}

        );

    }

    // ========================================================
    // TARGETING
    // ========================================================

    getTargetType()
    {

        return (

            this.system.song.target
            ??
            "group"

        );

    }

    getRange()
    {

        return (

            this.system.song.range
            ??
            0

        );

    }

    // ========================================================
    // STACKING
    // ========================================================

    getStackGroup()
    {

        return (

            this.system.song.stackGroup
            ??
            this.getSongGroup()

        );

    }

    canStackWith(
        song
    )
    {

        if(
            !song
        )
        {
            return true;
        }

        return (

            this.getStackGroup()
            !==
            song.getStackGroup()

        );

    }

    // ========================================================
    // EFFECTS
    // ========================================================

    _prepareEffects()
    {

        this.system.song.effects ??=
            [];

    }

    getEffects()
    {

        return (

            this.system.song.effects
            ??
            []

        );

    }

    addEffect(
        effect
    )
    {

        this.system.song.effects.push(
            effect
        );

    }

    // ========================================================
    // ENGINE DATA
    // ========================================================

    getSongData()
    {

        return {

            id:
                this.id,

            name:
                this.name,

            level:
                this.getLevel(),

            category:
                this.getCategory(),

            songGroup:
                this.getSongGroup(),

            bardLine:
                this.getBardLine(),

            pulse:
                this.getPulse(),

            target:
                this.getTargetType(),

            range:
                this.getRange(),

            instrument:
                this.getRequiredInstrument(),

            twistPriority:
                this.getTwistPriority(),

            stackGroup:
                this.getStackGroup(),

            effects:
                this.getEffects()

        };

    }

    // ========================================================
    // CAST VALIDATION
    // ========================================================

    canPlay(
        actor
    )
    {

        if(
            !actor
        )
        {
            return false;
        }

        return true;

    }

    // ========================================================
    // DISPLAY
    // ========================================================

    getSongSummary()
    {

        return {

            id:
                this.id,

            name:
                this.name,

            level:
                this.getLevel(),

            group:
                this.getSongGroup(),

            pulse:
                this.getPulse()

        };

    }

}