// ============================================================
// EQRMSS Class Progression Schema
// Foundry VTT V13 / V14 Compatible
//
// EverQuest Classes
// Levels 1-125
//
// Profession keys normalized to EQ class names.
//
// Does NOT grant abilities.
// progression-manager consumes this.
//
// ============================================================

const LEVELS =
    Array.from(
        {length:125},
        (_,i)=>i+1
    );

export const EQRMSS_SPELL_PROGRESSION =
{
    1:1,
    5:2,
    9:3,
    13:4,
    17:5,
    21:6,
    25:7,
    29:8,
    33:9,
    37:10,
    41:11,
    45:12,
    49:13,
    53:14,
    57:15,
    61:16,
    65:17,
    69:18,
    73:19,
    77:20,
    81:21,
    85:22,
    89:23,
    93:24,
    97:25,
    101:26,
    105:27,
    109:28,
    113:29,
    117:30,
    121:31,
    125:32
};

function createBaseProgression()
{

    const levels={};

    for(
        const level of LEVELS
    )
    {

        levels[level]=
        {

            level,

            hp:true,

            skillPoints:true,

            statGrowth:
                level % 5 === 0,

            abilities:[],

            spells:[],

            songs:[],

            aa:false

        };

    }

    return levels;

}

function createClass(
{
    name,

    role,

    realm="none",

    spellRanks=null,

    milestones={},

    petProgression=null,

    songs=null
})
{

    const levels =
        createBaseProgression();

    for(
        const [level,data]
        of Object.entries(milestones)
    )
    {

        levels[level]=
        {
            ...levels[level],
            ...data
        };

    }

    return {

        name,

        profession:
            name.toLowerCase()
                .replace(/\s+/g,""),

        role,

        realm,

        maxLevel:125,

        levels,

        spellRanks,

        petProgression,

        songs,

        aaUnlocks:
        [
            20,
            30,
            40,
            50,
            60
        ]

    };

}

export const EQRMSS_CLASS_PROGRESSIONS =
{

// ============================================================
// WARRIOR
// ============================================================

warrior:

createClass({

name:"Warrior",

role:"tank",

milestones:
{
1:
{
abilities:
[
"Taunt",
"Weapon Specialization"
]
},

5:
{
abilities:
[
"Defensive Stance"
]
},

20:
{
aa:true
},

60:
{
abilities:
[
"Grandmaster Warrior"
]
}

}

}),

// ============================================================
// PALADIN
// ============================================================

paladin:

createClass({

name:"Paladin",

role:"hybrid",

realm:"channeling",

spellRanks:
EQRMSS_SPELL_PROGRESSION,

milestones:
{
1:
{
abilities:
[
"Lay Hands",
"Smite"
]
},

5:
{
abilities:
[
"Turn Undead"
]
},

20:
{
aa:true
},

60:
{
abilities:
[
"Divine Champion"
]
}

}

}),

// ============================================================
// SHADOWKNIGHT
// ============================================================

shadowknight:

createClass({

name:"Shadowknight",

role:"hybrid",

realm:"channeling",

spellRanks:
EQRMSS_SPELL_PROGRESSION,

milestones:
{
1:
{
abilities:
[
"Harm Touch",
"Life Tap"
]
},

5:
{
abilities:
[
"Feign Death"
]
},

20:
{
aa:true
}

}

}),

// ============================================================
// RANGER
// ============================================================

ranger:

createClass({

name:"Ranger",

role:"hybrid",

realm:"channeling",

spellRanks:
EQRMSS_SPELL_PROGRESSION,

milestones:
{
1:
{
abilities:
[
"Tracking",
"Archery"
]
},

20:
{
aa:true
}

}

}),

// ============================================================
// MONK
// ============================================================

monk:

createClass({

name:"Monk",

role:"dps",

milestones:
{
1:
{
abilities:
[
"Unarmed Combat",
"Flurry"
]
},

10:
{
abilities:
[
"Feign Death"
]
},

20:
{
aa:true
}

}

}),

// ============================================================
// ROGUE
// ============================================================

rogue:

createClass({

name:"Rogue",

role:"dps",

milestones:
{
1:
{
abilities:
[
"Backstab",
"Stealth"
]
},

5:
{
abilities:
[
"Poison Crafting"
]
},

20:
{
aa:true
}

}

}),

// ============================================================
// BARD
// ============================================================

bard:

createClass({

name:"Bard",

role:"support",

realm:"essence",

songs:
{
1:
[
"Minor Melody"
],

5:
[
"Anthem de Arms"
],

10:
[
"Song Twisting"
],

60:
[
"Grand Chorus"
]

}

}),

// ============================================================
// CLERIC
// ============================================================

cleric:

createClass({

name:"Cleric",

role:"healer",

realm:"channeling",

spellRanks:
EQRMSS_SPELL_PROGRESSION

}),

// ============================================================
// DRUID
// ============================================================

druid:

createClass({

name:"Druid",

role:"healer",

realm:"channeling",

spellRanks:
EQRMSS_SPELL_PROGRESSION

}),

// ============================================================
// SHAMAN
// ============================================================

shaman:

createClass({

name:"Shaman",

role:"support",

realm:"channeling",

spellRanks:
EQRMSS_SPELL_PROGRESSION,

petProgression:
{
1:"spirit_wolf",

20:"greater_spirit",

40:"elder_spirit",

60:"ancient_spirit"
}

}),

// ============================================================
// WIZARD
// ============================================================

wizard:

createClass({

name:"Wizard",

role:"caster",

realm:"essence",

spellRanks:
EQRMSS_SPELL_PROGRESSION

}),

// ============================================================
// MAGICIAN
// ============================================================

magician:

createClass({

name:"Magician",

role:"caster",

realm:"essence",

spellRanks:
EQRMSS_SPELL_PROGRESSION,

petProgression:
{
1:"elemental",

20:"greater_elemental",

40:"elite_elemental",

60:"master_elemental"
}

}),

// ============================================================
// NECROMANCER
// ============================================================

necromancer:

createClass({

name:"Necromancer",

role:"caster",

realm:"essence",

spellRanks:
EQRMSS_SPELL_PROGRESSION,

petProgression:
{
1:"skeleton",

20:"greater_undead",

40:"elite_undead",

60:"master_undead"
}

}),

// ============================================================
// ENCHANTER
// ============================================================

enchanter:

createClass({

name:"Enchanter",

role:"caster",

realm:"mentalism",

spellRanks:
EQRMSS_SPELL_PROGRESSION,

petProgression:
{
1:"charm",

40:"greater_charm",

60:"master_charm"
}

}),

// ============================================================
// BEASTLORD
// ============================================================

beastlord:

createClass({

name:"Beastlord",

role:"hybrid",

realm:"channeling",

spellRanks:
EQRMSS_SPELL_PROGRESSION,

petProgression:
{
1:"warder",

20:"greater_warder",

40:"elder_warder",

60:"ancient_warder"
}

}),

// ============================================================
// BERSERKER
// ============================================================

berserker:

createClass({

name:"Berserker",

role:"dps",

milestones:
{
1:
{
abilities:
[
"Frenzy",
"Dual Wield"
]
},

10:
{
abilities:
[
"Decapitation"
]
},

20:
{
aa:true
},

60:
{
abilities:
[
"Master Berserker"
]
}

}

})

};

export function getClassProgression(
profession
)
{

    return EQRMSS_CLASS_PROGRESSIONS[profession]
        ??
        null;

}

export function getLevelProgression(
profession,
level
)
{

    return EQRMSS_CLASS_PROGRESSIONS[profession]
        ?.levels
        ?. [level]
        ??
        null;

}

export default EQRMSS_CLASS_PROGRESSIONS;