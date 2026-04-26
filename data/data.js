// ============================================================
//  A&A Global 1940 — Game Tracker  |  data.js
//  All static game data: nations, territories, units
// ============================================================

// ── Turn order ───────────────────────────────────────────────
const TURN_ORDER = [
  'germany','soviet','japan','usa','china','uk_europe','uk_pacific','italy','anzac','france'
];

// ── Nations ──────────────────────────────────────────────────
const NATIONS = {
  germany:    { id:'germany',    name:'Germany',            shortName:'GER', abbr:'DE',  icon:'Nations_Buttons/germany-symbol.jpg',    side:'axis',   color:'#18181b', accent:'#71717a', flag:'🇩🇪', startTreasury:30, startIncome:30, mainCapital:'Germany (Berlin)' },
  italy:      { id:'italy',      name:'Italy',              shortName:'ITA', abbr:'IT',  icon:'Nations_Buttons/italy-symbol.jpg',      side:'axis',   color:'#78350f', accent:'#d97706', flag:'🇮🇹', startTreasury:10, startIncome:10, mainCapital:'Southern Italy (Rome)' },
  japan:      { id:'japan',      name:'Japan',              shortName:'JAP', abbr:'JP',  icon:'Nations_Buttons/japan-symbol-axis-allies-sticker.jpg', side:'axis',   color:'#9a3412', accent:'#fb923c', flag:'🇯🇵', startTreasury:26, startIncome:26, mainCapital:'Japan (Tokyo)' },
  soviet:     { id:'soviet',     name:'Soviet Union',       shortName:'SOV', abbr:'SU',  icon:'Nations_Buttons/soviet-union-symbol.jpg',    side:'allies', color:'#7f1d1d', accent:'#f87171', flag:'🇷🇺', startTreasury:37, startIncome:37, mainCapital:'Russia (Moscow)' },
  usa:        { id:'usa',        name:'United States',      shortName:'USA', abbr:'US',  icon:'Nations_Buttons/usa-symbol.jpg',          side:'allies', color:'#14532d', accent:'#4ade80', flag:'🇺🇸', startTreasury:52, startIncome:52, mainCapital:'Eastern United States (Washington)' },
  uk_europe:  { id:'uk_europe',  name:'United Kingdom',     shortName:'UKE', abbr:'UK',  icon:'Nations_Buttons/uk-union-jack-symbol.jpg',side:'allies', color:'#713f12', accent:'#fbbf24', flag:'🇬🇧', startTreasury:28, startIncome:28, mainCapital:'United Kingdom (London)' },
  uk_pacific: { id:'uk_pacific', name:'UK Pacific',         shortName:'UKP', abbr:'UKP', icon:'Nations_Buttons/uk-symbol.jpg',         side:'allies', color:'#713f12', accent:'#fbbf24', flag:'🏴', startTreasury:17, startIncome:17, mainCapital:'India (Calcutta)' },
  anzac:      { id:'anzac',      name:'ANZAC',              shortName:'ANZ', abbr:'ANZ', icon:'Nations_Buttons/anzac-symbol.jpg',      side:'allies', color:'#374151', accent:'#9ca3af', flag:'🇦🇺', startTreasury:10, startIncome:10, mainCapital:'New South Wales (Sydney)' },
  china:      { id:'china',      name:'China',              shortName:'CHI', abbr:'CN',  icon:'Nations_Buttons/china-symbol.jpg',        side:'allies', color:'#166534', accent:'#bbf7d0', flag:'🇨🇳', startTreasury:12, startIncome:12, mainCapital:null },
  france:     { id:'france',     name:'France',             shortName:'FRA', abbr:'FR',  icon:'Nations_Buttons/france-symbol.jpg',       side:'allies', color:'#1e3a8a', accent:'#60a5fa', flag:'🇫🇷', startTreasury:19, startIncome:19, mainCapital:'France (Paris)' },
  neutral:    { id:'neutral',    name:'Neutral',            shortName:'NEU', abbr:'NE',  icon:null,                                                     side:'neutral',color:'#4b5563', accent:'#9ca3af', flag:'⚪', startTreasury:0,  startIncome:0,  mainCapital:null },
  dutch:      { id:'dutch',      name:'Dutch',              shortName:'DUT', abbr:'NL',  icon:null,                                                     side:'neutral',color:'#b45309', accent:'#fde68a', flag:'🇳🇱', startTreasury:0,  startIncome:0,  mainCapital:null },
};

// ── Game Phases ──────────────────────────────────────────────
// warOnly=true → show with "(Kun ved krig)" tag but still count toward completion
// techRequired  → only visible when nation has that technology researched
// indent=true   → sub-phase, rendered indented under parent
const PHASES = [
  { id:'rd',      label:'Fase 0: Forskning & Utvikling (valgfritt)', warOnly:false, indent:false, techRequired:null, chinaExcluded:true },
  { id:'p1',      label:'Fase 1: Kjøp & Reparer enheter',       warOnly:false, indent:false, techRequired:null     },
  { id:'p2',      label:'Fase 2: Kampbevegelse',                warOnly:true,  indent:false, techRequired:null     },
  { id:'p3',      label:'Fase 3: Gjennomfør kamp',              warOnly:true,  indent:false, techRequired:null     },
  { id:'rockets', label:'↳ Rockets Launch',                     warOnly:true,  indent:true,  techRequired:'rockets' },
  { id:'p4',      label:'Fase 4: Ikke-kampbevegelse',           warOnly:false, indent:false, techRequired:null     },
  { id:'p5',      label:'Fase 5: Mobiliser nye enheter',        warOnly:false, indent:false, techRequired:null     },
  { id:'p6',      label:'Fase 6: Samle inn inntekt',            warOnly:false, indent:false, techRequired:null     },
  { id:'convoy',  label:'↳ Gjennomfør konvoidisrupsjon',        warOnly:false, indent:true,  techRequired:null     },
];

// ── Technologies ─────────────────────────────────────────────
// dieRoll = result on breakthrough die (1-6) that gives this tech
// chart   = which breakthrough chart (1 or 2)
const TECHNOLOGIES = [
  // Chart 1
  { id:'adv_artillery',       name:'Advanced Artillery',            chart:1, dieRoll:1 },
  { id:'rockets',             name:'Rockets',                       chart:1, dieRoll:2 },
  { id:'paratroopers',        name:'Paratroopers',                  chart:1, dieRoll:3 },
  { id:'comb_bombardment',    name:'Increased Factory Production',  chart:1, dieRoll:4 },
  { id:'war_bonds',           name:'War Bonds',                     chart:1, dieRoll:5 },
  { id:'mech_artillery',      name:'Improved Mechanized Infantry',  chart:1, dieRoll:6 },
  // Chart 2
  { id:'super_submarines',    name:'Super Submarines',              chart:2, dieRoll:1 },
  { id:'jet_power',           name:'Jet Fighters',                  chart:2, dieRoll:2 },
  { id:'shipbuilding',        name:'Improved Shipyards',            chart:2, dieRoll:3 },
  { id:'radar',               name:'Radar',                         chart:2, dieRoll:4 },
  { id:'long_range_aircraft', name:'Long-Range Aircraft',           chart:2, dieRoll:5 },
  { id:'heavy_bombers',       name:'Heavy Bombers',                 chart:2, dieRoll:6 },
];

// ── Units ─────────────────────────────────────────────────────
const UNITS = [
  { id:'infantry',      name:'Infantry',                    type:'land',  cost:3,  attack:1, defense:2, move:1  },
  { id:'artillery',     name:'Artillery',                   type:'land',  cost:4,  attack:2, defense:2, move:1  },
  { id:'mech_inf',      name:'Mechanized Infantry',         type:'land',  cost:4,  attack:1, defense:2, move:2  },
  { id:'tank',          name:'Tank',                        type:'land',  cost:6,  attack:3, defense:3, move:2  },
  { id:'aaa',           name:'AAA',                         type:'land',  cost:5,  attack:0, defense:0, move:1  },
  { id:'minor_ic',      name:'Minor Industrial Complex',    type:'building', cost:12, attack:0, defense:0, move:0 },
  { id:'major_ic',      name:'Major Industrial Complex',    type:'building', cost:30, attack:0, defense:0, move:0 },
  { id:'air_base',      name:'Air Base',                    type:'building', cost:15, attack:0, defense:0, move:0 },
  { id:'naval_base',    name:'Naval Base',                  type:'building', cost:15, attack:0, defense:0, move:0 },
  { id:'fighter',       name:'Fighter',                     type:'air',   cost:10, attack:3, defense:4, move:4  },
  { id:'tac_bomber',    name:'Tactical Bomber',             type:'air',   cost:11, attack:3, defense:3, move:4  },
  { id:'str_bomber',    name:'Strategic Bomber',            type:'air',   cost:12, attack:4, defense:1, move:6  },
  { id:'battleship',    name:'Battleship',                  type:'sea',   cost:20, shipbuildingCost:17, attack:4, defense:4, move:2  },
  { id:'carrier',       name:'Aircraft Carrier',            type:'sea',   cost:16, shipbuildingCost:13, attack:0, defense:2, move:2  },
  { id:'cruiser',       name:'Cruiser',                     type:'sea',   cost:12, shipbuildingCost:9,  attack:3, defense:3, move:2  },
  { id:'destroyer',     name:'Destroyer',                   type:'sea',   cost:8,  shipbuildingCost:7,  attack:2, defense:2, move:2  },
  { id:'submarine',     name:'Submarine',                   type:'sea',   cost:6,  shipbuildingCost:5,  attack:2, defense:1, move:2  },
  { id:'transport',     name:'Transport',                   type:'sea',   cost:7,  shipbuildingCost:6,  attack:0, defense:0, move:2  },
];

// ── Territories ───────────────────────────────────────────────
// Fields: id, name, ipc, continent, startController, isCapital, isMainCapital, neutralArmy
// NOTE: This static dataset is the fallback. At runtime, app.js replaces TERRITORIES
// with data parsed from src/territories.csv (the canonical source).
let TERRITORIES = [
  // ── North America ─────────────────────────────────────────
  { id:'greenland',           name:'Greenland',                           ipc:0,  continent:'North America',  startController:'usa',        isCapital:false, isMainCapital:false },
  { id:'alberta',             name:'Alberta / Saskatchewan / Manitoba',   ipc:0,  continent:'North America',  startController:'uk_europe',  isCapital:false, isMainCapital:false },
  { id:'ontario',             name:'Ontario (Ottawa)',                     ipc:2,  continent:'North America',  startController:'uk_europe',  isCapital:true,  isMainCapital:false },
  { id:'quebec',              name:'Quebec',                               ipc:2,  continent:'North America',  startController:'uk_europe',  isCapital:false, isMainCapital:false },
  { id:'newfoundland',        name:'Newfoundland / Labrador',              ipc:0,  continent:'North America',  startController:'uk_europe',  isCapital:false, isMainCapital:false },
  { id:'new_brunswick',       name:'New Brunswick / Nova Scotia',          ipc:1,  continent:'North America',  startController:'uk_europe',  isCapital:false, isMainCapital:false },
  { id:'central_us',          name:'Central United States',                ipc:12, continent:'North America',  startController:'usa',        isCapital:false, isMainCapital:false },
  { id:'eastern_us',          name:'Eastern United States (Washington)',   ipc:20, continent:'North America',  startController:'usa',        isCapital:true,  isMainCapital:true  },
  { id:'se_mexico',           name:'Southeast Mexico',                     ipc:1,  continent:'North America',  startController:'usa',        isCapital:false, isMainCapital:false },
  { id:'central_america',     name:'Central America',                      ipc:1,  continent:'North America',  startController:'usa',        isCapital:false, isMainCapital:false },
  { id:'west_indies',         name:'West Indies',                          ipc:1,  continent:'North America',  startController:'usa',        isCapital:false, isMainCapital:false },
  { id:'alaska',              name:'Alaska',                               ipc:2,  continent:'North America',  startController:'usa',        isCapital:false, isMainCapital:false },
  { id:'aleutian',            name:'Aleutian Islands',                     ipc:0,  continent:'North America',  startController:'usa',        isCapital:false, isMainCapital:false },
  { id:'western_canada',      name:'Western Canada',                       ipc:1,  continent:'North America',  startController:'uk_europe',  isCapital:false, isMainCapital:false },
  { id:'western_us',          name:'Western United States (San Francisco)',ipc:10, continent:'North America',  startController:'usa',        isCapital:true,  isMainCapital:false },
  { id:'mexico',              name:'Mexico',                               ipc:2,  continent:'North America',  startController:'usa',        isCapital:false, isMainCapital:false },

  // ── South America ─────────────────────────────────────────
  { id:'venezuela',           name:'Venezuela',                            ipc:2,  continent:'South America',  startController:'neutral',    isCapital:false, isMainCapital:false, neutralArmy:2 },
  { id:'colombia',            name:'Colombia',                             ipc:0,  continent:'South America',  startController:'neutral',    isCapital:false, isMainCapital:false },
  { id:'ecuador',             name:'Ecuador',                              ipc:0,  continent:'South America',  startController:'neutral',    isCapital:false, isMainCapital:false },
  { id:'peru',                name:'Peru',                                 ipc:0,  continent:'South America',  startController:'neutral',    isCapital:false, isMainCapital:false },
  { id:'bolivia',             name:'Bolivia',                              ipc:0,  continent:'South America',  startController:'neutral',    isCapital:false, isMainCapital:false },
  { id:'chile',               name:'Chile',                                ipc:2,  continent:'South America',  startController:'neutral',    isCapital:false, isMainCapital:false, neutralArmy:2 },
  { id:'argentina',           name:'Argentina',                            ipc:2,  continent:'South America',  startController:'neutral',    isCapital:false, isMainCapital:false, neutralArmy:4 },
  { id:'paraguay',            name:'Paraguay',                             ipc:0,  continent:'South America',  startController:'neutral',    isCapital:false, isMainCapital:false },
  { id:'uruguay',             name:'Uruguay',                              ipc:0,  continent:'South America',  startController:'neutral',    isCapital:false, isMainCapital:false },
  { id:'brazil',              name:'Brazil',                               ipc:2,  continent:'South America',  startController:'neutral',    isCapital:false, isMainCapital:false, neutralArmy:3, neutralType:'pro_allied' },
  { id:'british_guiana',      name:'British Guiana',                       ipc:0,  continent:'South America',  startController:'uk_europe',  isCapital:false, isMainCapital:false },
  { id:'suriname',            name:'Suriname',                             ipc:0,  continent:'South America',  startController:'dutch',      isCapital:false, isMainCapital:false },
  { id:'french_guiana',       name:'French Guiana',                        ipc:0,  continent:'South America',  startController:'france',     isCapital:false, isMainCapital:false },

  // ── Europe ────────────────────────────────────────────────
  { id:'iceland',             name:'Iceland',                              ipc:0,  continent:'Europe',         startController:'uk_europe',  isCapital:false, isMainCapital:false },
  { id:'scotland',            name:'Scotland',                             ipc:2,  continent:'Europe',         startController:'uk_europe',  isCapital:false, isMainCapital:false },
  { id:'eire',                name:'Eire',                                 ipc:0,  continent:'Europe',         startController:'neutral',    isCapital:false, isMainCapital:false },
  { id:'united_kingdom',      name:'United Kingdom (London)',              ipc:6,  continent:'Europe',         startController:'uk_europe',  isCapital:true,  isMainCapital:true  },
  { id:'normandy',            name:'Normandy / Bordeaux',                  ipc:2,  continent:'Europe',         startController:'france',     isCapital:false, isMainCapital:false },
  { id:'france',              name:'France (Paris)',                        ipc:4,  continent:'Europe',         startController:'france',     isCapital:true,  isMainCapital:true  },
  { id:'southern_france',     name:'Southern France',                      ipc:3,  continent:'Europe',         startController:'france',     isCapital:false, isMainCapital:false },
  { id:'holland_belgium',     name:'Holland / Belgium',                    ipc:3,  continent:'Europe',         startController:'germany',    isCapital:false, isMainCapital:false },
  { id:'denmark',             name:'Denmark',                              ipc:2,  continent:'Europe',         startController:'germany',    isCapital:false, isMainCapital:false },
  { id:'western_germany',     name:'Western Germany',                      ipc:5,  continent:'Europe',         startController:'germany',    isCapital:false, isMainCapital:false },
  { id:'switzerland',         name:'Switzerland',                          ipc:2,  continent:'Europe',         startController:'neutral',    isCapital:false, isMainCapital:false, neutralArmy:2, neutralType:'strict' },
  { id:'germany',             name:'Germany (Berlin)',                     ipc:5,  continent:'Europe',         startController:'germany',    isCapital:true,  isMainCapital:true  },
  { id:'greater_s_germany',   name:'Greater Southern Germany',             ipc:4,  continent:'Europe',         startController:'germany',    isCapital:false, isMainCapital:false },
  { id:'slovakia_hungary',    name:'Slovakia / Hungary',                   ipc:3,  continent:'Europe',         startController:'germany',    isCapital:false, isMainCapital:false },
  { id:'poland',              name:'Poland (Warsaw)',                       ipc:2,  continent:'Europe',         startController:'germany',    isCapital:true,  isMainCapital:false },
  { id:'romania',             name:'Romania',                              ipc:3,  continent:'Europe',         startController:'germany',    isCapital:false, isMainCapital:false },
  { id:'northern_italy',      name:'Northern Italy',                       ipc:4,  continent:'Europe',         startController:'italy',      isCapital:false, isMainCapital:false },
  { id:'southern_italy',      name:'Southern Italy (Rome)',                ipc:3,  continent:'Europe',         startController:'italy',      isCapital:true,  isMainCapital:true  },
  { id:'sardinia',            name:'Sardinia',                             ipc:0,  continent:'Europe',         startController:'italy',      isCapital:false, isMainCapital:false },
  { id:'sicily',              name:'Sicily',                               ipc:0,  continent:'Europe',         startController:'italy',      isCapital:false, isMainCapital:false },
  { id:'yugoslavia',          name:'Yugoslavia',                           ipc:2,  continent:'Europe',         startController:'neutral',    isCapital:false, isMainCapital:false, neutralArmy:5, neutralType:'pro_allied' },
  { id:'albania',             name:'Albania',                              ipc:1,  continent:'Europe',         startController:'italy',      isCapital:false, isMainCapital:false },
  { id:'greece',              name:'Greece',                               ipc:2,  continent:'Europe',         startController:'neutral',    isCapital:false, isMainCapital:false, neutralArmy:4, neutralType:'pro_allied' },
  { id:'bulgaria',            name:'Bulgaria',                             ipc:1,  continent:'Europe',         startController:'neutral',    isCapital:false, isMainCapital:false, neutralArmy:4, neutralType:'pro_axis' },
  { id:'cyprus',              name:'Cyprus',                               ipc:0,  continent:'Europe',         startController:'uk_europe',  isCapital:false, isMainCapital:false },
  { id:'malta',               name:'Malta',                                ipc:0,  continent:'Europe',         startController:'uk_europe',  isCapital:false, isMainCapital:false },
  { id:'portugal',            name:'Portugal',                             ipc:1,  continent:'Europe',         startController:'neutral',    isCapital:false, isMainCapital:false, neutralArmy:2 },
  { id:'spain',               name:'Spain',                                ipc:2,  continent:'Europe',         startController:'neutral',    isCapital:false, isMainCapital:false, neutralArmy:6 },
  { id:'gibraltar',           name:'Gibraltar',                            ipc:0,  continent:'Europe',         startController:'uk_europe',  isCapital:false, isMainCapital:false },
  { id:'norway',              name:'Norway',                               ipc:3,  continent:'Europe',         startController:'germany',    isCapital:false, isMainCapital:false },
  { id:'sweden',              name:'Sweden',                               ipc:3,  continent:'Europe',         startController:'neutral',    isCapital:false, isMainCapital:false, neutralArmy:6, neutralType:'strict' },
  { id:'finland',             name:'Finland',                              ipc:2,  continent:'Europe',         startController:'neutral',    isCapital:false, isMainCapital:false, neutralArmy:4, neutralType:'pro_axis' },

  // ── Eastern Europe / Soviet ──────────────────────────────
  { id:'baltic_states',       name:'Baltic States',                        ipc:1,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'karelia',             name:'Karelia',                              ipc:1,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'vyborg',              name:'Vyborg',                               ipc:0,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'eastern_poland',      name:'Eastern Poland',                       ipc:1,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'bessarabia',          name:'Bessarabia',                           ipc:0,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'leningrad',           name:'Novgorod (Leningrad)',                  ipc:2,  continent:'Europe',         startController:'soviet',     isCapital:true,  isMainCapital:false },
  { id:'belarus',             name:'Belarus',                              ipc:1,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'western_ukraine',     name:'Western Ukraine',                      ipc:2,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'ukraine',             name:'Ukraine',                              ipc:2,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'archangel',           name:'Archangel',                            ipc:1,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'smolensk',            name:'Smolensk',                             ipc:1,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'bryansk',             name:'Bryansk',                              ipc:1,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'rostov',              name:'Rostov',                               ipc:2,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'moscow',              name:'Russia (Moscow)',                       ipc:3,  continent:'Europe',         startController:'soviet',     isCapital:true,  isMainCapital:true  },
  { id:'vologda',             name:'Vologda',                              ipc:1,  continent:'Europe',         startController:'soviet',     isCapital:true,  isMainCapital:false },
  { id:'tambov',              name:'Tambov',                               ipc:1,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'volgograd',           name:'Volgograd',                            ipc:2,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'caucasus',            name:'Caucasus',                             ipc:2,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'novosibirsk',         name:'Novosibirsk',                          ipc:1,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'samara',              name:'Samara',                               ipc:1,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'kazakhstan',          name:'Kazakhstan',                           ipc:1,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'turkmenistan',        name:'Turkmenistan',                         ipc:1,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'nenetsia',            name:'Nenetsia',                             ipc:0,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'urals',               name:'Urals',                                ipc:1,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'evenkiysky',          name:'Evenkiysky',                           ipc:1,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'yenisey',             name:'Yenisey',                              ipc:1,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'yakut',               name:'Yakut S.S.R.',                         ipc:1,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'buryatia',            name:'Buryatia',                             ipc:1,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'sakha',               name:'Sakha',                                ipc:1,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'siberia',             name:'Siberia',                              ipc:1,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'amur',                name:'Amur',                                 ipc:1,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'soviet_far_east',     name:'Soviet Far East',                      ipc:1,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },
  { id:'tunguska',            name:'Tunguska',                             ipc:1,  continent:'Europe',         startController:'soviet',     isCapital:false, isMainCapital:false },

  // ── Mongolia / Asia Neutral ──────────────────────────────
  { id:'dzavhan',             name:'Dzavhan',                              ipc:0,  continent:'Asia',           startController:'neutral',    isCapital:false, isMainCapital:false, neutralArmy:1, neutralType:'mongolia' },
  { id:'olgiy',               name:'Olgiy',                                ipc:0,  continent:'Asia',           startController:'neutral',    isCapital:false, isMainCapital:false, neutralArmy:2, neutralType:'mongolia' },
  { id:'ulaanbaatar',         name:'Ulaanbaatar',                          ipc:0,  continent:'Asia',           startController:'neutral',    isCapital:false, isMainCapital:false, neutralArmy:1, neutralType:'mongolia' },
  { id:'tsagaan_olom',        name:'Tsagaan-Olom',                         ipc:0,  continent:'Asia',           startController:'neutral',    isCapital:false, isMainCapital:false, neutralType:'mongolia' },
  { id:'central_mongolia',    name:'Central Mongolia',                     ipc:0,  continent:'Asia',           startController:'neutral',    isCapital:false, isMainCapital:false, neutralType:'mongolia' },
  { id:'buyant_uhaa',         name:'Buyant-Uhaa',                          ipc:0,  continent:'Asia',           startController:'neutral',    isCapital:false, isMainCapital:false, neutralArmy:2, neutralType:'mongolia' },

  // ── Africa ────────────────────────────────────────────────
  { id:'morocco',             name:'Morocco',                              ipc:1,  continent:'Africa',         startController:'france',     isCapital:false, isMainCapital:false },
  { id:'portuguese_guinea',   name:'Portuguese Guinea',                    ipc:0,  continent:'Africa',         startController:'neutral',    isCapital:false, isMainCapital:false },
  { id:'sierra_leone',        name:'Sierra Leone',                         ipc:0,  continent:'Africa',         startController:'neutral',    isCapital:false, isMainCapital:false },
  { id:'liberia',             name:'Liberia',                              ipc:0,  continent:'Africa',         startController:'neutral',    isCapital:false, isMainCapital:false },
  { id:'fr_west_africa',      name:'French West Africa',                   ipc:1,  continent:'Africa',         startController:'france',     isCapital:false, isMainCapital:false },
  { id:'gold_coast',          name:'Gold Coast',                           ipc:1,  continent:'Africa',         startController:'uk_europe',  isCapital:false, isMainCapital:false },
  { id:'algeria',             name:'Algeria',                              ipc:1,  continent:'Africa',         startController:'france',     isCapital:false, isMainCapital:false },
  { id:'tunisia',             name:'Tunisia',                              ipc:1,  continent:'Africa',         startController:'france',     isCapital:false, isMainCapital:false },
  { id:'fr_central_africa',   name:'French Central Africa',                ipc:1,  continent:'Africa',         startController:'france',     isCapital:false, isMainCapital:false },
  { id:'nigeria',             name:'Nigeria',                              ipc:1,  continent:'Africa',         startController:'uk_europe',  isCapital:false, isMainCapital:false },
  { id:'libya',               name:'Libya',                                ipc:1,  continent:'Africa',         startController:'italy',      isCapital:false, isMainCapital:false },
  { id:'tobruk',              name:'Tobruk',                               ipc:0,  continent:'Africa',         startController:'italy',      isCapital:false, isMainCapital:false },
  { id:'alexandria',          name:'Alexandria',                           ipc:0,  continent:'Africa',         startController:'uk_europe',  isCapital:false, isMainCapital:false },
  { id:'egypt',               name:'Egypt',                                ipc:2,  continent:'Africa',         startController:'uk_europe',  isCapital:false, isMainCapital:false },
  { id:'trans_jordan',        name:'Trans-Jordan',                         ipc:1,  continent:'Africa',         startController:'uk_europe',  isCapital:false, isMainCapital:false },
  { id:'ae_sudan',            name:'Anglo-Egyptian Sudan',                 ipc:1,  continent:'Africa',         startController:'uk_europe',  isCapital:false, isMainCapital:false },
  { id:'fr_equatorial',       name:'French Equatorial Africa',             ipc:1,  continent:'Africa',         startController:'france',     isCapital:false, isMainCapital:false },
  { id:'ethiopia',            name:'Ethiopia',                             ipc:1,  continent:'Africa',         startController:'italy',      isCapital:false, isMainCapital:false },
  { id:'british_somalia',     name:'British Somalia',                      ipc:0,  continent:'Africa',         startController:'uk_europe',  isCapital:false, isMainCapital:false },
  { id:'italian_somalia',     name:'Italian Somalia',                      ipc:0,  continent:'Africa',         startController:'italy',      isCapital:false, isMainCapital:false },
  { id:'kenya',               name:'Kenya',                                ipc:1,  continent:'Africa',         startController:'uk_europe',  isCapital:false, isMainCapital:false },
  { id:'belgian_congo',       name:'Belgian Congo',                        ipc:1,  continent:'Africa',         startController:'uk_europe',  isCapital:false, isMainCapital:false },
  { id:'tanganyika',          name:'Tanganyika Territory',                 ipc:1,  continent:'Africa',         startController:'uk_europe',  isCapital:false, isMainCapital:false },
  { id:'angola',              name:'Angola',                               ipc:1,  continent:'Africa',         startController:'neutral',    isCapital:false, isMainCapital:false, neutralArmy:2 },
  { id:'rhodesia',            name:'Rhodesia',                             ipc:1,  continent:'Africa',         startController:'uk_europe',  isCapital:false, isMainCapital:false },
  { id:'mozambique',          name:'Mozambique',                           ipc:1,  continent:'Africa',         startController:'neutral',    isCapital:false, isMainCapital:false, neutralArmy:2 },
  { id:'sw_africa',           name:'South West Africa',                    ipc:1,  continent:'Africa',         startController:'uk_europe',  isCapital:false, isMainCapital:false },
  { id:'south_africa',        name:'Union of South Africa',                ipc:2,  continent:'Africa',         startController:'uk_europe',  isCapital:false, isMainCapital:false },
  { id:'fr_madagascar',       name:'French Madagascar',                    ipc:1,  continent:'Africa',         startController:'france',     isCapital:false, isMainCapital:false },

  // ── Middle East ───────────────────────────────────────────
  { id:'saudi_arabia',        name:'Saudi Arabia',                         ipc:2,  continent:'Middle East',    startController:'neutral',    isCapital:false, isMainCapital:false, neutralArmy:2 },
  { id:'turkey',              name:'Turkey',                               ipc:2,  continent:'Middle East',    startController:'neutral',    isCapital:false, isMainCapital:false, neutralArmy:8, neutralType:'strict' },
  { id:'syria',               name:'Syria',                                ipc:1,  continent:'Middle East',    startController:'france',     isCapital:false, isMainCapital:false },
  { id:'iraq',                name:'Iraq',                                 ipc:2,  continent:'Middle East',    startController:'neutral',    isCapital:false, isMainCapital:false, neutralArmy:3, neutralType:'pro_axis' },
  { id:'nw_persia',           name:'Northwest Persia',                     ipc:0,  continent:'Middle East',    startController:'neutral',    isCapital:false, isMainCapital:false, neutralType:'pro_allied' },
  { id:'persia',              name:'Persia',                               ipc:2,  continent:'Middle East',    startController:'neutral',    isCapital:false, isMainCapital:false, neutralArmy:2, neutralType:'pro_allied' },
  { id:'e_persia',            name:'Eastern Persia',                       ipc:0,  continent:'Middle East',    startController:'neutral',    isCapital:false, isMainCapital:false, neutralType:'pro_allied' },
  { id:'afghanistan',         name:'Afghanistan',                          ipc:0,  continent:'Middle East',    startController:'neutral',    isCapital:false, isMainCapital:false, neutralArmy:4 },

  // ── China ─────────────────────────────────────────────────
  { id:'kansu',               name:'Kansu',                                ipc:1,  continent:'Asia',           startController:'china',      isCapital:false, isMainCapital:false },
  { id:'tsinghai',            name:'Tsinghai',                             ipc:1,  continent:'Asia',           startController:'china',      isCapital:false, isMainCapital:false },
  { id:'sikang',              name:'Sikang',                               ipc:1,  continent:'Asia',           startController:'china',      isCapital:false, isMainCapital:false },
  { id:'suiyuan',             name:'Suiyuan',                              ipc:1,  continent:'Asia',           startController:'china',      isCapital:false, isMainCapital:false },
  { id:'shensi',              name:'Shensi',                               ipc:1,  continent:'Asia',           startController:'china',      isCapital:false, isMainCapital:false },
  { id:'szechwan',            name:'Szechwan',                             ipc:1,  continent:'Asia',           startController:'china',      isCapital:false, isMainCapital:false },
  { id:'chahar',              name:'Chahar',                               ipc:1,  continent:'Asia',           startController:'china',      isCapital:false, isMainCapital:false },
  { id:'hopei',               name:'Hopei',                                ipc:1,  continent:'Asia',           startController:'china',      isCapital:false, isMainCapital:false },
  { id:'kweichow',            name:'Kweichow',                             ipc:1,  continent:'Asia',           startController:'china',      isCapital:false, isMainCapital:false },
  { id:'yunnan',              name:'Yunnan',                               ipc:1,  continent:'Asia',           startController:'china',      isCapital:false, isMainCapital:false },
  { id:'jehol',               name:'Jehol',                                ipc:1,  continent:'Asia',           startController:'japan',      isCapital:false, isMainCapital:false, originalController:'china' },
  { id:'anhwe',               name:'Anhwe',                                ipc:1,  continent:'Asia',           startController:'china',      isCapital:false, isMainCapital:false },
  { id:'hunan',               name:'Hunan',                                ipc:1,  continent:'Asia',           startController:'china',      isCapital:false, isMainCapital:false },
  { id:'kwangsi',             name:'Kwangsi',                              ipc:1,  continent:'Asia',           startController:'japan',      isCapital:false, isMainCapital:false, originalController:'china' },
  { id:'manchuria',           name:'Manchuria',                            ipc:3,  continent:'Asia',           startController:'japan',      isCapital:false, isMainCapital:false },
  { id:'shantung',            name:'Shantung',                             ipc:2,  continent:'Asia',           startController:'japan',      isCapital:false, isMainCapital:false, originalController:'china' },
  { id:'kiangsu',             name:'Kiangsu (Shanghai)',                   ipc:3,  continent:'Asia',           startController:'japan',      isCapital:false, isMainCapital:false },
  { id:'kiangsi',             name:'Kiangsi',                              ipc:1,  continent:'Asia',           startController:'japan',      isCapital:false, isMainCapital:false },
  { id:'kwangtung',           name:'Kwangtung (Hong Kong)',                ipc:3,  continent:'Asia',           startController:'uk_pacific', isCapital:false, isMainCapital:false },

  // ── South / Southeast Asia ────────────────────────────────
  { id:'west_india',          name:'West India',                           ipc:2,  continent:'Asia',           startController:'uk_pacific', isCapital:false, isMainCapital:false },
  { id:'india',               name:'India (Calcutta)',                     ipc:3,  continent:'Asia',           startController:'uk_pacific', isCapital:true,  isMainCapital:true  },
  { id:'burma',               name:'Burma',                                ipc:1,  continent:'Asia',           startController:'uk_pacific', isCapital:false, isMainCapital:false },
  { id:'shan_state',          name:'Shan State',                           ipc:1,  continent:'Asia',           startController:'uk_pacific', isCapital:false, isMainCapital:false },
  { id:'ceylon',              name:'Ceylon',                               ipc:0,  continent:'Asia',           startController:'uk_pacific', isCapital:false, isMainCapital:false },
  { id:'malaya',              name:'Malaya',                               ipc:3,  continent:'Asia',           startController:'uk_pacific', isCapital:false, isMainCapital:false },
  { id:'sumatra',             name:'Sumatra',                              ipc:4,  continent:'Asia',           startController:'dutch',      isCapital:false, isMainCapital:false },
  { id:'siam',                name:'Siam',                                 ipc:1,  continent:'Asia',           startController:'japan',      isCapital:false, isMainCapital:false },
  { id:'fr_indochina',        name:'French Indochina',                     ipc:1,  continent:'Asia',           startController:'france',     isCapital:false, isMainCapital:false },
  { id:'java',                name:'Java',                                 ipc:4,  continent:'Asia',           startController:'dutch',      isCapital:false, isMainCapital:false },
  { id:'borneo',              name:'Borneo',                               ipc:4,  continent:'Asia',           startController:'uk_pacific', isCapital:false, isMainCapital:false },
  { id:'celebes',             name:'Celebes',                              ipc:3,  continent:'Asia',           startController:'dutch',      isCapital:false, isMainCapital:false },

  // ── Pacific / Australia ───────────────────────────────────
  { id:'philippines',         name:'Philippines',                          ipc:2,  continent:'Pacific',        startController:'usa',        isCapital:false, isMainCapital:false },
  { id:'w_australia',         name:'Western Australia',                    ipc:1,  continent:'Pacific',        startController:'anzac',      isCapital:false, isMainCapital:false },
  { id:'n_territory',         name:'Northern Territory',                   ipc:1,  continent:'Pacific',        startController:'anzac',      isCapital:false, isMainCapital:false },
  { id:'s_australia',         name:'South Australia',                      ipc:1,  continent:'Pacific',        startController:'anzac',      isCapital:false, isMainCapital:false },
  { id:'queensland',          name:'Queensland',                           ipc:2,  continent:'Pacific',        startController:'anzac',      isCapital:false, isMainCapital:false },
  { id:'new_south_wales',     name:'New South Wales (Sydney)',              ipc:2,  continent:'Pacific',        startController:'anzac',      isCapital:true,  isMainCapital:true  },
  { id:'victoria',            name:'Victoria',                             ipc:1,  continent:'Pacific',        startController:'anzac',      isCapital:false, isMainCapital:false },
  { id:'new_guinea',          name:'New Guinea',                           ipc:0,  continent:'Pacific',        startController:'anzac',      isCapital:false, isMainCapital:false },
  { id:'new_britain',         name:'New Britain',                          ipc:0,  continent:'Pacific',        startController:'anzac',      isCapital:false, isMainCapital:false },
  { id:'solomon_islands',     name:'Solomon Islands',                      ipc:0,  continent:'Pacific',        startController:'anzac',      isCapital:false, isMainCapital:false },
  { id:'dutch_new_guinea',    name:'Dutch New Guinea',                     ipc:0,  continent:'Pacific',        startController:'dutch',      isCapital:false, isMainCapital:false },
  { id:'palau',               name:'Palau Islands',                        ipc:0,  continent:'Pacific',        startController:'japan',      isCapital:false, isMainCapital:false },
  { id:'caroline',            name:'Caroline Islands',                     ipc:0,  continent:'Pacific',        startController:'japan',      isCapital:false, isMainCapital:false },
  { id:'marshall',            name:'Marshall Islands',                     ipc:0,  continent:'Pacific',        startController:'japan',      isCapital:false, isMainCapital:false },
  { id:'gilbert',             name:'Gilbert Islands',                      ipc:0,  continent:'Pacific',        startController:'uk_pacific', isCapital:false, isMainCapital:false },
  { id:'new_hebrides',        name:'New Hebrides',                         ipc:0,  continent:'Pacific',        startController:'anzac',      isCapital:false, isMainCapital:false },
  { id:'new_zealand',         name:'New Zealand',                          ipc:0,  continent:'Pacific',        startController:'anzac',      isCapital:false, isMainCapital:false },
  { id:'johnston',            name:'Johnston Island',                      ipc:0,  continent:'Pacific',        startController:'usa',        isCapital:false, isMainCapital:false },
  { id:'line_islands',        name:'Line Islands',                         ipc:0,  continent:'Pacific',        startController:'usa',        isCapital:false, isMainCapital:false },
  { id:'fiji',                name:'Fiji',                                 ipc:0,  continent:'Pacific',        startController:'uk_pacific', isCapital:false, isMainCapital:false },
  { id:'samoa',               name:'Samoa',                                ipc:0,  continent:'Pacific',        startController:'uk_pacific', isCapital:false, isMainCapital:false },
  { id:'hawaii',              name:'Hawaiian Islands',                     ipc:1,  continent:'Pacific',        startController:'usa',        isCapital:false, isMainCapital:false },
  { id:'wake',                name:'Wake Island',                          ipc:0,  continent:'Pacific',        startController:'usa',        isCapital:false, isMainCapital:false },
  { id:'midway',              name:'Midway',                               ipc:0,  continent:'Pacific',        startController:'usa',        isCapital:false, isMainCapital:false },
  { id:'guam',                name:'Guam',                                 ipc:0,  continent:'Pacific',        startController:'usa',        isCapital:false, isMainCapital:false },
  { id:'marianas',            name:'Marianas',                             ipc:0,  continent:'Pacific',        startController:'japan',      isCapital:false, isMainCapital:false },
  { id:'iwo_jima',            name:'Iwo Jima',                             ipc:0,  continent:'Pacific',        startController:'japan',      isCapital:false, isMainCapital:false },
  { id:'okinawa',             name:'Okinawa',                              ipc:0,  continent:'Pacific',        startController:'japan',      isCapital:false, isMainCapital:false },
  { id:'japan',               name:'Japan (Tokyo)',                         ipc:8,  continent:'Pacific',        startController:'japan',      isCapital:true,  isMainCapital:true  },
  { id:'korea',               name:'Korea',                                ipc:3,  continent:'Pacific',        startController:'japan',      isCapital:false, isMainCapital:false },
  { id:'hainan',              name:'Hainan',                               ipc:0,  continent:'Pacific',        startController:'japan',      isCapital:false, isMainCapital:false },
  { id:'formosa',             name:'Formosa',                              ipc:1,  continent:'Pacific',        startController:'japan',      isCapital:false, isMainCapital:false },
];

// ── Computed: Victory City list ───────────────────────────────
// Recomputed in app.js after CSV load if CSV is available.
let VICTORY_CITIES = TERRITORIES.filter(t => t.isCapital);

// ── National Objectives ───────────────────────────────────────
// Each objective: { id, ipc, desc, hint }
// Players manually check these off when conditions are met
const NATIONAL_OBJECTIVES = {
  germany: [
    {
      id: 'ger_peace_soviet',
      ipc: 5,
      peaceOnly: true,
      desc: 'Ikke i krig med Sovjet',
      hint: 'Handel med råvarer fra Sovjet (hvete og olje) — Lebensraum',
    },
    {
      id: 'ger_leningrad',
      ipc: 5,
      warOnly: true,
      desc: 'I krig m/Sovjet: Kontrollerer Novgorod (Leningrad)',
      hint: 'Høy strategisk og propagandaverdi',
    },
    {
      id: 'ger_volgograd',
      ipc: 5,
      warOnly: true,
      desc: 'I krig m/Sovjet: Kontrollerer Volgograd (Stalingrad)',
      hint: 'Høy strategisk og propagandaverdi',
    },
    {
      id: 'ger_moscow',
      ipc: 5,
      warOnly: true,
      desc: 'I krig m/Sovjet: Kontrollerer Russland (Moskva)',
      hint: 'Høy strategisk og propagandaverdi',
    },
    {
      id: 'ger_caucasus',
      ipc: 5,
      warOnly: true,
      desc: 'I krig m/Sovjet: En Aksemakt kontrollerer Kaukasus',
      hint: 'Kontroll over vital sovjetisk oljeproduksjon',
    },
    {
      id: 'ger_egypt',
      ipc: 5,
      warOnly: true,
      desc: 'I krig m/UK+Frankrike: Minst 1 tysk landenhet i Aksekontrollert Egypt',
      hint: 'Inngangsport til Midtøstens oljefelter (propagandaverdi)',
    },
    {
      id: 'ger_scandinavia',
      ipc: 5,
      warOnly: true,
      desc: 'Kontrollerer Danmark OG Norge — Sverige er ikke Alliert-kontrollert',
      hint: 'Tilgang til jernmalm og andre strategiske ressurser',
    },
    {
      id: 'ger_iraq',
      ipc: 2,
      warOnly: true,
      desc: 'Kontrollerer Irak',
      hint: 'Tilgang til strategiske oljereserver',
    },
    {
      id: 'ger_persia',
      ipc: 2,
      warOnly: true,
      desc: 'Kontrollerer Persia',
      hint: 'Tilgang til strategiske oljereserver',
    },
    {
      id: 'ger_nw_persia',
      ipc: 2,
      warOnly: true,
      desc: 'Kontrollerer Nordvest-Persia',
      hint: 'Tilgang til strategiske oljereserver',
    },
  ],

  soviet: [
    {
      id: 'sov_lend_lease',
      ipc: 5,
      warOnly: true,
      desc: 'I krig i Europa: Sjøsone 125 fri for AksekrigsSkip, Arkhangelsk-kontrollert av Sovjet, ingen andre Allierte landenheter i originale sovjet-territorier',
      hint: 'Nasjonal prestisje og tilgang til Lend-Lease materiell fra de Allierte',
    },
    {
      id: 'sov_axis_territories',
      ipc: 0,
      ipcPerTerritory: 3,
      dynamicIpc: true,
      warOnly: true,
      desc: 'I krig i Europa: +3 IPC per opprinnelig tysk/italiensk/pro-Akse-territorium Sovjet kontrollerer',
      hint: 'Teller alle territorier med startController germany eller italy som Sovjet nå kontrollerer. Ingen øvre grense.',
    },
    {
      id: 'sov_berlin',
      ipc: 10,
      warOnly: true,
      desc: 'ENGANGS: Sovjet kontrollerer Berlin (første gang)',
      hint: 'Nasjonal prestisje — kun én gang per spill',
      oneTime: true,
    },
  ],

  japan: [
    {
      id: 'jap_us_trade',
      ipc: 10,
      peaceOnly: true,
      desc: 'Ikke i krig med USA, har ikke angrepet Fransk Indokina, ingen uprovosert krigserklæring mot UK/ANZAC',
      hint: 'Strategisk ressurshandel med USA',
    },
    {
      id: 'jap_perimeter',
      ipc: 5,
      warOnly: true,
      desc: 'I krig m/Vesten: Aksemakter kontrollerer Guam, Midway, Wake Island, Gilbert Islands, Solomon Islands',
      hint: 'Strategisk ytre forsvarslinje',
    },
    {
      id: 'jap_india',
      ipc: 5,
      warOnly: true,
      desc: 'I krig m/Vesten: Aksemakter kontrollerer India (Calcutta)',
      hint: 'Stort alliert maktsentrum',
    },
    {
      id: 'jap_sydney',
      ipc: 5,
      warOnly: true,
      desc: 'I krig m/Vesten: Aksemakter kontrollerer New South Wales (Sydney)',
      hint: 'Stort alliert maktsentrum',
    },
    {
      id: 'jap_hawaii',
      ipc: 5,
      warOnly: true,
      desc: 'I krig m/Vesten: Aksemakter kontrollerer Hawaiian Islands',
      hint: 'Stort alliert maktsentrum',
    },
    {
      id: 'jap_west_us',
      ipc: 5,
      warOnly: true,
      desc: 'I krig m/Vesten: Aksemakter kontrollerer Western United States',
      hint: 'Stort alliert maktsentrum',
    },
    {
      id: 'jap_resources',
      ipc: 5,
      warOnly: true,
      desc: 'I krig m/Vesten: Aksemakter kontrollerer Sumatra, Java, Borneo, Celebes',
      hint: 'Strategiske ressurssentre — Det store øst-asiatiske velstandssfæren',
    },
  ],

  usa: [
    {
      id: 'usa_homeland',
      ipc: 10,
      warOnly: true,
      desc: 'I krig: USA kontrollerer Eastern US, Central US OG Western US',
      hint: 'Grunnleggende nasjonal suverenitet',
    },
    {
      id: 'usa_pacific',
      ipc: 5,
      warOnly: true,
      desc: 'I krig: USA kontrollerer Alaska, Aleutian Islands, Hawaiian Islands, Johnston Island, Line Islands',
      hint: 'Nasjonal suverenitetsspørsmål i Stillehavet',
    },
    {
      id: 'usa_caribbean',
      ipc: 5,
      warOnly: true,
      desc: 'I krig: USA kontrollerer Mexico, SE Mexico, Central America, West Indies',
      hint: 'Forsvarstraktat og handelsforpliktelser',
    },
    {
      id: 'usa_philippines',
      ipc: 5,
      warOnly: true,
      desc: 'I krig: USA kontrollerer Filippinene',
      hint: 'Sentrum for amerikansk innflytelse i Asia',
    },
    {
      id: 'usa_france',
      ipc: 5,
      warOnly: true,
      desc: 'I krig: Minst 1 amerikansk landenhet i Frankrike',
      hint: 'Det store allianse-samarbeidet',
    },
  ],

  china: [
    {
      id: 'chi_burma_road',
      ipc: 6,
      warOnly: true,
      desc: 'Burma-veien er åpen: De Allierte kontrollerer India, Burma, Yunnan OG Szechwan',
      hint: 'Kinesisk militær forsyningslinje — gir også rett til å kjøpe artilleri',
    },
  ],

  uk_europe: [
    {
      id: 'uke_empire',
      ipc: 5,
      warOnly: true,
      desc: 'I krig i Europa: UK kontrollerer alle sine opprinnelige territorier (Europa-økonomi)',
      hint: 'Vedlikehold av imperiet — vital nasjonal målsetting',
    },
  ],

  uk_pacific: [
    {
      id: 'ukp_far_east',
      ipc: 5,
      warOnly: true,
      desc: 'I krig m/Japan: UK kontrollerer Kwangtung OG Malaya',
      hint: 'Vedlikehold av imperiet i Fjerne Østen',
    },
  ],

  italy: [
    {
      id: 'ita_mediterranean_land',
      ipc: 5,
      warOnly: true,
      desc: 'I krig: Aksemakter kontrollerer minst 3 av: Gibraltar, Sør-Frankrike, Hellas, Egypt',
      hint: 'Mare Nostrum — det store Romerrikets gjenopplivelse',
    },
    {
      id: 'ita_sea_control',
      ipc: 5,
      warOnly: true,
      desc: 'I krig: Ingen Allierte overflateskip i Middelhavet (sjøsonene 92–99)',
      hint: 'Propaganda og strategisk fordel',
    },
    {
      id: 'ita_north_africa',
      ipc: 5,
      warOnly: true,
      desc: 'I krig: Aksemakter kontrollerer Marokko, Algerie, Tunisia, Libya, Tobruk, Alexandria',
      hint: 'Erklærte militære mål i Nord-Afrika',
    },
    {
      id: 'ita_iraq',
      ipc: 2,
      warOnly: true,
      desc: 'I krig: Italia kontrollerer Irak',
      hint: 'Tilgang til strategiske oljereserver',
    },
    {
      id: 'ita_persia',
      ipc: 2,
      warOnly: true,
      desc: 'I krig: Italia kontrollerer Persia',
      hint: 'Tilgang til strategiske oljereserver',
    },
    {
      id: 'ita_nw_persia',
      ipc: 2,
      warOnly: true,
      desc: 'I krig: Italia kontrollerer Nordvest-Persia',
      hint: 'Tilgang til strategiske oljereserver',
    },
  ],

  anzac: [
    {
      id: 'anz_malaya',
      ipc: 5,
      warOnly: true,
      desc: 'I krig m/Japan: Alliert makt kontrollerer Malaya OG ANZAC kontrollerer alle sine opprinnelige territorier',
      hint: 'Malaya regnes som hjørnesteinen i det britiske imperiet i Fjerne Østen',
    },
    {
      id: 'anz_perimeter',
      ipc: 5,
      warOnly: true,
      desc: 'I krig m/Japan: De Allierte kontrollerer Dutch New Guinea, New Guinea, New Britain, Solomon Islands',
      hint: 'Strategisk ytre forsvarslinje for Australia',
    },
  ],

  france: [
    {
      id: 'fra_liberation',
      ipc: 12,
      warOnly: true,
      desc: 'ENGANGS: Frankrike er frigjort av de Allierte (opptil 12 IPC i franske enheter gratis)',
      hint: 'Nasjonal frigjøring og prestisje — kun én gang per spill',
      oneTime: true,
      freeUnits: true,
    },
  ],
};

// ── Starting Facilities ───────────────────────────────────────
// Canonical list of facilities present at game start.
// Keys are territory IDs (matching territories.csv territoryId column).
// ic: 'minor' | 'major' | null
const STARTING_FACILITIES = {
  // ── Germany ───────────────────────────────────────────────
  'europe-germany-berlin':                    { ic: 'major', airBase: false, navalBase: false },
  'europe-western-germany':                   { ic: 'major', airBase: true,  navalBase: true  },
  // ── Italy ─────────────────────────────────────────────────
  'europe-northern-italy':                    { ic: 'major', airBase: false, navalBase: false },
  'europe-southern-italy-rome':               { ic: 'minor', airBase: true,  navalBase: true  },
  // ── Japan ─────────────────────────────────────────────────
  'pacific-japan-tokyo':                      { ic: 'major', airBase: true,  navalBase: true  },
  'pacific-carolines-islands':                { ic: null,    airBase: true,  navalBase: true  },
  // ── Soviet Union ──────────────────────────────────────────
  'europe-russia-moscow':                     { ic: 'major', airBase: true,  navalBase: false },
  'europe-novgorod-leningrad':                { ic: 'minor', airBase: true,  navalBase: true  },
  'europe-ukraine':                           { ic: 'minor', airBase: false, navalBase: false },
  'europe-volgograd':                         { ic: 'minor', airBase: false, navalBase: false },
  // ── United States ─────────────────────────────────────────
  'europe-eastern-united-states-washington':  { ic: 'major', airBase: true,  navalBase: true  },
  'europe-central-united-states':             { ic: 'major', airBase: false, navalBase: false },
  'pacific-western-united-states-san-francisco': { ic: 'major', airBase: true, navalBase: true },
  'pacific-hawaiian-islands-honolulu':        { ic: null,    airBase: true,  navalBase: true  },
  'pacific-philippine-islands-manilla':       { ic: null,    airBase: true,  navalBase: true  },
  'pacific-midway':                           { ic: null,    airBase: true,  navalBase: false },
  'pacific-wake-island':                      { ic: null,    airBase: true,  navalBase: false },
  'pacific-guam':                             { ic: null,    airBase: true,  navalBase: false },
  // ── UK (Europe) ───────────────────────────────────────────
  'europe-united-kingdom-london':             { ic: 'major', airBase: true,  navalBase: true  },
  'europe-quebec':                            { ic: 'minor', airBase: false, navalBase: false },
  'europe-union-of-south-africa':             { ic: 'minor', airBase: false, navalBase: true  },
  'europe-scotland':                          { ic: null,    airBase: true,  navalBase: false },
  'europe-iceland':                           { ic: null,    airBase: true,  navalBase: false },
  'europe-new-brunswick-nova-scotia':         { ic: null,    airBase: false, navalBase: true  },
  'europe-gibraltar':                         { ic: null,    airBase: false, navalBase: true  },
  'europe-egypt':                             { ic: null,    airBase: false, navalBase: true  },
  // ── UK (Pacific) ──────────────────────────────────────────
  'pacific-india-calcutta':                   { ic: 'major', airBase: true,  navalBase: true  },
  'pacific-kwangtung-hong-kong':              { ic: null,    airBase: false, navalBase: true  },
  'pacific-malaya':                           { ic: null,    airBase: false, navalBase: true  },
  // ── France ────────────────────────────────────────────────
  'europe-france-paris':                      { ic: 'major', airBase: true,  navalBase: false },
  'europe-normandy-bordeaux':                 { ic: 'minor', airBase: false, navalBase: true  },
  // ── ANZAC ─────────────────────────────────────────────────
  'pacific-new-south-wales-sydney':           { ic: 'minor', airBase: false, navalBase: true  },
  'pacific-queensland':                       { ic: null,    airBase: true,  navalBase: true  },
  'pacific-new-zealand':                      { ic: null,    airBase: true,  navalBase: true  },
};
