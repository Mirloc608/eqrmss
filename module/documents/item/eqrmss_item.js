// ============================================================
// EQRMSS Base Item Document
//
// EverQuest - Rolemaster Standard System
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

export class EQRMSSItem extends Item {

    prepareData() {

        super.prepareData();

        this._ensureItemData();

    }

    prepareDerivedData() {

        super.prepareDerivedData();

        this._prepareQuality();

        this._prepareWeight();

        this._prepareEffects();

        this._prepareRequirements();

        this._prepareDurability();

        this._prepareBonuses();

        this._prepareSkillModifiers();

    }

    // ============================================================
    // DATA NORMALIZATION
    // ============================================================

    _ensureItemData() {

        this.system ??= {};

        this.system.item ??= {

            category: null,

            rarity: "common",

            quality: "normal",

            weight: 0,

            value: 0,

            stackable: false,

            quantity: 1

        };

        this.system.requirements ??= {

            level:0,

            race:[],

            class:[],

            profession:[]

        };

        this.system.effects ??= [];

        this.system.durability ??= {

            current:100,

            maximum:100

        };

        this.system.bonuses ??= {

            stats:{},

            resistances:{},

            skills:{}

        };

        this.system.skillModifiers ??= {};

        this.system.equipped ??= false;

        this.system.slot ??= null;

        this.system.category ??=
            this.system.item.category;

    }

    // ============================================================
    // QUALITY
    // ============================================================

    _prepareQuality() {

        this.system.quality =
            this.system.item?.quality ??
            "normal";

    }

    getQuality() {

        return this.system.quality;

    }

    async setQuality(value) {

        return this.update({

            "system.item.quality":value,

            "system.quality":value

        });

    }

    // ============================================================
    // WEIGHT
    // ============================================================

    _prepareWeight() {

        this.system.weight =
            Number(
                this.system.item?.weight ?? 0
            );

    }

    getWeight() {

        return Number(
            this.system.weight ?? 0
        );

    }

    // ============================================================
    // EFFECTS
    // ============================================================

    _prepareEffects() {

        if(!Array.isArray(this.system.effects))
            this.system.effects=[];

    }

    addEffect(effect) {

        if(!effect)
            return;

        const effects =
            foundry.utils.deepClone(
                this.system.effects
            );

        effects.push(effect);

        return this.update({

            "system.effects":effects

        });

    }

    removeEffect(id) {

        const effects =
            this.system.effects.filter(
                e=>e.id!==id
            );

        return this.update({

            "system.effects":effects

        });

    }

    hasEffect(id) {

        return this.system.effects.some(
            e=>e.id===id
        );

    }

    // ============================================================
    // REQUIREMENTS
    // ============================================================

    _prepareRequirements() {

        this.system.requirements ??=
        {

            level:0,

            race:[],

            class:[],

            profession:[]

        };

    }

    canEquip(actor) {

        if(!actor)
            return false;

        const req =
            this.system.requirements;

        const actorData =
            actor.system;

        if(
            Number(actorData.level ?? 0)
            <
            Number(req.level ?? 0)
        )
            return false;

        if(
            req.race?.length &&
            !req.race.includes(
                actorData.race
            )
        )
            return false;

        if(
            req.class?.length
        ) {

            const classes =
                actorData.classes ?? [];

            if(
                !classes.some(
                    c =>
                    req.class.includes(c)
                )
            )
                return false;

        }

        if(
            req.profession?.length
        ) {

            const professions =
                actorData.professions ?? [];

            if(
                !professions.some(
                    p =>
                    req.profession.includes(p)
                )
            )
                return false;

        }

        return true;

    }

    getEquipWarnings(actor) {

        const warnings=[];

        if(!actor)
            return [
                "No actor supplied"
            ];

        const req =
            this.system.requirements;

        if(
            actor.system.level <
            req.level
        )
            warnings.push(
                `Requires level ${req.level}`
            );

        return warnings;

    }

    // ============================================================
    // DURABILITY
    // ============================================================

    _prepareDurability() {

        // Ensure the durability object exists and has numeric current/maximum
        this.system.durability ??= { current: 100, maximum: 100 };

        // If properties are missing or undefined, initialize safely
        if (typeof this.system.durability.current === "undefined")
            this.system.durability.current = 100;

        if (typeof this.system.durability.maximum === "undefined")
            this.system.durability.maximum = 100;

        // Coerce to numbers to avoid runtime errors elsewhere
        this.system.durability.current = Number(this.system.durability.current) || 0;
        this.system.durability.maximum = Number(this.system.durability.maximum) || 0;

    }

    async damageDurability(amount) {

        const value =
            Math.max(
                0,
                this.system.durability.current - amount
            );

        return this.update({

            "system.durability.current":value

        });

    }

    async repair(amount) {

        const value =
            Math.min(

                this.system.durability.maximum,

                this.system.durability.current + amount

            );

        return this.update({

            "system.durability.current":value

        });

    }

    isBroken() {

        return (
            this.system.durability.current <= 0
        );

    }

    // ============================================================
    // BONUSES
    // ============================================================

    _prepareBonuses() {

        this.system.bonuses ??=
        {

            stats:{},

            resistances:{},

            skills:{}

        };

    }

    getStatBonus(stat) {

        return Number(
            this.system.bonuses
                ?.stats?.[stat] ?? 0
        );

    }

    // ============================================================
    // SKILL MODIFIERS
    // ============================================================

    _prepareSkillModifiers() {

        this.system.skillModifiers ??=
            {};

    }

    getSkillModifier(skill) {

        return Number(

            this.system.skillModifiers?.[skill]
            ??
            0

        );

    }

    // ============================================================
    // STACKING
    // ============================================================

    getQuantity() {

        return Number(
            this.system.item?.quantity ?? 1
        );

    }

    isStackable() {

        return (
            this.system.item?.stackable === true
        );

    }

    // ============================================================
    // EQUIPMENT EVENTS
    // ============================================================

    onEquip(actor) {

        this.update({

            "system.equipped":true

        });

        Hooks.callAll(
            "eqrmssEquipItem",
            actor,
            this
        );

    }

    onUnequip(actor) {

        this.update({

            "system.equipped":false

        });

        Hooks.callAll(
            "eqrmssUnequipItem",
            actor,
            this
        );

    }

    // ============================================================
    // DISPLAY
    // ============================================================

    getDisplayName() {

        return this.name;

    }

    getItemSummary() {

        return {

            id:this.id,

            name:this.name,

            type:this.type,

            weight:this.getWeight(),

            quality:this.getQuality(),

            category:this.system.category

        };

    }

}