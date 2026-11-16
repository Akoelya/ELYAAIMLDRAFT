import urllib.request
import json
import time
import os
import math
from datetime import datetime, timezone

GMS_BASE = "https://api.gms.moontontech.com/api/gms/source/2669606"
HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}

TIMEFRAME_ENDPOINTS = {
    "1d": "2756567",   # Past 1 Day (Live Hotfix)
    "7d": "2756568",   # Past 7 Days (Current Patch Meta)
    "15d": "2756569",  # Past 15 Days (Bi-Weekly Meta)
    "30d": "2756570",  # Past 30 Days (Monthly Season Baseline)
}

# Verified ID-to-Hero MPL Pro Tournament Intelligence Layer (MPL PH / MPL ID / M-Series Meta Weights & Archetypes)
MPL_PRO_PROFILES = {
    133: {"mpl_tier": "S+", "mpl_presence": 95.0, "flex_lanes": ["Jungle"], "archetype": "Dive / Combo Execution", "pro_note": "MPL Priority Pick/Ban assassin with untargetable combo frames and lethal backline access."},
    132: {"mpl_tier": "S+", "mpl_presence": 90.0, "flex_lanes": ["Roam", "Mid Lane"], "archetype": "Tempo Control / Enchanter", "pro_note": "Top-tier roaming support controller dominating high-rank & MPL scrim ban phases."},
    131: {"mpl_tier": "S",  "mpl_presence": 78.0, "flex_lanes": ["EXP Lane", "Jungle"], "archetype": "Cloud Charge Bruiser", "pro_note": "High-mobility cloud fighter with multi-angle engage and backline disruption."},
    130: {"mpl_tier": "S+", "mpl_presence": 92.5, "flex_lanes": ["Gold Lane"], "archetype": "Hyper-Carry Finisher", "pro_note": "Dominant Gold Lane priority pick with explosive late-game teamfight cleanup."},
    129: {"mpl_tier": "S+", "mpl_presence": 85.0, "flex_lanes": ["Mid Lane"], "archetype": "Global Vision / AoE Stun", "pro_note": "MPL staple mage prized for cross-map scouting, global stun setup, and safe wave clear."},
    128: {"mpl_tier": "S+", "mpl_presence": 84.0, "flex_lanes": ["Roam", "EXP Lane"], "archetype": "Water Catch / Sustain Flex", "pro_note": "Premier MPL flex support/fighter offering single-target displacement and team sustain."},
    127: {"mpl_tier": "S+", "mpl_presence": 88.0, "flex_lanes": ["EXP Lane", "Jungle"], "archetype": "Sacred Beast Brawler", "pro_note": "High-priority MPL flex between EXP and Jungle with massive transformation durability."},
    126: {"mpl_tier": "S+", "mpl_presence": 86.0, "flex_lanes": ["Jungle", "EXP Lane"], "archetype": "Tap/Hold Versatile Assassin", "pro_note": "MPL early-to-mid tempo king with dual-stance burst and bruiser survivability."},
    125: {"mpl_tier": "S+", "mpl_presence": 89.0, "flex_lanes": ["Mid Lane", "Roam"], "archetype": "Lantern Zone / Continuous CC", "pro_note": "Perennial MPL first-phase mage capable of zoning entire choke points around Lord/Turtle."},
    124: {"mpl_tier": "S+", "mpl_presence": 82.0, "flex_lanes": ["Roam"], "archetype": "Global Portal Macro Tank", "pro_note": "Coordinated 5-man MPL nightmare enabling instant 5-man cross-map ganks via portals."},
    123: {"mpl_tier": "S",  "mpl_presence": 71.0, "flex_lanes": ["EXP Lane", "Gold Lane"], "archetype": "HP% Kiting Fighter", "pro_note": "Strong counter-pick into immobile tanky EXP laners and heavy frontline compositions."},
    122: {"mpl_tier": "S+", "mpl_presence": 84.5, "flex_lanes": ["Jungle"], "archetype": "Rift Assassin / Purify Ult", "pro_note": "MPL assassin staple with ultra-fast jungle clear and built-in CC cleanse on ultimate."},
    121: {"mpl_tier": "A",  "mpl_presence": 58.0, "flex_lanes": ["Gold Lane"], "archetype": "Full Barrage Wombo Marksman", "pro_note": "High-ground wombo-combo marksman when paired with AoE setter tanks like Tigreal or Atlas."},
    120: {"mpl_tier": "S",  "mpl_presence": 74.0, "flex_lanes": ["EXP Lane", "Roam"], "archetype": "Final Slash Displacement", "pro_note": "Punishes CC-heavy compositions with endless dash resets and Final Slash displacement."},
    119: {"mpl_tier": "S",  "mpl_presence": 76.0, "flex_lanes": ["Mid Lane", "Roam"], "archetype": "Astral Recall Vision Sniper", "pro_note": "Top MPL vision mage for objective control and sniping squishy carries from fog of war."},
    118: {"mpl_tier": "S+", "mpl_presence": 81.0, "flex_lanes": ["Jungle", "EXP Lane"], "archetype": "Electrifying Beats Dive", "pro_note": "High-skill backline diver that shreds squishy compositions lacking instant suppress."},
    117: {"mpl_tier": "S",  "mpl_presence": 79.0, "flex_lanes": ["Jungle", "EXP Lane"], "archetype": "Utility Tank Jungler", "pro_note": "Go-to MPL frontline jungler when team drafts utility healer roam or damage EXP."},
    116: {"mpl_tier": "S+", "mpl_presence": 83.0, "flex_lanes": ["Jungle", "Mid Lane", "EXP Lane"], "archetype": "3-Skill Hybrid Flex Core", "pro_note": "Ultra-flexible 3-lane MPL staple with level-3 power spike and built-in untargetability."},
    115: {"mpl_tier": "A",  "mpl_presence": 56.0, "flex_lanes": ["Mid Lane"], "archetype": "Dawning Light Global Mage", "pro_note": "Long-range artillery mage effective against low-mobility siege lineups."},
    114: {"mpl_tier": "S",  "mpl_presence": 68.0, "flex_lanes": ["Gold Lane"], "archetype": "Muddles Anti-Dive Marksman", "pro_note": "Strong Gold Lane counter against melee dive fighters using Go Away! barrier."},
    112: {"mpl_tier": "S+", "mpl_presence": 80.0, "flex_lanes": ["Roam"], "archetype": "Global Anti-Antiheal Healer", "pro_note": "Premier MPL pocket healer whose ultimate cleanses anti-heal for hyper-carries and bruisers."},
    111: {"mpl_tier": "S",  "mpl_presence": 74.0, "flex_lanes": ["EXP Lane", "Roam"], "archetype": "Phylax Tank-Marksman Flex", "pro_note": "Classic MPL flex pick offering hard CC initiation and lethal hybrid DPS in ultimate."},
    110: {"mpl_tier": "S+", "mpl_presence": 84.0, "flex_lanes": ["Mid Lane", "EXP Lane"], "archetype": "I Am You Ultimate Hijack", "pro_note": "Ultimate MPL counter-draft weapon against high-impact teamfight ultimates."},
    108: {"mpl_tier": "S+", "mpl_presence": 86.0, "flex_lanes": ["Jungle", "EXP Lane"], "archetype": "Revamped CC-Immune Brawler", "pro_note": "Post-revamp priority powerhouse with unstoppable frontline shred and scaling sustain."},
    107: {"mpl_tier": "S",  "mpl_presence": 72.0, "flex_lanes": ["Gold Lane", "Jungle"], "archetype": "Entropy Magic DPS Carry", "pro_note": "Melting late-game magic marksman with clone repositioning and instant Lord shred."},
    106: {"mpl_tier": "S+", "mpl_presence": 88.0, "flex_lanes": ["EXP Lane"], "archetype": "Demonic Force Anti-Dash King", "pro_note": "The #1 MPL counter-pick against dash-heavy assassins and mobile gold laners."},
    105: {"mpl_tier": "S",  "mpl_presence": 73.0, "flex_lanes": ["Gold Lane", "Mid Lane"], "archetype": "4-Weapon Versatile Marksman", "pro_note": "MPL evergreen marksman with Nibiru wave clear and Renner sniper pressure."},
    104: {"mpl_tier": "S+", "mpl_presence": 82.0, "flex_lanes": ["EXP Lane", "Roam"], "archetype": "Split-Slime Hostage Tank", "pro_note": "Dominant frontline disruptor that isolates enemy carries and zones objectives."},
    103: {"mpl_tier": "S+", "mpl_presence": 86.5, "flex_lanes": ["EXP Lane", "Jungle"], "archetype": "Champ Stance Tempo Bruiser", "pro_note": "MPL ID & PH top-picked comfort staple (90+ appearances) for early turtle pressure and flank burst."},
    102: {"mpl_tier": "S+", "mpl_presence": 83.0, "flex_lanes": ["Roam", "Mid Lane"], "archetype": "Guiding Wind Dash Enabler", "pro_note": "Enables immobile carries with Guiding Wind free dash and high-tempo pickoffs."},
    101: {"mpl_tier": "S",  "mpl_presence": 70.0, "flex_lanes": ["Mid Lane"], "archetype": "Real-World Manipulation Zone", "pro_note": "High-ground AoE slow queen against low-mobility front-to-back team compositions."},
    100: {"mpl_tier": "A",  "mpl_presence": 60.0, "flex_lanes": ["Gold Lane"], "archetype": "Torn-Apart Memory Burst MM", "pro_note": "Lane bully marksman capable of building semi-tank while executing low-HP targets."},
    99:  {"mpl_tier": "A",  "mpl_presence": 58.0, "flex_lanes": ["Jungle", "EXP Lane"], "archetype": "Detona's Welcome Frontline", "pro_note": "Big-body objective tank jungler/EXP that suppresses single targets."},
    98:  {"mpl_tier": "S",  "mpl_presence": 69.0, "flex_lanes": ["EXP Lane", "Roam"], "archetype": "Raging Sandstorm Dive", "pro_note": "MPL EXP/Roam staple for early rotations and diving enemy backlines."},
    97:  {"mpl_tier": "S",  "mpl_presence": 75.0, "flex_lanes": ["EXP Lane", "Jungle"], "archetype": "Alecto Split-Push & Parry", "pro_note": "High-skill MPL sidelaner with An Eye for An Eye CC immunity and instant wave cut."},
    96:  {"mpl_tier": "S+", "mpl_presence": 81.0, "flex_lanes": ["Mid Lane"], "archetype": "Diversion Global Teleport + Yin-Yang", "pro_note": "Top MPL macro mage enabling 5-man bush teleports and clumped enemy pulls."},
    95:  {"mpl_tier": "S",  "mpl_presence": 74.0, "flex_lanes": ["EXP Lane"], "archetype": "Black Dragon Backline Zoning", "pro_note": "Forces enemy backline scatter during Lord dances with Black Dragon Form."},
    93:  {"mpl_tier": "S+", "mpl_presence": 85.0, "flex_lanes": ["Roam"], "archetype": "Fatal Links AoE Setter", "pro_note": "First-phase MPL respect ban & initiation roamer; pulls entire backlines and forces Diggie/Purify."},
    92:  {"mpl_tier": "S+", "mpl_presence": 82.5, "flex_lanes": ["Roam", "Jungle"], "archetype": "Curse of Blood Shared CC/DMG", "pro_note": "Turns single-target CC and burst into 5-man team wipes via Curse of Blood link."},
    89:  {"mpl_tier": "S",  "mpl_presence": 74.0, "flex_lanes": ["Gold Lane"], "archetype": "Crossbow of Tang Untargetable MM", "pro_note": "Punishes immobile frontlines by unlocking Crossbow of Tang team wipes."},
    88:  {"mpl_tier": "S+", "mpl_presence": 93.0, "flex_lanes": ["EXP Lane", "Roam"], "archetype": "3-HP Bar Carry Eraser", "pro_note": "Broken win-rate/ban-rate powerhouse capable of deleting carries and soloing Lord."},
    87:  {"mpl_tier": "A",  "mpl_presence": 62.0, "flex_lanes": ["Jungle", "Roam"], "archetype": "Anti-Heal Rolling Tank", "pro_note": "Direct MPL counter-pick against heavy healing/regen compositions (Estes, Floryn, Lukas)."},
    86:  {"mpl_tier": "A",  "mpl_presence": 60.0, "flex_lanes": ["Mid Lane"], "archetype": "Black Shoes Rewind Bomber", "pro_note": "Early level-1 lane prio mage with Black Shoes full-HP rewind."},
    84:  {"mpl_tier": "S+", "mpl_presence": 81.0, "flex_lanes": ["Jungle"], "archetype": "Tempest of Blades Macro Assassin", "pro_note": "MPL hyper-carry assassin with unmatched macro map pressure and backline execution."},
    82:  {"mpl_tier": "S",  "mpl_presence": 72.0, "flex_lanes": ["EXP Lane"], "archetype": "Penalty Zone AoE Bruiser", "pro_note": "Sturdy MPL frontline EXP laner with Flicker-Penalty Zone teamfight lockdown."},
    80:  {"mpl_tier": "S",  "mpl_presence": 69.0, "flex_lanes": ["EXP Lane", "Roam", "Jungle"], "archetype": "Spatial Migration Knockup", "pro_note": "Strong 3-way flex initiator with CC-immune Spatial Migration combo."},
    79:  {"mpl_tier": "S",  "mpl_presence": 72.0, "flex_lanes": ["Gold Lane", "Jungle"], "archetype": "Revamped Stacking Artillery MM", "pro_note": "Long-range siege artillery marksman that snowballs early turret plates."},
    78:  {"mpl_tier": "S",  "mpl_presence": 75.0, "flex_lanes": ["Roam"], "archetype": "Bouncing Ball Anti-Dash Setter", "pro_note": "Premier anti-dash tank counter against Fanny, Ling, Joy, Harith, and Arlott."},
    76:  {"mpl_tier": "S",  "mpl_presence": 73.0, "flex_lanes": ["Mid Lane", "Roam"], "archetype": "Cult Altar Team Death Immunity", "pro_note": "Anti-burst insurance mage/support whose Nether Realm prevents teamfight wipeouts."},
    75:  {"mpl_tier": "S",  "mpl_presence": 70.0, "flex_lanes": ["Mid Lane", "Roam"], "archetype": "Breath of the Ocean Pickoff", "pro_note": "Deletes enemy carries through Ocean Ode bush ambushes and passive damage reduction."},
    74:  {"mpl_tier": "S",  "mpl_presence": 72.0, "flex_lanes": ["Roam", "EXP Lane"], "archetype": "King's Calling No-Blink Arena", "pro_note": "Hard-counters dash-reliant assassins and fighters with grounded royal arena."},
    73:  {"mpl_tier": "S+", "mpl_presence": 84.0, "flex_lanes": ["Gold Lane", "Mid Lane"], "archetype": "Zaman Force Dash DPS Mage", "pro_note": "Top MPL Gold/Mid flex carry dominating lane trades and mid-game skirmishes."},
    70:  {"mpl_tier": "S+", "mpl_presence": 86.0, "flex_lanes": ["Roam", "EXP Lane"], "archetype": "Deadly Thorns Taunt Frontline", "pro_note": "Massive patch priority tank that punishes high-attack-speed marksmen and melee divers."},
    68:  {"mpl_tier": "A",  "mpl_presence": 63.0, "flex_lanes": ["Mid Lane", "Gold Lane", "Jungle"], "archetype": "Order & Chaos Tank Melter", "pro_note": "Shreds high-HP frontlines with Chaos Assault percentage penetration."},
    65:  {"mpl_tier": "S+", "mpl_presence": 82.0, "flex_lanes": ["Gold Lane"], "archetype": "Blazing Duet Mobility Marksman", "pro_note": "MPL Gold Lane staple prized for safe laning, Battle Mirror Image outplays, and late-game teamfight AoE."},
    63:  {"mpl_tier": "S",  "mpl_presence": 76.0, "flex_lanes": ["Roam", "Mid Lane"], "archetype": "Abyssal Arrow Pickoff / Vision", "pro_note": "High-pressure early invader and vision provider for pick-off compositions."},
    62:  {"mpl_tier": "S",  "mpl_presence": 75.0, "flex_lanes": ["Roam", "EXP Lane"], "archetype": "Divine Judgment Suppress Lock", "pro_note": "Point-and-click suppression lock to neutralize hyper-mobile assassins."},
    57:  {"mpl_tier": "S",  "mpl_presence": 72.0, "flex_lanes": ["Mid Lane", "Roam"], "archetype": "Vengeance Flame Anti-Dive", "pro_note": "Shuts down melee dive and tank engage compositions with relentless knockbacks."},
    55:  {"mpl_tier": "S+", "mpl_presence": 85.0, "flex_lanes": ["Roam", "Mid Lane"], "archetype": "Heartguard Global Pocket Support", "pro_note": "Creates unkillable raid-boss hyper-carries when paired with mobile assassins or fighters."},
    54:  {"mpl_tier": "S",  "mpl_presence": 69.0, "flex_lanes": ["Roam", "EXP Lane", "Jungle"], "archetype": "Ejector + Unstoppable Force Pickoff", "pro_note": "Early invade terror with point-and-click Unstoppable Force lock and Ejector toss."},
    52:  {"mpl_tier": "S",  "mpl_presence": 71.0, "flex_lanes": ["Mid Lane"], "archetype": "Feathered Air Strike High-Ground", "pro_note": "Fast-rotating bird mage with elite high-ground defense and siege zone control."},
    49:  {"mpl_tier": "S",  "mpl_presence": 74.0, "flex_lanes": ["Roam", "EXP Lane"], "archetype": "Glorious Pathway Raid-Boss Tank", "pro_note": "Massive HP pool frontliner that accelerates team engage and slows attack speed."},
    48:  {"mpl_tier": "S+", "mpl_presence": 78.0, "flex_lanes": ["Roam"], "archetype": "Time Journey Teamwide Purify", "pro_note": "The ultimate counter-pick that completely invalidates AoE setter tanks (Atlas, Tigreal, Mino)."},
    47:  {"mpl_tier": "A",  "mpl_presence": 62.0, "flex_lanes": ["Jungle"], "archetype": "Puncture Dash Reset Assassin", "pro_note": "High-mobility assassin capable of dashing through frontlines to snipe carries."},
    41:  {"mpl_tier": "S",  "mpl_presence": 68.0, "flex_lanes": ["EXP Lane", "Roam"], "archetype": "Avatar of the Guardian Dive Tank", "pro_note": "Global jump-in tank/fighter with passive rage sustain and AoE taunt."},
    40:  {"mpl_tier": "S",  "mpl_presence": 74.0, "flex_lanes": ["Gold Lane"], "archetype": "Lightwheel True-Damage Tank Shred", "pro_note": "Premier tank-melting marksman against heavy HP frontline drafts."},
    39:  {"mpl_tier": "S",  "mpl_presence": 70.0, "flex_lanes": ["Gold Lane", "Jungle"], "archetype": "Wolf Transformation Finisher", "pro_note": "Dominant early-to-mid game hybrid marksman/fighter with dodge frames."},
    38:  {"mpl_tier": "S",  "mpl_presence": 69.0, "flex_lanes": ["Mid Lane"], "archetype": "Eternal Guard Lord Summoner", "pro_note": "Instant wave clear mage with AoE terrify CC and Eternal Guard mini-tank."},
    37:  {"mpl_tier": "S",  "mpl_presence": 72.0, "flex_lanes": ["EXP Lane"], "archetype": "Bravest Fighter CC-Immune Dive", "pro_note": "MPL tournament classic with CC-immune ultimate dive and high spell-vamp sustain."},
    35:  {"mpl_tier": "S",  "mpl_presence": 68.0, "flex_lanes": ["Roam", "EXP Lane"], "archetype": "Bush Invade Jungle Harasser", "pro_note": "Punishes weak early-game assassin junglers by invading buffs from level 1."},
    34:  {"mpl_tier": "S",  "mpl_presence": 72.0, "flex_lanes": ["Roam"], "archetype": "Moonlight Immersion Deathball", "pro_note": "Defines 5-man sustain deathball compositions; demands heavy anti-heal and AoE burst to stop."},
    31:  {"mpl_tier": "S",  "mpl_presence": 73.0, "flex_lanes": ["Gold Lane"], "archetype": "Spear of Destruction Teleport MM", "pro_note": "Global cross-map finisher with relentless late-game attack-speed scaling and stun lock."},
    30:  {"mpl_tier": "S",  "mpl_presence": 73.0, "flex_lanes": ["Jungle"], "archetype": "Mountain Shocker Global Vision", "pro_note": "Provides instant 5-man map vision and objective security in coordinated MPL play."},
    29:  {"mpl_tier": "S",  "mpl_presence": 72.0, "flex_lanes": ["EXP Lane", "Roam", "Gold Lane"], "archetype": "I'm Offended! Spell-Vamp Pull", "pro_note": "High-sustain disruption bruiser with knockbacks and Flicker-Ult AoE pull."},
    27:  {"mpl_tier": "S+", "mpl_presence": 79.0, "flex_lanes": ["EXP Lane", "Jungle"], "archetype": "Clone Split-Push & Turret Melter", "pro_note": "Surging patch win-rate/ban-rate bruiser that dominates 1v1 sidelanes and melts objectives."},
    26:  {"mpl_tier": "S",  "mpl_presence": 77.0, "flex_lanes": ["Roam", "EXP Lane"], "archetype": "The Way of Dragon Pickoff Icon", "pro_note": "Signature MPL playmaker capable of kicking priority targets into the team."},
    22:  {"mpl_tier": "S+", "mpl_presence": 92.0, "flex_lanes": ["EXP Lane", "Jungle", "Gold Lane"], "archetype": "Valkyrie Descent 1v9 Menace", "pro_note": "Universal MPL respect ban (80%+ ban rate in MPL PH/ID) with terrifying turret-melting speed and 1v5 dive."},
    21:  {"mpl_tier": "S+", "mpl_presence": 84.0, "flex_lanes": ["Jungle"], "archetype": "Quad Shadow Split-Push Assassin", "pro_note": "Top-priority MPL safe-blind-pick assassin with unmatched outplay and sidelane pressure."},
    20:  {"mpl_tier": "S",  "mpl_presence": 71.0, "flex_lanes": ["Roam"], "archetype": "Noumenon Shield Projectile Reflect", "pro_note": "Hard-counters projectile marksmen and mages (Kimmy, Granger, Chang'e, Moskov, Natan)."},
    19:  {"mpl_tier": "S+", "mpl_presence": 81.5, "flex_lanes": ["Roam"], "archetype": "Minoan Fury Heal + Triple Knockup", "pro_note": "Combines AoE setter knockups with sustain healing and rage durability."},
    17:  {"mpl_tier": "S+", "mpl_presence": 86.0, "flex_lanes": ["Jungle"], "archetype": "Steel Cable Map Cutthroat", "pro_note": "Devastating last-pick MPL cheese assassin when enemy lacks Khufra/Franco/Saber/Minsitthar."},
    15:  {"mpl_tier": "S+", "mpl_presence": 82.0, "flex_lanes": ["Mid Lane"], "archetype": "Revamped Superconductor Stun/Burst", "pro_note": "Post-revamp high-ban-rate burst mage that deletes divers and chains multi-target lightning."},
    14:  {"mpl_tier": "S",  "mpl_presence": 75.0, "flex_lanes": ["Roam"], "archetype": "Holy Healing Speed-Boost Cleanse", "pro_note": "High-win-rate tempo support providing anti-slow cleanse and rapid rotation speed."},
    13:  {"mpl_tier": "A",  "mpl_presence": 60.0, "flex_lanes": ["Gold Lane"], "archetype": "Quick Draw Burst Marksman", "pro_note": "Safe long-range poke marksman that dominates squishy Gold Lane matchups."},
    12:  {"mpl_tier": "S+", "mpl_presence": 83.0, "flex_lanes": ["Gold Lane"], "archetype": "Volley Shot Crit Hyper-Carry", "pro_note": "MPL Finals favorite marksman with dominant laning phase and explosive crit scaling."},
    10:  {"mpl_tier": "A",  "mpl_presence": 62.0, "flex_lanes": ["Roam"], "archetype": "Iron Hook + Bloody Hunt Suppress", "pro_note": "Single-target hook and suppression specialist that punishes assassin junglers."},
    9:   {"mpl_tier": "A",  "mpl_presence": 61.0, "flex_lanes": ["Roam", "Jungle"], "archetype": "Heavy Spin Pinball Disengage", "pro_note": "Disrupts enemy dive and pins priority targets against terrain during Lord dances."},
    6:   {"mpl_tier": "S",  "mpl_presence": 72.0, "flex_lanes": ["Roam"], "archetype": "Implosion Flash-Ult Setter", "pro_note": "Punishes clumped teams lacking Purify or Diggie with game-winning 5-man Implosions."},
    4:   {"mpl_tier": "S",  "mpl_presence": 71.0, "flex_lanes": ["EXP Lane", "Jungle", "Gold Lane"], "archetype": "Flowing Blood Raid-Boss Mage", "pro_note": "Scales into an unkillable late-game drain-tank mage that thrives in extended fights."},
    3:   {"mpl_tier": "A",  "mpl_presence": 64.0, "flex_lanes": ["Jungle", "Roam"], "archetype": "Triple Sweep Instant Lockdown", "pro_note": "Point-and-click execution counter against fragile hyper-mobile assassins (Hirara, Fanny, Ling)."},
}

def fetch_gms(endpoint_id, payload, retries=3):
    url = f"{GMS_BASE}/{endpoint_id}"
    data = json.dumps(payload).encode("utf-8")
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            if attempt == retries - 1:
                raise e
            time.sleep(1)

def normalize_lane(lane_title):
    if not lane_title:
        return ""
    t = lane_title.strip().lower()
    if "exp" in t:
        return "EXP Lane"
    if "mid" in t:
        return "Mid Lane"
    if "roam" in t:
        return "Roam"
    if "jungle" in t:
        return "Jungle"
    if "gold" in t:
        return "Gold Lane"
    return lane_title.strip()

def compute_time_scaling(sub_list):
    """Computes Early (6-12m), Mid (12-16m), and Late (16-20m+) win-rate power curve from Moonton sub_hero buckets."""
    if not sub_list:
        return {"early": 50.0, "mid": 50.0, "late": 50.0}
    early_vals, mid_vals, late_vals = [], [], []
    for item in sub_list:
        for k in ["min_win_rate6_8", "min_win_rate8_10", "min_win_rate10_12"]:
            v = item.get(k, 0)
            if v and 0.2 < v < 0.85:
                early_vals.append(v * 100)
        for k in ["min_win_rate12_14", "min_win_rate14_16"]:
            v = item.get(k, 0)
            if v and 0.2 < v < 0.85:
                mid_vals.append(v * 100)
        for k in ["min_win_rate16_18", "min_win_rate18_20", "min_win_rate20"]:
            v = item.get(k, 0)
            if v and 0.2 < v < 0.85:
                late_vals.append(v * 100)
    return {
        "early": round(sum(early_vals) / len(early_vals), 2) if early_vals else 50.0,
        "mid": round(sum(mid_vals) / len(mid_vals), 2) if mid_vals else 50.0,
        "late": round(sum(late_vals) / len(late_vals), 2) if late_vals else 50.0,
    }

def build_full_meta_dataset(output_dir="data"):
    os.makedirs(output_dir, exist_ok=True)
    t_start = time.time()
    print("[ElyaSync] 1/3 Fetching Official MLBB Hero Catalog (2756564)...")
    d64 = fetch_gms("2756564", {"pageSize": 200, "pageIndex": 1})
    hero_records = d64.get("data", {}).get("records", [])

    heroes_by_id = {}
    catalog_order = []

    for idx, r in enumerate(hero_records):
        rd = r.get("data", {})
        hd = rd.get("hero", {}).get("data", {})
        hid = rd.get("hero_id") or hd.get("heroid")
        if not hid:
            continue
        catalog_order.append(hid)

        lanes = []
        for x in hd.get("roadsort", []):
            if isinstance(x, dict) and "data" in x and "road_sort_title" in x["data"]:
                ln = normalize_lane(x["data"]["road_sort_title"])
                if ln and ln not in lanes:
                    lanes.append(ln)

        roles = []
        for x in hd.get("sortid", []):
            if isinstance(x, dict) and "data" in x and "sort_title" in x["data"]:
                rl = x["data"]["sort_title"].strip().title()
                if rl and rl not in roles:
                    roles.append(rl)

        abilities = hd.get("abilityshow", ["50", "50", "50", "50"])
        try:
            durability = int(abilities[0])
            offense = int(abilities[1])
            control = int(abilities[2])
            difficulty = int(abilities[3])
        except Exception:
            durability, offense, control, difficulty = 50, 50, 50, 50

        rel = rd.get("relation", {})
        assist_ids = [x for x in (rel.get("assist", {}).get("target_hero_id") or []) if isinstance(x, int) and x > 0]
        strong_ids = [x for x in (rel.get("strong", {}).get("target_hero_id") or []) if isinstance(x, int) and x > 0]
        weak_ids = [x for x in (rel.get("weak", {}).get("target_hero_id") or []) if isinstance(x, int) and x > 0]

        mpl_prof = MPL_PRO_PROFILES.get(hid, {})
        flex_lanes = list(lanes)
        for fl in mpl_prof.get("flex_lanes", []):
            nfl = normalize_lane(fl)
            if nfl and nfl not in flex_lanes:
                flex_lanes.append(nfl)

        head_url = hd.get("head") or rd.get("head") or ""
        painting_url = hd.get("painting") or rd.get("painting") or head_url

        heroes_by_id[hid] = {
            "id": hid,
            "name": hd.get("name", f"Hero {hid}"),
            "head": head_url,
            "painting": painting_url,
            "lanes": lanes if lanes else ["EXP Lane"],
            "flex_lanes": flex_lanes if flex_lanes else ["EXP Lane"],
            "roles": roles if roles else ["Fighter"],
            "specialties": [s for s in hd.get("speciality", []) if s],
            "stats_rating": {
                "durability": durability,
                "offense": offense,
                "control": control,
                "difficulty": difficulty,
            },
            "lore_relations": {
                "assist_ids": assist_ids,
                "assist_desc": rel.get("assist", {}).get("desc", ""),
                "strong_ids": strong_ids,
                "strong_desc": rel.get("strong", {}).get("desc", ""),
                "weak_ids": weak_ids,
                "weak_desc": rel.get("weak", {}).get("desc", ""),
            },
            "is_recent_patch_focus": idx < 12,
            "updated_at": hd.get("_updatedAt") or r.get("createdAt") or 0,
            "mpl": {
                "tier_override": mpl_prof.get("mpl_tier"),
                "pro_presence": mpl_prof.get("mpl_presence", 0.0),
                "archetype": mpl_prof.get("archetype", "Standard Meta"),
                "pro_note": mpl_prof.get("pro_note", ""),
            },
            "timeframes": {}
        }

    print(f"[ElyaSync] 2/3 Fetching Live Mythical Glory+ Matchup & Meta Matrices across {len(TIMEFRAME_ENDPOINTS)} timeframes...")
    for tf_key, ep_id in TIMEFRAME_ENDPOINTS.items():
        print(f"  -> Syncing timeframe '{tf_key}' (endpoint {ep_id})...")
        resp = fetch_gms(ep_id, {
            "pageSize": 400,
            "pageIndex": 1,
            "filters": [{"field": "bigrank", "operator": "eq", "value": "9"}]
        })
        recs = resp.get("data", {}).get("records", [])
        for r in recs:
            rd = r.get("data", {})
            hid = rd.get("main_heroid")
            if hid not in heroes_by_id:
                continue
            camp_type = str(rd.get("camp_type", "0"))
            tf_entry = heroes_by_id[hid]["timeframes"].setdefault(tf_key, {
                "win_rate": 50.0,
                "ban_rate": 0.0,
                "appearance_rate": 0.0,
                "pick_rate": 0.0,
                "counters_beaten": [],
                "countered_by": [],
                "best_teammates": [],
                "worst_teammates": [],
                "scaling": {"early": 50.0, "mid": 50.0, "late": 50.0}
            })

            wr = round((rd.get("main_hero_win_rate") or 0.5) * 100, 2)
            br = round((rd.get("main_hero_ban_rate") or 0.0) * 100, 2)
            ar = round((rd.get("main_hero_appearance_rate") or 0.0) * 100, 3)
            pr = round(min(99.9, ar * 10.0), 2)

            tf_entry["win_rate"] = wr
            tf_entry["ban_rate"] = br
            tf_entry["appearance_rate"] = ar
            tf_entry["pick_rate"] = pr

            sub_pos = rd.get("sub_hero") or []
            sub_neg = rd.get("sub_hero_last") or []

            if camp_type == "0":
                tf_entry["counters_beaten"] = [
                    {
                        "heroid": x.get("heroid"),
                        "delta_wr": round((x.get("increase_win_rate") or 0) * 100, 2),
                        "match_wr": round((x.get("hero_win_rate") or 0.5) * 100, 2)
                    }
                    for x in sub_pos if x.get("heroid")
                ]
                tf_entry["countered_by"] = [
                    {
                        "heroid": x.get("heroid"),
                        "delta_wr": round((x.get("increase_win_rate") or 0) * 100, 2),
                        "match_wr": round((x.get("hero_win_rate") or 0.5) * 100, 2)
                    }
                    for x in sub_neg if x.get("heroid")
                ]
                tf_entry["scaling"] = compute_time_scaling(sub_pos)
            elif camp_type == "1":
                tf_entry["best_teammates"] = [
                    {
                        "heroid": x.get("heroid"),
                        "delta_wr": round((x.get("increase_win_rate") or 0) * 100, 2),
                        "match_wr": round((x.get("hero_win_rate") or 0.5) * 100, 2)
                    }
                    for x in sub_pos if x.get("heroid")
                ]
                tf_entry["worst_teammates"] = [
                    {
                        "heroid": x.get("heroid"),
                        "delta_wr": round((x.get("increase_win_rate") or 0) * 100, 2),
                        "match_wr": round((x.get("hero_win_rate") or 0.5) * 100, 2)
                    }
                    for x in sub_neg if x.get("heroid")
                ]

    print("[ElyaSync] 3/3 Computing Hybrid MPL + Live Patch Meta Scores & Patch Trend Deltas...")
    for hid, h in heroes_by_id.items():
        tf_7d = h["timeframes"].get("7d") or h["timeframes"].get("1d") or {}
        tf_1d = h["timeframes"].get("1d") or tf_7d
        tf_30d = h["timeframes"].get("30d") or tf_7d

        wr_7d = tf_7d.get("win_rate", 50.0)
        br_7d = tf_7d.get("ban_rate", 0.0)
        pr_7d = tf_7d.get("pick_rate", 5.0)

        wr_delta = round(tf_1d.get("win_rate", wr_7d) - tf_30d.get("win_rate", wr_7d), 2)
        br_delta = round(tf_1d.get("ban_rate", br_7d) - tf_30d.get("ban_rate", br_7d), 2)

        wr_score = max(0.0, min(45.0, (wr_7d - 44.0) * 3.2))
        br_score = min(35.0, math.sqrt(max(0.0, br_7d)) * 3.85)
        pr_score = min(20.0, pr_7d * 0.85)
        live_patch_score = round(wr_score + br_score + pr_score, 2)

        mpl_pres = h["mpl"]["pro_presence"]
        if mpl_pres > 0:
            hybrid_score = round(live_patch_score * 0.62 + (mpl_pres * 0.38), 2)
        else:
            derived_pres = round(min(92.0, br_7d * 0.85 + pr_7d * 1.6 + max(0, (wr_7d - 50) * 2.5)), 1)
            h["mpl"]["pro_presence"] = derived_pres
            hybrid_score = round(live_patch_score * 0.78 + (derived_pres * 0.22), 2)

        if hybrid_score >= 66.0 or br_7d >= 35.0 or (wr_7d >= 54.5 and pr_7d >= 8.0):
            tier = "S+"
        elif hybrid_score >= 52.0 or br_7d >= 10.0 or (wr_7d >= 52.5 and pr_7d >= 7.0):
            tier = "S"
        elif hybrid_score >= 38.0 or wr_7d >= 50.5 or pr_7d >= 9.0:
            tier = "A"
        elif hybrid_score >= 25.0 or wr_7d >= 48.0:
            tier = "B"
        else:
            tier = "C"

        if h["is_recent_patch_focus"] and (br_7d >= 15.0 or wr_7d >= 51.0):
            patch_trend = "NEW / REVAMPED"
        elif wr_delta >= 1.2 or br_delta >= 4.0:
            patch_trend = "BUFFED / RISING"
        elif wr_delta <= -1.2 or br_delta <= -4.0:
            patch_trend = "NERFED / FALLING"
        else:
            patch_trend = "STABLE"

        h["meta_summary"] = {
            "tier": tier,
            "hybrid_score": hybrid_score,
            "live_patch_score": live_patch_score,
            "win_rate": wr_7d,
            "ban_rate": br_7d,
            "pick_rate": pr_7d,
            "contest_rate": round(min(99.9, br_7d + pr_7d), 2),
            "wr_delta_30d": wr_delta,
            "br_delta_30d": br_delta,
            "patch_trend": patch_trend,
            "flex_count": len(h["flex_lanes"])
        }

    sorted_heroes = sorted(heroes_by_id.values(), key=lambda x: x["meta_summary"]["hybrid_score"], reverse=True)

    payload = {
        "app": "ElyaDraftSimulator",
        "version": "2.7.0-MPL-GodMode",
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "source_api": f"{GMS_BASE}/2756564..2756570",
        "hero_count": len(sorted_heroes),
        "latest_hero": heroes_by_id.get(max(heroes_by_id.keys()), {}).get("name", "Hirara"),
        "recent_patch_focus_ids": catalog_order[:12],
        "heroes": sorted_heroes
    }

    json_path = os.path.join(output_dir, "mlbb_meta.json")
    js_path = os.path.join(output_dir, "mlbb_meta.js")

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    with open(js_path, "w", encoding="utf-8") as f:
        f.write("window.ELYA_INITIAL_META = ")
        json.dump(payload, f, ensure_ascii=False)
        f.write(";\n")

    elapsed = round(time.time() - t_start, 2)
    print(f"[ElyaSync] Done in {elapsed}s! Saved {len(sorted_heroes)} heroes to {json_path} and {js_path}.")
    return payload

if __name__ == "__main__":
    build_full_meta_dataset()
