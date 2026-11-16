/**
 * ElyaDraftSimulator — MPL Pro Meta & Live MLBB Patch Draft Engine
 * Powered by Official Moonton GMS Live API (2756564..2756570) + MPL Pro Tournament Intelligence
 */

(function () {
  "use strict";

  const ALL_LANES = ["EXP Lane", "Jungle", "Mid Lane", "Gold Lane", "Roam"];
  const LANE_ICONS = {
    "EXP Lane": "⚔️",
    "Jungle": "🗡️",
    "Mid Lane": "🔮",
    "Gold Lane": "🏹",
    "Roam": "🛡️"
  };
  const LANE_SHORT = {
    "EXP Lane": "EXP",
    "Jungle": "JGL",
    "Mid Lane": "MID",
    "Gold Lane": "GOLD",
    "Roam": "ROAM"
  };

  // Trained MPL PH Season 18 Playoff Intelligence Model (window.ELYA_MPL_MODEL)
  const MPL_PH_MODEL =
    typeof window !== "undefined" && window.ELYA_MPL_MODEL ? window.ELYA_MPL_MODEL : null;
  const MPL_GOLD_FLEX_IDS = new Set(
    MPL_PH_MODEL && Array.isArray(MPL_PH_MODEL.gold_flex_hero_ids)
      ? MPL_PH_MODEL.gold_flex_hero_ids
      : [4, 22, 71, 73, 81, 102, 123, 125]
  );
  const MPL_PRIMARY_TANK_IDS = new Set([93, 6, 19, 78, 70, 49, 104, 41, 59, 99, 87, 9, 20, 10, 32, 111, 124, 117]);

  function getMplModelHero(heroId) {
    return (MPL_PH_MODEL && MPL_PH_MODEL.heroes && MPL_PH_MODEL.heroes[String(heroId)]) || null;
  }

  function isGoldCarryCapable(hero) {
    return Boolean(hero && (hero.roles.includes("Marksman") || MPL_GOLD_FLEX_IDS.has(hero.id)));
  }

  function clampVal(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function evaluateMplTrainedBanEdge(
    hero,
    isPhase2,
    activeBlueprint,
    allyPicks,
    enemyPicks,
    unavailableSet,
    enemyMissingLanes
  ) {
    if (!MPL_PH_MODEL) return { score: 0, tag: null };
    let score = 0;
    let bestTag = null;
    let bestPriority = -1;

    const canEnemyPlayHero =
      !enemyMissingLanes ||
      enemyMissingLanes.length === 0 ||
      hero.flex_lanes.some((ln) => enemyMissingLanes.includes(ln));

    const mh = getMplModelHero(hero.id);
    if (mh && mh.presence_count > 0) {
      if (!isPhase2 && mh.presence_rate >= 40) {
        const p1Score = mh.slot13_ban_share * (mh.priority_score * 0.24);
        score += p1Score;
        if (p1Score >= 13 && p1Score > bestPriority) {
          bestPriority = p1Score;
          bestTag = {
            type: "warn-counter",
            text: `🏆 MPL PH P1 Priority: ${hero.name} (${mh.presence_rate.toFixed(0)}% Pres)`
          };
        }
      } else if (isPhase2 && mh.bans >= 3 && mh.slot45_ban_share >= 0.52) {
        const p2Score = mh.slot45_ban_share * Math.min(24.0, mh.bans * 1.9);
        score += p2Score;
        if (p2Score >= 11 && p2Score > bestPriority) {
          bestPriority = p2Score;
          bestTag = {
            type: "mpl-priority",
            text: `🎯 MPL PH P2 Pinch: ${hero.name} (${mh.b2_bans} Late Bans)`
          };
        }
      }
    }

    // 1. Lethal Meta Combo-Breaker & Self-Protection Bans (e.g. Kimmy+Estes, Zhuxin+Carmilla, Atlas+Lylia)
    if (Array.isArray(MPL_PH_MODEL.lethal_combos)) {
      for (const lc of MPL_PH_MODEL.lethal_combos) {
        const enemyCores = enemyPicks.filter((id) => lc.core_ids.includes(id));
        if (enemyCores.length > 0 && canEnemyPlayHero) {
          if (lc.core_ids.includes(hero.id) && !enemyPicks.includes(hero.id)) {
            const breakScore = lc.ban_break_bonus * (enemyCores.length >= 2 ? 1.22 : 1.0);
            score += breakScore;
            if (breakScore > bestPriority) {
              bestPriority = breakScore;
              bestTag = {
                type: "warn-counter",
                text: `🛑 Combo-Breaker Ban: Blocks ${lc.name}`
              };
            }
          } else if (enemyCores.length >= 2 && lc.enabler_ids.includes(hero.id)) {
            const enablerBreak = lc.ban_break_bonus * 0.65;
            score += enablerBreak;
          }
        }

        // Self-Protection Ban: if we locked/plan a Lethal Combo, ban its exact hard counters!
        const allyCores = allyPicks.filter((id) => lc.core_ids.includes(id));
        if (allyCores.length > 0 && Array.isArray(lc.counters_to_ban) && lc.counters_to_ban.includes(hero.id)) {
          const otherCoreOpen = lc.core_ids.some(
            (cid) => !allyPicks.includes(cid) && (!unavailableSet || !unavailableSet.has(cid))
          );
          if (allyCores.length >= 2 || otherCoreOpen) {
            const shieldScore = allyCores.length >= 2 ? 36.0 : 21.0;
            score += shieldScore;
            if (shieldScore > bestPriority) {
              bestPriority = shieldScore;
              bestTag = {
                type: "warn-counter",
                text:
                  allyCores.length >= 2
                    ? `🛡️ Combo Shield: Protects ${lc.name} vs ${hero.name}`
                    : `🛡️ Combo Prep Ban: Clears ${hero.name} for ${lc.name}`
              };
            }
          }
        }
      }
    }

    // 2. S18 Championship 3-Hero Trio-Breaker Ban
    if (canEnemyPlayHero && Array.isArray(MPL_PH_MODEL.trios)) {
      for (const trio of MPL_PH_MODEL.trios) {
        if (!trio.hero_ids.includes(hero.id)) continue;
        const enemyHeld = trio.hero_ids.filter((id) => enemyPicks.includes(id)).length;
        if (enemyHeld >= 2) {
          const trioBreak = 34.0;
          score += trioBreak;
          if (trioBreak > bestPriority) {
            bestPriority = trioBreak;
            bestTag = {
              type: "warn-counter",
              text: `🛑 Trio-Breaker: Blocks S18 ${trio.raw_wr}% WR Trio (${trio.heroes.join("+")})`
            };
          }
        }
      }
    }

    // 3. Comp-Connected Protective Bans: remove threats to locked allies AND desired blueprint cores
    const desiredCores = [];
    for (const id of allyPicks) desiredCores.push({ id, weight: 0.95, locked: true });
    if (activeBlueprint && activeBlueprint.core_ids) {
      let plannedAdded = 0;
      for (const cid of activeBlueprint.core_ids) {
        if (allyPicks.includes(cid) || (unavailableSet && unavailableSet.has(cid))) continue;
        desiredCores.push({ id: cid, weight: 0.45, locked: false });
        plannedAdded++;
        if (plannedAdded >= 3) break;
      }
    }

    let protectBonus = 0;
    for (const core of desiredCores) {
      const plist = MPL_PH_MODEL.protective_bans && MPL_PH_MODEL.protective_bans[String(core.id)];
      if (!plist) continue;
      const match = plist.find((e) => e.ban_id === hero.id);
      if (match) {
        const contrib = Math.min(24.0, match.score * 0.78) * core.weight;
        protectBonus += contrib;
        if (contrib > bestPriority) {
          bestPriority = contrib;
          const coreObj = state.heroMap && state.heroMap.get(core.id);
          const coreLabel = coreObj ? coreObj.name : activeBlueprint.shortName;
          bestTag = {
            type: "warn-counter",
            text: core.locked
              ? `🛡️ Protects ${coreLabel} (${match.cond_rate}% MPL Ban)`
              : `🛡️ Protects ${activeBlueprint.shortName} Plan (${match.ban_name})`
          };
        }
      }
    }
    score += Math.min(34.0, protectBonus);

    // 4. Enemy-Plan Denial Bans & Opponent Fear-Bans
    let denialBonus = 0;
    for (const eid of enemyPicks) {
      const dlist = MPL_PH_MODEL.denial_bans && MPL_PH_MODEL.denial_bans[String(eid)];
      if (dlist && canEnemyPlayHero) {
        const match = dlist.find((e) => e.ban_id === hero.id);
        if (match) {
          const contrib = Math.min(26.0, match.score * 0.85);
          denialBonus += contrib;
          if (contrib > bestPriority) {
            bestPriority = contrib;
            const eObj = state.heroMap && state.heroMap.get(eid);
            bestTag = {
              type: "warn-counter",
              text: match.combo_name
                ? `🛑 Breaks Enemy ${match.combo_name}`
                : `🛑 Breaks ${eObj ? eObj.name : "Enemy"} Duo (${match.pair_wr}% MPL WR)`
            };
          }
        }
      }
      const flist = MPL_PH_MODEL.fear_bans && MPL_PH_MODEL.fear_bans[String(eid)];
      if (flist && canEnemyPlayHero) {
        const fmatch = flist.find((e) => e.ban_id === hero.id);
        if (fmatch) {
          score += Math.min(16.0, fmatch.score * 0.65);
        }
      }
    }
    score += Math.min(32.0, denialBonus);

    for (const aid of allyPicks) {
      const threat = MPL_PH_MODEL.counters && MPL_PH_MODEL.counters[`${hero.id}_${aid}`];
      if (threat && threat.lift >= 3.0) {
        const thrEdge = Math.min(18.0, threat.lift * 1.25);
        score += thrEdge;
        if (thrEdge > bestPriority) {
          bestPriority = thrEdge;
          bestTag = {
            type: "warn-counter",
            text: `⚠️ MPL Threat vs ${threat.opponent} (${threat.wins}-${threat.games - threat.wins})`
          };
        }
      }
    }

    const archInfo = activeBlueprint && MPL_PH_MODEL.archetypes && MPL_PH_MODEL.archetypes[activeBlueprint.key];
    if (archInfo && Array.isArray(archInfo.protective_ban_ids) && archInfo.protective_ban_ids.includes(hero.id)) {
      score += 8.0;
    }

    return { score, tag: bestTag };
  }

  function evaluateMplTrainedPickEdge(
    hero,
    allyPicks,
    enemyPicks,
    aiStyle,
    allyMissingLanes,
    unavailableSet
  ) {
    if (!MPL_PH_MODEL) return { score: 0, tag: null };
    let score = 0;
    let bestTag = null;
    let bestWeight = 0;

    const fitsOpenAllyLane =
      !allyMissingLanes ||
      allyMissingLanes.length === 0 ||
      (hero.flex_lanes.some((ln) => allyMissingLanes.includes(ln)) &&
        canAssignDistinctFlexLanes(allyPicks, hero.id));

    const mh = getMplModelHero(hero.id);
    if (mh) {
      if (mh.presence_count > 0) {
        score += (mh.eb_win_rate - 50.0) * 0.68 + mh.presence_rate * 0.16;
      } else if (aiStyle === "mpl_ph") {
        score -= 5.5;
      }
    }

    // 1. Lethal Meta Combo Completion & Enemy Combo Steal (Kimmy+Estes, Zhuxin+Carmilla, Atlas+Lylia, etc.)
    if (fitsOpenAllyLane && Array.isArray(MPL_PH_MODEL.lethal_combos)) {
      for (const lc of MPL_PH_MODEL.lethal_combos) {
        const allyCores = allyPicks.filter((id) => lc.core_ids.includes(id));
        const enemyHasComboCounter =
          Array.isArray(lc.counters_to_ban) &&
          lc.counters_to_ban.some((cid) => enemyPicks.includes(cid));
        const counterMod = enemyHasComboCounter ? 0.38 : 1.0;
        if (allyCores.length > 0 && lc.core_ids.includes(hero.id)) {
          const comboBoost = lc.pick_bonus * (allyCores.length >= 2 ? 1.25 : 1.0) * counterMod;
          score += comboBoost;
          if (comboBoost > bestWeight) {
            bestWeight = comboBoost;
            bestTag = {
              type: "synergy-good",
              text: `🔥 Lethal Combo: ${lc.name} (${lc.tier})`
            };
          }
        } else if (allyCores.length >= 2 && lc.enabler_ids.includes(hero.id)) {
          const enablerBoost = lc.pick_bonus * 0.58;
          score += enablerBoost;
          if (enablerBoost > bestWeight) {
            bestWeight = enablerBoost;
            bestTag = {
              type: "synergy-good",
              text: `🧩 Completes ${lc.name} Enabler`
            };
          }
        } else if (
          allyPicks.length <= 2 &&
          lc.tier === "S+" &&
          lc.core_ids.includes(hero.id) &&
          lc.core_ids.some((cid) => cid !== hero.id && (!unavailableSet || !unavailableSet.has(cid)))
        ) {
          score += 5.5; // Combo Opener Readiness Bonus when partner is open
        }

        // Proactive Combo Steal: enemy locked half of a Lethal Combo and we can steal the partner!
        const enemyCores = enemyPicks.filter((id) => lc.core_ids.includes(id));
        if (enemyCores.length > 0 && lc.core_ids.includes(hero.id)) {
          const stealBoost = lc.steal_bonus * (enemyCores.length >= 2 ? 1.2 : 1.0);
          score += stealBoost;
          if (stealBoost > bestWeight) {
            bestWeight = stealBoost;
            bestTag = {
              type: "counter-good",
              text: `⚡ Combo Steal: Denies Enemy ${lc.name}`
            };
          }
        }
      }
    }

    // 2. S18 Championship 3-Hero Trio Completion
    if (fitsOpenAllyLane && Array.isArray(MPL_PH_MODEL.trios)) {
      for (const trio of MPL_PH_MODEL.trios) {
        if (!trio.hero_ids.includes(hero.id)) continue;
        const allyHeld = trio.hero_ids.filter((id) => allyPicks.includes(id)).length;
        if (allyHeld >= 2) {
          const trioBoost = trio.bonus || 22.0;
          score += trioBoost;
          if (trioBoost > bestWeight) {
            bestWeight = trioBoost;
            bestTag = {
              type: "synergy-good",
              text: `🏆 S18 Playoff Trio: ${trio.heroes.join("+")} (${trio.raw_wr}% WR)`
            };
          }
        }
      }
    }

    let synLiftSum = 0;
    for (const aid of allyPicks) {
      const k = aid < hero.id ? `${aid}_${hero.id}` : `${hero.id}_${aid}`;
      const syn = MPL_PH_MODEL.synergies && MPL_PH_MODEL.synergies[k];
      if (syn) {
        const edge = clampVal(syn.lift * 0.85, -10.0, 12.0);
        synLiftSum += edge;
        if (edge > 3.5 && edge > bestWeight) {
          bestWeight = edge;
          const allyObj = state.heroMap && state.heroMap.get(aid);
          bestTag = {
            type: "synergy-good",
            text: `🔥 MPL PH Duo +${allyObj ? allyObj.name : ""} (${syn.wins}-${syn.games - syn.wins}, ${syn.raw_wr}%)`
          };
        } else if (edge <= -5.0 && Math.abs(edge) > bestWeight) {
          bestWeight = Math.abs(edge);
          bestTag = {
            type: "warn-counter",
            text: `⚠️ MPL Low-WR Pair (${syn.wins}-${syn.games - syn.wins})`
          };
        }
      }
    }
    score += synLiftSum;

    let cntLiftSum = 0;
    for (const eid of enemyPicks) {
      const cnt = MPL_PH_MODEL.counters && MPL_PH_MODEL.counters[`${hero.id}_${eid}`];
      if (cnt) {
        const edge = clampVal(cnt.lift * 0.8, -8.0, 12.0);
        cntLiftSum += edge;
        if (edge > 3.5 && edge > bestWeight) {
          bestWeight = edge;
          bestTag = {
            type: "counter-good",
            text: `⚔️ MPL PH Counter vs ${cnt.opponent} (${cnt.wins}-${cnt.games - cnt.wins})`
          };
        }
      }
    }
    score += cntLiftSum;

    // MPL PH S18 Double-Tank Trap Guard (Assassin1-Fighter1-Mage1-Tank2 won 2/7 = 28.6%)
    const allyPrimaryTanks = allyPicks.filter((id) => MPL_PRIMARY_TANK_IDS.has(id)).length;
    const allyHasSup = allyPicks.some((id) => {
      const h = state.heroMap && state.heroMap.get(id);
      return h && h.roles.includes("Support");
    });
    if (
      allyPrimaryTanks >= 1 &&
      !allyHasSup &&
      MPL_PRIMARY_TANK_IDS.has(hero.id) &&
      !hero.roles.includes("Support")
    ) {
      score -= 14.5;
    }

    return { score, tag: bestTag };
  }

  function evaluateLethalComboPairBonus(idA, idB, allyPicks, enemyPicks) {
    if (!MPL_PH_MODEL || !Array.isArray(MPL_PH_MODEL.lethal_combos)) {
      return { bonus: 0, comboName: null };
    }
    const newIds = idB ? [idA, idB] : [idA];
    const combined = [...allyPicks, ...newIds];
    let totalBonus = 0;
    let bestComboName = null;
    let bestScore = 0;

    for (const lc of MPL_PH_MODEL.lethal_combos) {
      const beforeCount = allyPicks.filter((id) => lc.core_ids.includes(id)).length;
      const afterCount = combined.filter((id) => lc.core_ids.includes(id)).length;
      if (afterCount >= 2 && afterCount > beforeCount) {
        const bothNew = idB && lc.core_ids.includes(idA) && lc.core_ids.includes(idB);
        const b = bothNew ? lc.pick_bonus * 1.32 : lc.pick_bonus * 0.92;
        totalBonus += b;
        if (b > bestScore) {
          bestScore = b;
          bestComboName = lc.name;
        }
      }
      // Steal bonus if enemy held part of this combo and we just took the partner
      const enemyHeld = (enemyPicks || []).filter((id) => lc.core_ids.includes(id)).length;
      if (enemyHeld >= 1 && newIds.some((id) => lc.core_ids.includes(id))) {
        totalBonus += lc.steal_bonus * 0.65;
      }
    }

    if (Array.isArray(MPL_PH_MODEL.trios)) {
      for (const trio of MPL_PH_MODEL.trios) {
        const beforeT = allyPicks.filter((id) => trio.hero_ids.includes(id)).length;
        const afterT = combined.filter((id) => trio.hero_ids.includes(id)).length;
        if (afterT === 3 && beforeT < 3) {
          const tb = trio.bonus || 22.0;
          totalBonus += tb;
          if (tb > bestScore) {
            bestScore = tb;
            bestComboName = `${trio.heroes.join(" + ")} Trio`;
          }
        }
      }
    }

    return { bonus: totalBonus, comboName: bestComboName };
  }

  function computeMplLogregDelta(blueIds, redIds) {
    if (!MPL_PH_MODEL || !MPL_PH_MODEL.logreg_model || blueIds.length === 0 || redIds.length === 0) {
      return 0;
    }
    const w = MPL_PH_MODEL.logreg_model.weights || {};

    function summarize(ids, oppIds) {
      const oppSet = new Set(oppIds);
      let presS = 0, wrS = 0, ctS = 0, duS = 0, cntEdge = 0;
      for (const id of ids) {
        const h = state.heroMap && state.heroMap.get(id);
        if (!h) continue;
        const mh = getMplModelHero(id);
        presS += mh ? mh.presence_rate / 100.0 : 0.0;
        const tf = getHeroTimeframeStats(h, state.timeframe);
        wrS += tf.win_rate ?? 50.0;
        ctS += ((h.stats_rating && h.stats_rating.control) || 50) / 100.0;
        duS += ((h.stats_rating && h.stats_rating.durability) || 50) / 100.0;
        for (const cb of tf.counters_beaten || []) {
          if (oppSet.has(cb.heroid)) cntEdge += cb.delta_wr || 0;
        }
      }
      const n = ids.length;
      return {
        presMean: presS / n,
        wrMean: (wrS / n - 50.0) / 10.0,
        ctMean: ctS / n,
        duMean: duS / n,
        cntEdge: cntEdge / 10.0
      };
    }

    const fb = summarize(blueIds, redIds);
    const fr = summarize(redIds, blueIds);
    const completionScale = Math.min(blueIds.length, redIds.length) / 5.0;
    const z =
      (w.blue_side || 0) +
      (w.mpl_presence_mean || 0) * (fb.presMean - fr.presMean) +
      (w.gms_wr_mean || 0) * (fb.wrMean - fr.wrMean) +
      (w.control_mean || 0) * (fb.ctMean - fr.ctMean) +
      (w.durability_mean || 0) * (fb.duMean - fr.duMean) +
      (w.gms_counter_delta || 0) * (fb.cntEdge - fr.cntEdge);
    return clampVal(z * completionScale, -1.6, 1.6);
  }

  // Dash-heavy heroes for MPL Anti-Dash Counter Detection
  const DASH_HERO_IDS = new Set([17, 21, 26, 28, 32, 47, 56, 63, 65, 73, 81, 84, 86, 89, 97, 103, 116, 118, 120, 122, 126, 128, 131, 133]);
  // AoE Setter tanks that Diggie / Valir / Valentina hard-counter
  const AOE_SETTER_IDS = new Set([6, 19, 20, 41, 44, 70, 78, 92, 93, 104, 124]);
  // Heavy Regen / Sustain heroes that Baxia / Anti-heal burst counter
  const HEAVY_REGEN_IDS = new Set([4, 14, 19, 22, 29, 34, 55, 59, 72, 80, 81, 95, 99, 108, 112, 117, 127, 128, 132]);
  // Hard Point-and-Click Suppress / Anti-Dash Lockdown Heroes
  const HARD_LOCKDOWN_IDS = new Set([3, 6, 9, 10, 15, 26, 54, 62, 74, 78, 99, 106, 128]);
  // Pocket Enchanters / Raid-Boss Enablers
  const ENCHANTER_ROAM_IDS = new Set([14, 34, 55, 102, 112, 132]);
  // % HP / True-Damage / Armor-Shred Heroes that Melt Multi-Tank Lineups
  const TANK_SHREDDER_IDS = new Set([28, 40, 53, 57, 68, 83, 85, 107, 123, 125, 130]);
  // Projectile-Heavy Carries Hard-Countered by Lolita (#20) Shield Reflect
  const PROJECTILE_CARRY_IDS = new Set([11, 12, 13, 18, 31, 33, 42, 61, 63, 65, 71, 79, 89, 100, 105, 107, 130]);
  // High-Impact Teamfight Ultimates Hijacked by Valentina (#110)
  const HIGH_VALUE_ULT_IDS = new Set([6, 19, 34, 46, 48, 52, 76, 89, 93, 95, 96, 101, 127]);
  // Immobile Backline Carries Vulnerable to Hard Dive / Artillery
  const IMMOBILE_BACKLINE_IDS = new Set([1, 15, 18, 23, 36, 38, 46, 52, 60, 91, 101, 115, 121, 129]);
  // Safe MPL Phase-1 Priority Blind / Flex Picks (Hard to Counter Early)
  const SAFE_PHASE1_BLIND_IDS = new Set([26, 41, 49, 65, 70, 73, 79, 101, 102, 105, 111, 123, 124, 125, 126, 127, 128, 129, 132]);

  // Blind-Pick Vulnerability Map: heroId -> { counters: [...], enemyLane: "..." }
  const BLIND_PICK_VULNERABILITY = {
    93:  { counters: [48, 110, 57], lane: "Roam", label: "Diggie / Valentina / Valir Open" },
    6:   { counters: [48, 110, 57], lane: "Roam", label: "Diggie / Valentina Open" },
    19:  { counters: [48, 110],     lane: "Roam", label: "Diggie Purify Open" },
    17:  { counters: [78, 10, 62, 3, 106], lane: "Roam", label: "Hard Suppress / Khufra Open" },
    84:  { counters: [78, 10, 62, 3],      lane: "Roam", label: "Point-and-Click Suppress Open" },
    118: { counters: [106, 74, 78, 62],    lane: "EXP Lane", label: "Phoveus / Minsitthar Open" },
    89:  { counters: [106, 78, 74, 100],   lane: "Gold Lane", label: "Phoveus / Khufra / Brody Open" },
    34:  { counters: [87, 92, 96],         lane: "Mid Lane", label: "Baxia / Luo Yi / Carmilla Open" },
    120: { counters: [106, 74],            lane: "EXP Lane", label: "Phoveus / Minsitthar Open" }
  };

  // Direct 1v1 Lane Dominance Matrix (heroId -> Set of enemy hero IDs it crushes 1v1 in lane)
  const PRO_1V1_LANE_COUNTERS = {
    123: new Set([82, 49, 41, 70, 59, 81, 99, 117, 127, 44, 104]), // Cici kites tank/bruiser EXP
    85:  new Set([81, 59, 82, 49, 70, 99, 117, 72, 29]),          // Dyrroth shreds armor/shield EXP
    106: new Set([120, 103, 97, 26, 123, 118, 89, 126, 84, 65]),  // Phoveus slams dash laners
    74:  new Set([120, 103, 97, 26, 118, 17, 84, 47, 126, 133]),  // Minsitthar grounds dash heroes
    95:  new Set([52, 101, 115, 129, 121, 18, 91, 82]),           // Yu Zhong dives immobile backline
    40:  new Set([49, 70, 99, 117, 41, 6, 19, 12, 31]),           // Karrie melts tank frontliners & short MM
    100: new Set([89, 65, 31, 40, 1, 60, 73]),                    // Brody bullies short-range Gold laners
    13:  new Set([89, 65, 31, 40, 12, 100, 1, 60]),               // Clint out-trades Gold lane
    94:  new Set([89, 65, 31, 1, 60, 53]),                        // Popol & Kupa zones Gold lane + plates
    53:  new Set([12, 100, 40, 39, 22, 13]),                      // Lesley true-damage pokes short MM
    73:  new Set([121, 18, 60, 1, 13, 105]),                      // Harith out-tempos immobile Gold
    48:  new Set([93, 6, 19, 78, 92, 104, 70, 9, 41, 128]),       // Diggie nullifies AoE setter roamers
    20:  new Set([61, 31, 105, 12, 65, 71, 79, 107, 130, 33, 42, 63]), // Lolita reflects projectile carries
    110: new Set([93, 6, 76, 95, 127, 19, 101, 52, 46, 34, 89]),  // Valentina steals S-tier ults
    87:  new Set([34, 112, 14, 19, 55, 22, 127, 117, 59, 81, 29]) // Baxia cuts sustain/heal by 50%+
  };

  // Authentic MPL PH / MPL ID Pro Tournament Duo & Trio Synergy Packages
  const MPL_PRO_COMBOS = [
    {
      name: "Global Portal & Yin-Yang Macro",
      cores: [124, 96], // Chip + Luo Yi
      partners: [126, 127, 120, 26, 103, 128, 95], // Suyou, Lukas, Arlott, Chou, Paquito, Kalea, Yu Zhong
      bonus: 15.5
    },
    {
      name: "MPL Raid-Boss Hyper-Carry + Pocket Support",
      cores: [22, 133, 127, 126, 122, 84, 117, 108, 88], // Freya, Hirara, Lukas, Suyou, Nolan, Ling, Fredrinn, Aulus, Masha
      partners: [55, 112, 102, 132, 14], // Angela, Floryn, Mathilda, Marcel, Rafaela
      bonus: 15.0
    },
    {
      name: "MPL Lockdown Tank + Instant Burst Mid",
      cores: [93, 70, 19, 6, 104, 41], // Atlas, Belerick, Minotaur, Tigreal, Gloo, Gatotkaca
      partners: [15, 52, 125, 129, 121, 65, 130, 101], // Eudora, Pharsa, Zhuxin, Zetian, Ixia, Claude, Obsidia, Yve
      bonus: 14.0
    },
    {
      name: "Curse of Blood 5-Man Teamwipe Link",
      cores: [92], // Carmilla
      partners: [15, 125, 129, 96, 108, 82, 130, 121], // Eudora, Zhuxin, Zetian, Luo Yi, Aulus, Terizla, Obsidia, Ixia
      bonus: 15.5
    },
    {
      name: "MPL Early Tempo Turtle & Invade Duo",
      cores: [103, 122, 126, 127], // Paquito, Nolan, Suyou, Lukas
      partners: [128, 63, 35, 54, 102, 125], // Kalea, Selena, Hilda, Jawhead, Mathilda, Zhuxin
      bonus: 13.5
    },
    {
      name: "Physical Jungle/EXP + Harith Magic Gold Balance",
      cores: [73], // Harith Gold
      partners: [126, 127, 103, 122, 21, 133], // Suyou, Lukas, Paquito, Nolan, Hayabusa, Hirara
      bonus: 13.0
    },
    {
      name: "MPL PH S18 Barats/Aulus Frontline Deathball",
      cores: [99, 108, 49, 70], // Barats, Aulus, Hylos, Belerick
      partners: [71, 125, 129, 133, 132, 86], // Kimmy, Zhuxin, Zetian, Hirara, Marcel, Lylia
      bonus: 14.5
    },
    {
      name: "MPL PH S18 Lockdown Setup + Mid Control Burst",
      cores: [93, 49, 70, 128], // Atlas, Hylos, Belerick, Kalea
      partners: [86, 52, 125, 123, 126, 73], // Lylia, Pharsa, Zhuxin, Cici, Suyou, Harith
      bonus: 14.0
    },
    {
      name: "MPL PH S18 Grand Final Kimmy + Estes Healing Deathball",
      cores: [71, 34], // Kimmy + Estes
      partners: [99, 126, 49, 88, 70, 93, 101], // Barats, Suyou, Hylos, Masha, Belerick, Atlas, Yve
      bonus: 16.5
    },
    {
      name: "Zhuxin + Carmilla Curse of Blood Soul-Snare Link",
      cores: [125, 92], // Zhuxin + Carmilla
      partners: [108, 129, 91, 99, 71, 15], // Aulus, Zetian, Cecilion, Barats, Kimmy, Eudora
      bonus: 16.5
    }
  ];

  // Dynamic MPL Championship Strategy Blueprints (Drives Adaptive Bans & Desired Team Composition)
  const MPL_STRATEGY_BLUEPRINTS = {
    raid_boss_hyper: {
      key: "raid_boss_hyper",
      name: "👑 Raid-Boss Hyper-Carry + Enchanter Deathball",
      shortName: "Raid-Boss Deathball",
      preferred_maps: ["healing_turtle", "golden_turret", "flying_cloud"],
      core_ids: new Set([99, 108, 22, 88, 127, 126, 4, 132, 112, 55, 102, 14, 49]),
      support_ids: new Set([82, 95, 70, 123, 125, 101, 96, 129, 65, 105, 73, 13, 130, 71, 86]),
      ban_targets: new Set([103, 59, 81, 87, 40, 123, 57, 110, 74, 85, 92, 68, 106]),
      ban_reason: "🚫 Strategy Ban: Removes Anti-Heal / Counter-Brawl vs Deathball Plan"
    },
    wombo_setter_aoe: {
      key: "wombo_setter_aoe",
      name: "🌪️ 5v5 Wombo-Combo Setter + AoE Teamwipe",
      shortName: "5v5 Wombo-Combo",
      preferred_maps: ["flying_cloud", "healing_turtle", "revealing_wisps"],
      core_ids: new Set([93, 70, 6, 19, 92, 41, 125, 52, 86, 101, 129, 65, 130]),
      support_ids: new Set([82, 95, 127, 126, 117, 108, 99, 132, 96, 121, 105, 123]),
      ban_targets: new Set([48, 110, 57, 9, 76, 81, 22, 88, 128]),
      ban_reason: "🚫 Strategy Ban: Eliminates Purify / Disengage vs 5v5 Setter Plan"
    },
    global_macro_siege: {
      key: "global_macro_siege",
      name: "⚡ Gold-Carry Flex + Objective Siege",
      shortName: "Gold-Flex Siege",
      preferred_maps: ["golden_turret", "revealing_wisps", "flying_cloud"],
      core_ids: new Set([65, 130, 71, 73, 123, 1, 12, 124, 96, 102, 22, 88]),
      support_ids: new Set([127, 126, 103, 133, 49, 70, 132, 125, 129, 86, 111]),
      ban_targets: new Set([6, 93, 74, 106, 78, 92, 99, 76, 81, 59]),
      ban_reason: "🚫 Strategy Ban: Blocks Lockdown & Sideline Threats vs Gold-Carry Siege"
    },
    pickoff_dive_tempo: {
      key: "pickoff_dive_tempo",
      name: "🗡️ Early Invade + Backline Dive Assassination",
      shortName: "Backline Dive Tempo",
      preferred_maps: ["flying_cloud", "golden_turret", "healing_turtle"],
      core_ids: new Set([133, 126, 122, 103, 128, 21, 84, 26, 95, 120, 127]),
      support_ids: new Set([125, 86, 52, 119, 75, 129, 73, 71, 13, 100, 65, 105, 102, 41]),
      ban_targets: new Set([78, 76, 74, 106, 62, 10, 3, 117, 49, 70, 22, 88, 81]),
      ban_reason: "🚫 Strategy Ban: Strips Hard Lockdown & Counters vs Dive Plan"
    },
    artillery_fortress: {
      key: "artillery_fortress",
      name: "🏹 Front-to-Back Artillery Sniper + Anti-Dive Wall",
      shortName: "Artillery Fortress",
      preferred_maps: ["revealing_wisps", "golden_turret", "healing_turtle"],
      core_ids: new Set([119, 129, 115, 52, 101, 49, 70, 111, 117, 99, 121, 105, 130]),
      support_ids: new Set([6, 19, 132, 20, 87, 127, 30, 107, 40, 13, 12, 125, 86]),
      ban_targets: new Set([84, 21, 17, 124, 96, 95, 122, 133, 32, 37, 103]),
      ban_reason: "🚫 Strategy Ban: Denies Backline Bypass Assassins vs Artillery Wall"
    },
    anti_meta_lockdown: {
      key: "anti_meta_lockdown",
      name: "🛑 Sustain Bruiser & Anti-Carry Drain",
      shortName: "Sustain & Anti-Carry",
      preferred_maps: ["healing_turtle", "revealing_wisps", "flying_cloud"],
      core_ids: new Set([81, 59, 123, 4, 106, 74, 87, 110, 128, 40, 130, 15]),
      support_ids: new Set([99, 117, 127, 126, 49, 70, 108, 101, 96, 105, 13, 86]),
      ban_targets: new Set([119, 48, 129, 101, 121, 52, 112, 55, 65, 22, 88]),
      ban_reason: "🚫 Strategy Ban: Removes Range Burst & Purify vs Sustain Bruiser Comp"
    },
    early_snowball_brawl: {
      key: "early_snowball_brawl",
      name: "🔥 Early Turtle Invade & Fighter/Tank Brawl Snowball",
      shortName: "Early Brawl Snowball",
      preferred_maps: ["healing_turtle", "golden_turret", "flying_cloud"],
      core_ids: new Set([35, 58, 28, 72, 82, 95, 54, 116, 49, 57, 13, 100, 108, 99]),
      support_ids: new Set([102, 112, 14, 125, 38, 31, 94, 41, 126, 127, 132]),
      ban_targets: new Set([87, 48, 85, 123, 40, 68, 76, 96, 124, 110]),
      ban_reason: "🚫 Strategy Ban: Removes Anti-Brawl Kiting & True-Damage Shred vs Snowball"
    },
    split_push_pickoff: {
      key: "split_push_pickoff",
      name: "⚡ 1-3-1 Split-Push Macro & Side-Lane Isolation",
      shortName: "1-3-1 Split-Push",
      preferred_maps: ["golden_turret", "flying_cloud", "revealing_wisps"],
      core_ids: new Set([27, 88, 97, 84, 21, 17, 31, 65, 96, 124, 50, 61, 73]),
      support_ids: new Set([26, 128, 62, 10, 102, 55, 121, 101, 63, 120]),
      ban_targets: new Set([106, 74, 78, 62, 10, 3, 15, 49, 6, 93]),
      ban_reason: "🚫 Strategy Ban: Strips Global Catch & Hard Lockdown vs 1-3-1 Split-Push"
    }
  };
  const BLUEPRINT_KEYS = Object.keys(MPL_STRATEGY_BLUEPRINTS);

  // Official 4 Latest MLBB Patch Battlefield Map Changes & MPL Meta Intelligence
  const MLBB_MAPS = {
    healing_turtle: {
      key: "healing_turtle",
      name: "Healing Turtle",
      shortName: "Turtle",
      icon: "🐢",
      badgeText: "🐢 HEALING TURTLE",
      slogan: '"Turtle Pushes Lanes & Heals Nearby Allied Heroes"',
      mechanic:
        "The Turtle helps push lanes and heals nearby allied heroes instead of providing the usual shield—turning every 2:00 / 4:00 Turtle secure into an AoE sustain & lane-pushing deathball.",
      comp_archetype: "Early Turtle Contest + Sustain Brawl Deathball",
      comp_short: "Turtle Brawl / Sustain",
      tier_s_plus_ids: new Set([127, 126, 117, 99, 9, 87, 28, 11, 103, 95, 37, 82, 112, 55, 19, 132, 70, 49]),
      tier_s_ids: new Set([122, 35, 128, 14, 34, 125, 96, 73, 22, 123, 88, 102, 130]),
      turtle_retri_ids: new Set([127, 126, 117, 99, 9, 87, 28, 11, 122, 103, 95, 37, 82, 35]),
      sustain_brawl_ids: new Set([112, 55, 19, 132, 70, 49, 14, 34, 125, 96, 73, 22, 123, 87]),
      avoid_ids: new Set([81, 109, 69, 64, 91, 18, 1]),
      avoid_reason: "Loses Turtle Shield Value (Esmeralda) or Too Weak in Early 2:00 Turtle Contests",
      featured_ids: [127, 117, 99, 112, 19, 87, 95, 132],
      avoid_preview_ids: [81, 64, 91, 18]
    },
    golden_turret: {
      key: "golden_turret",
      name: "Golden Turret",
      shortName: "Turret",
      icon: "🏰",
      badgeText: "🏰 GOLDEN TURRET",
      slogan: '"Bonus Team Gold on Turret Kills & Fortified Turret HP"',
      mechanic:
        "Destroying turrets provides additional team gold, while certain turrets gain more HP—heavily rewarding fast turret-shredding DPS, siege macro, and early gold-plate snowballing.",
      comp_archetype: "Turret-Melting Siege DPS + Fast Gold-Snowball Macro",
      comp_short: "Turret Shred / Siege",
      tier_s_plus_ids: new Set([22, 94, 105, 12, 31, 65, 130, 107, 100, 39, 88, 27, 61, 124, 32, 133]),
      tier_s_ids: new Set([13, 40, 11, 50, 102, 127, 126, 96, 18, 1, 60, 76]),
      turret_shred_ids: new Set([22, 94, 105, 12, 31, 65, 130, 107, 100, 39, 88, 27, 61, 50, 11, 13, 40]),
      macro_rotate_ids: new Set([124, 32, 102, 96, 133, 127, 126, 76]),
      avoid_ids: new Set([10, 3, 24, 62, 63, 15]),
      avoid_reason: "Zero Objective/Turret Push & Slow Wave Clear vs High-HP Golden Turrets",
      featured_ids: [22, 94, 105, 65, 130, 88, 124, 39],
      avoid_preview_ids: [10, 3, 24, 63]
    },
    revealing_wisps: {
      key: "revealing_wisps",
      name: "Revealing Wisps / Detection Flares",
      shortName: "Wisps",
      icon: "🔮",
      badgeText: "🔮 REVEALING WISPS / FLARES",
      slogan: '"Detects Hidden Enemies & Reveals Map Areas"',
      mechanic:
        "Revealing Wisps and Detection Flares help detect hidden enemies and reveal areas of the map—shutting down stealth/bush-campers and empowering long-range artillery & vision snipers.",
      comp_archetype: "Long-Range Artillery Snipers + Anti-Stealth Vision Control",
      comp_short: "Vision Sniper / Front-to-Back",
      tier_s_plus_ids: new Set([119, 129, 52, 101, 115, 125, 96, 124, 30, 121, 105, 70, 49, 6, 19, 132]),
      tier_s_ids: new Set([23, 91, 18, 13, 79, 128, 127, 126, 130, 48, 57, 38, 110]),
      artillery_sniper_ids: new Set([119, 129, 52, 101, 115, 23, 91, 30, 121, 105, 18, 13, 79]),
      front_to_back_ids: new Set([70, 49, 6, 19, 132, 125, 96, 124, 128, 48, 57]),
      avoid_ids: new Set([24, 109, 51, 53, 1, 15, 3, 75, 35, 36, 113]),
      avoid_reason: "Stealth / Camouflage / Bush-Camp Exposed by Revealing Wisps & Detection Flares",
      featured_ids: [119, 129, 52, 101, 115, 30, 121, 70],
      avoid_preview_ids: [24, 109, 51, 15]
    },
    flying_cloud: {
      key: "flying_cloud",
      name: "Flying Cloud",
      shortName: "Cloud",
      icon: "☁️",
      badgeText: "☁️ FLYING CLOUD",
      slogan: '"Faster Movement Back into Battle with Updated Visuals"',
      mechanic:
        "Provides faster movement back into battle with updated visual effects—launching respawned or returning heroes into a high-speed aerial glide for instant lane defense & 5v5 re-engages.",
      comp_archetype: "5v5 Aerial Dive Engagement + High-Ground Wave-Clear Siege",
      comp_short: "Aerial Dive / High-Ground",
      tier_s_plus_ids: new Set([93, 6, 19, 95, 41, 106, 37, 127, 52, 101, 125, 129, 76, 130]),
      tier_s_ids: new Set([22, 82, 111, 104, 92, 26, 83, 91, 105, 65, 121, 38]),
      aerial_dive_ids: new Set([93, 6, 19, 95, 41, 106, 37, 127, 22, 82, 111, 104, 92]),
      highground_clear_ids: new Set([52, 101, 125, 129, 91, 105, 65, 130, 121, 38, 76, 83]),
      avoid_ids: new Set([24, 3, 16, 113, 51]),
      avoid_reason: "Single-Target Pick-Off Neutralized by Rapid Flying Cloud Re-Engage",
      featured_ids: [93, 95, 41, 106, 52, 125, 76, 127],
      avoid_preview_ids: [24, 3, 16, 113]
    }
  };
  const MAP_KEYS = Object.keys(MLBB_MAPS);

  // Official MPL 10-Ban Tournament Interleaved Sequence (20 Steps)
  const SEQUENCE_MPL10 = [
    // Phase 1 Bans (6: 3 Blue, 3 Red)
    { step: 1,  phase: "BAN PHASE 1",  type: "ban",  side: "blue", slotIndex: 0, label: "B-Ban 1" },
    { step: 2,  phase: "BAN PHASE 1",  type: "ban",  side: "red",  slotIndex: 0, label: "R-Ban 1" },
    { step: 3,  phase: "BAN PHASE 1",  type: "ban",  side: "blue", slotIndex: 1, label: "B-Ban 2" },
    { step: 4,  phase: "BAN PHASE 1",  type: "ban",  side: "red",  slotIndex: 1, label: "R-Ban 2" },
    { step: 5,  phase: "BAN PHASE 1",  type: "ban",  side: "blue", slotIndex: 2, label: "B-Ban 3" },
    { step: 6,  phase: "BAN PHASE 1",  type: "ban",  side: "red",  slotIndex: 2, label: "R-Ban 3" },
    // Phase 1 Picks (6: B1 -> R1,R2 -> B2,B3 -> R3)
    { step: 7,  phase: "PICK PHASE 1", type: "pick", side: "blue", slotIndex: 0, label: "B1 Pick" },
    { step: 8,  phase: "PICK PHASE 1", type: "pick", side: "red",  slotIndex: 0, label: "R1 Pick" },
    { step: 9,  phase: "PICK PHASE 1", type: "pick", side: "red",  slotIndex: 1, label: "R2 Pick" },
    { step: 10, phase: "PICK PHASE 1", type: "pick", side: "blue", slotIndex: 1, label: "B2 Pick" },
    { step: 11, phase: "PICK PHASE 1", type: "pick", side: "blue", slotIndex: 2, label: "B3 Pick" },
    { step: 12, phase: "PICK PHASE 1", type: "pick", side: "red",  slotIndex: 2, label: "R3 Pick" },
    // Phase 2 Bans (4: Red bans first in Phase 2 -> R-Ban 4, B-Ban 4, R-Ban 5, B-Ban 5)
    { step: 13, phase: "BAN PHASE 2",  type: "ban",  side: "red",  slotIndex: 3, label: "R-Ban 4" },
    { step: 14, phase: "BAN PHASE 2",  type: "ban",  side: "blue", slotIndex: 3, label: "B-Ban 4" },
    { step: 15, phase: "BAN PHASE 2",  type: "ban",  side: "red",  slotIndex: 4, label: "R-Ban 5" },
    { step: 16, phase: "BAN PHASE 2",  type: "ban",  side: "blue", slotIndex: 4, label: "B-Ban 5" },
    // Phase 2 Picks (4: R4 -> B4,B5 -> R5 Counter Pick)
    { step: 17, phase: "PICK PHASE 2", type: "pick", side: "red",  slotIndex: 3, label: "R4 Pick" },
    { step: 18, phase: "PICK PHASE 2", type: "pick", side: "blue", slotIndex: 3, label: "B4 Pick" },
    { step: 19, phase: "PICK PHASE 2", type: "pick", side: "blue", slotIndex: 4, label: "B5 Pick" },
    { step: 20, phase: "PICK PHASE 2", type: "pick", side: "red",  slotIndex: 4, label: "R5 Pick" }
  ];

  // Classic 6-Ban Sequence (16 Steps)
  const SEQUENCE_RANKED6 = [
    { step: 1,  phase: "BAN PHASE",    type: "ban",  side: "blue", slotIndex: 0, label: "B-Ban 1" },
    { step: 2,  phase: "BAN PHASE",    type: "ban",  side: "red",  slotIndex: 0, label: "R-Ban 1" },
    { step: 3,  phase: "BAN PHASE",    type: "ban",  side: "blue", slotIndex: 1, label: "B-Ban 2" },
    { step: 4,  phase: "BAN PHASE",    type: "ban",  side: "red",  slotIndex: 1, label: "R-Ban 2" },
    { step: 5,  phase: "BAN PHASE",    type: "ban",  side: "blue", slotIndex: 2, label: "B-Ban 3" },
    { step: 6,  phase: "BAN PHASE",    type: "ban",  side: "red",  slotIndex: 2, label: "R-Ban 3" },
    { step: 7,  phase: "PICK PHASE",   type: "pick", side: "blue", slotIndex: 0, label: "B1 Pick" },
    { step: 8,  phase: "PICK PHASE",   type: "pick", side: "red",  slotIndex: 0, label: "R1 Pick" },
    { step: 9,  phase: "PICK PHASE",   type: "pick", side: "red",  slotIndex: 1, label: "R2 Pick" },
    { step: 10, phase: "PICK PHASE",   type: "pick", side: "blue", slotIndex: 1, label: "B2 Pick" },
    { step: 11, phase: "PICK PHASE",   type: "pick", side: "blue", slotIndex: 2, label: "B3 Pick" },
    { step: 12, phase: "PICK PHASE",   type: "pick", side: "red",  slotIndex: 2, label: "R3 Pick" },
    { step: 13, phase: "PICK PHASE",   type: "pick", side: "red",  slotIndex: 3, label: "R4 Pick" },
    { step: 14, phase: "PICK PHASE",   type: "pick", side: "blue", slotIndex: 3, label: "B4 Pick" },
    { step: 15, phase: "PICK PHASE",   type: "pick", side: "blue", slotIndex: 4, label: "B5 Pick" },
    { step: 16, phase: "PICK PHASE",   type: "pick", side: "red",  slotIndex: 4, label: "R5 Pick" }
  ];

  // Application State
  const state = {
    metaPayload: null,
    heroes: [],
    heroMap: new Map(),

    // Global Meta Controls
    activeView: "simulator",        // "simulator" | "live-counter" | "tier-list" | "matrix"
    metaWeightMode: "hybrid",       // "hybrid" | "mpl" | "ranked"
    timeframe: "7d",                // "1d" | "7d" | "15d" | "30d"

    // Draft Configuration
    selectedMap: "healing_turtle",  // "healing_turtle" | "golden_turret" | "revealing_wisps" | "flying_cloud"
    playerSide: "blue",             // "blue" | "red" | "both" | "ai_vs_ai"
    draftFormat: "mpl10",           // "mpl10" | "ranked6"
    aiStyle: "mpl_ph",              // "mpl_ph" | "god" | "pro" | "aggressive" | "teamfight"
    timerSeconds: 0,                // 0 | 30 | 20
    timeLeft: 0,
    timerInterval: null,
    aiTimeout: null,

    // Active Draft Board
    stepIndex: 0,                   // 0..sequence.length
    blueBans: [null, null, null, null, null],
    redBans: [null, null, null, null, null],
    bluePicks: [
      { heroId: null, lane: "EXP Lane", manualLane: false },
      { heroId: null, lane: "Jungle",   manualLane: false },
      { heroId: null, lane: "Mid Lane", manualLane: false },
      { heroId: null, lane: "Gold Lane",manualLane: false },
      { heroId: null, lane: "Roam",     manualLane: false }
    ],
    redPicks: [
      { heroId: null, lane: "EXP Lane", manualLane: false },
      { heroId: null, lane: "Jungle",   manualLane: false },
      { heroId: null, lane: "Mid Lane", manualLane: false },
      { heroId: null, lane: "Gold Lane",manualLane: false },
      { heroId: null, lane: "Roam",     manualLane: false }
    ],
    history: [],

    // Live Draft Counter custom cursor override
    liveTarget: { type: "pick", side: "blue", slotIndex: 0 },

    // Filters
    coachLaneFilter: "auto",
    poolLaneFilter: "all",
    poolRoleFilter: "all",
    poolTierFilter: "all",
    poolSortBy: "coach",
    poolSearch: "",

    // Tier List View Filters
    tierLaneFilter: "all",
    tierSearch: "",

    // Matrix Explorer View State
    matrixSelectedHeroId: 133,
    matrixLaneFilter: "all",
    matrixSearch: ""
  };

  /* =====================================================================
     1. INITIALIZATION & DATA LOADING
     ===================================================================== */
  function init() {
    if (window.ELYA_INITIAL_META && window.ELYA_INITIAL_META.heroes) {
      ingestMetaPayload(window.ELYA_INITIAL_META);
    }
    // Also fetch latest from /api/meta if running via Python server
    fetch("/api/meta")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && data.heroes && data.heroes.length) {
          ingestMetaPayload(data);
          renderAll();
        }
      })
      .catch(() => {});

    bindEvents();
    resetDraft(false);
    renderMapModalCards();
    renderAll();
  }

  function ingestMetaPayload(payload) {
    state.metaPayload = payload;
    state.heroes = payload.heroes || [];
    state.heroMap.clear();
    for (const h of state.heroes) {
      state.heroMap.set(h.id, h);
    }
    recomputeDynamicMetaSummaries();
    updatePatchHeaderText();
  }

  function getHeroTimeframeStats(hero, tfKey) {
    if (!hero || !hero.timeframes) {
      return {
        win_rate: 50.0,
        ban_rate: 0.0,
        pick_rate: 5.0,
        counters_beaten: [],
        countered_by: [],
        best_teammates: [],
        worst_teammates: [],
        scaling: { early: 50, mid: 50, late: 50 }
      };
    }
    return (
      hero.timeframes[tfKey] ||
      hero.timeframes["7d"] ||
      hero.timeframes["1d"] ||
      Object.values(hero.timeframes)[0]
    );
  }

  function recomputeDynamicMetaSummaries() {
    const tfKey = state.timeframe;
    const mode = state.metaWeightMode;

    for (const h of state.heroes) {
      const tf = getHeroTimeframeStats(h, tfKey);
      const wr = tf.win_rate ?? 50.0;
      const br = tf.ban_rate ?? 0.0;
      const pr = tf.pick_rate ?? 5.0;

      const wrScore = Math.max(0, Math.min(45, (wr - 44.0) * 3.2));
      const brScore = Math.min(35, Math.sqrt(Math.max(0, br)) * 3.85);
      const prScore = Math.min(20, pr * 0.85);
      const livePatchScore = +(wrScore + brScore + prScore).toFixed(2);

      const baseMplPres = (h.mpl && h.mpl.pro_presence) || 25.0;
      const modelHero = getMplModelHero(h.id);
      const mplPres = modelHero
        ? +(baseMplPres * 0.42 + modelHero.priority_score * 0.58).toFixed(1)
        : baseMplPres;
      const flexBonus = h.flex_lanes && h.flex_lanes.length >= 2 ? 4.5 : 0;

      let activeScore = livePatchScore;
      if (mode === "hybrid") {
        activeScore = +(livePatchScore * 0.60 + mplPres * 0.40 + flexBonus * 0.5).toFixed(2);
      } else if (mode === "mpl") {
        activeScore = +(mplPres * 0.72 + livePatchScore * 0.28 + flexBonus * 1.4).toFixed(2);
      } else {
        activeScore = livePatchScore;
      }

      let tier = "C";
      if (activeScore >= 65.5 || (mode !== "mpl" && br >= 36.0) || (mode === "mpl" && mplPres >= 82.0)) {
        tier = "S+";
      } else if (activeScore >= 51.5 || br >= 10.0 || (wr >= 52.5 && pr >= 7.0) || (mode === "mpl" && mplPres >= 70.0)) {
        tier = "S";
      } else if (activeScore >= 37.5 || wr >= 50.4 || pr >= 9.0) {
        tier = "A";
      } else if (activeScore >= 24.5 || wr >= 48.0) {
        tier = "B";
      }

      h.active_meta = {
        tier,
        score: activeScore,
        live_patch_score: livePatchScore,
        mpl_presence: mplPres,
        win_rate: wr,
        ban_rate: br,
        pick_rate: pr,
        contest_rate: +Math.min(99.9, br + pr).toFixed(1),
        patch_trend: (h.meta_summary && h.meta_summary.patch_trend) || "STABLE",
        wr_delta: (h.meta_summary && h.meta_summary.wr_delta_30d) || 0
      };
    }
  }

  function updatePatchHeaderText() {
    const el = document.getElementById("patchStatusText");
    if (!el || !state.metaPayload) return;
    const count = state.heroes.length;
    const latest = state.metaPayload.latest_hero || "Hirara";
    const dt = state.metaPayload.synced_at
      ? new Date(state.metaPayload.synced_at).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        })
      : "Live";
    const tfLabels = {
      "1d": "24h Hotfix",
      "7d": "7-Day Patch",
      "15d": "15-Day Meta",
      "30d": "30-Day Season"
    };
    el.innerHTML = `<strong>${count} Official Heroes</strong> (Latest: <strong>${latest} #133</strong>) • Window: <strong>${tfLabels[state.timeframe]}</strong> • Synced: ${dt}`;
  }

  /* =====================================================================
     2. LIVE MOONTON GMS API AUTO-SYNC ENGINE
     ===================================================================== */
  async function triggerLivePatchSync() {
    const dot = document.getElementById("syncDot");
    const txt = document.getElementById("syncBtnText");
    const btn = document.getElementById("btnAutoSync");
    if (dot) dot.classList.add("syncing");
    if (txt) txt.textContent = "Syncing Moonton API...";
    if (btn) btn.disabled = true;

    try {
      // Try Python Backend /api/sync first (builds full 4-timeframe cache)
      let syncedPayload = null;
      try {
        const res = await fetch("/api/sync", { method: "POST" });
        if (res.ok) {
          syncedPayload = await res.json();
        }
      } catch (_) {}

      // Fallback: Direct browser CORS fetch to Moonton's official GMS API!
      if (!syncedPayload) {
        syncedPayload = await directBrowserMoontonSync(state.timeframe);
      }

      if (syncedPayload && syncedPayload.heroes) {
        ingestMetaPayload(syncedPayload);
        renderAll();
        showToast(
          `✅ Live Patch Synced! ${syncedPayload.heroes.length} heroes updated from Moonton GMS API (Latest: ${syncedPayload.latest_hero}).`
        );
      }
    } catch (err) {
      showToast(`⚠️ Sync notice: Using cached live snapshot (${err.message || "offline"}).`);
    } finally {
      if (dot) dot.classList.remove("syncing");
      if (txt) txt.textContent = "⚡ Auto-Sync Patch";
      if (btn) btn.disabled = false;
    }
  }

  async function directBrowserMoontonSync(tfKey) {
    const epMap = { "1d": "2756567", "7d": "2756568", "15d": "2756569", "30d": "2756570" };
    const epId = epMap[tfKey] || "2756568";
    const res = await fetch(`https://api.gms.moontontech.com/api/gms/source/2669606/${epId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pageSize: 400,
        pageIndex: 1,
        filters: [{ field: "bigrank", operator: "eq", value: "9" }]
      })
    });
    if (!res.ok) throw new Error(`GMS HTTP ${res.status}`);
    const json = await res.json();
    const recs = (json.data && json.data.records) || [];

    for (const r of recs) {
      const rd = r.data || {};
      const hid = rd.main_heroid;
      const h = state.heroMap.get(hid);
      if (!h) continue;
      if (!h.timeframes) h.timeframes = {};
      const tfEntry = h.timeframes[tfKey] || (h.timeframes[tfKey] = {});
      const wr = +((rd.main_hero_win_rate || 0.5) * 100).toFixed(2);
      const br = +((rd.main_hero_ban_rate || 0) * 100).toFixed(2);
      const ar = +((rd.main_hero_appearance_rate || 0) * 100).toFixed(3);
      tfEntry.win_rate = wr;
      tfEntry.ban_rate = br;
      tfEntry.appearance_rate = ar;
      tfEntry.pick_rate = +Math.min(99.9, ar * 10).toFixed(2);
    }

    state.metaPayload.synced_at = new Date().toISOString();
    return state.metaPayload;
  }

  /* =====================================================================
     3. DRAFT SEQUENCE & TEAM LANE ASSIGNMENT ENGINE
     ===================================================================== */
  function getActiveSequence() {
    return state.draftFormat === "mpl10" ? SEQUENCE_MPL10 : SEQUENCE_RANKED6;
  }

  function getCurrentTurn() {
    const seq = getActiveSequence();
    if (state.activeView === "live-counter") {
      return {
        step: 0,
        phase: "LIVE DRAFT COUNTER",
        type: state.liveTarget.type,
        side: state.liveTarget.side,
        slotIndex: state.liveTarget.slotIndex,
        label: `${state.liveTarget.side.toUpperCase()} ${state.liveTarget.type.toUpperCase()}`
      };
    }
    if (state.stepIndex >= seq.length) return null;
    return seq[state.stepIndex];
  }

  function getUnavailableHeroIds() {
    const set = new Set();
    for (const id of state.blueBans) if (id) set.add(id);
    for (const id of state.redBans) if (id) set.add(id);
    for (const p of state.bluePicks) if (p.heroId) set.add(p.heroId);
    for (const p of state.redPicks) if (p.heroId) set.add(p.heroId);
    return set;
  }

  /**
   * Exact Maximum-Weight Bipartite 5-Lane Assignment & 1v1 Counter-Swap Solver:
   * Evaluates all valid lane permutations for non-manual picked heroes (<120 states)
   * so flex heroes automatically swap lanes to maximize role coverage AND 1v1 lane matchups!
   */
  function autoAssignTeamLanes(teamPicks) {
    const filledIndices = [];
    const usedLanes = new Set();

    // Keep manual user lane overrides first
    teamPicks.forEach((slot, idx) => {
      if (slot.heroId && slot.manualLane && slot.lane) {
        usedLanes.add(slot.lane);
      } else if (slot.heroId) {
        filledIndices.push(idx);
      }
    });

    const availableLanes = ALL_LANES.filter((ln) => !usedLanes.has(ln));
    const enemySlots = teamPicks === state.bluePicks ? state.redPicks : state.bluePicks;
    const enemyByLane = new Map();
    if (enemySlots) {
      for (const es of enemySlots) {
        if (es.heroId && es.lane) enemyByLane.set(es.lane, es.heroId);
      }
    }

    if (filledIndices.length > 0 && availableLanes.length >= filledIndices.length) {
      let bestScore = -1e9;
      let bestLanes = null;
      const currentLanes = new Array(filledIndices.length);
      const laneUsedBit = new Array(availableLanes.length).fill(false);

      function scoreHeroInLane(heroId, lane) {
        const h = state.heroMap.get(heroId);
        if (!h) return 0;
        const flex = h.flex_lanes || [];
        const flexIdx = flex.indexOf(lane);
        let s = flexIdx >= 0 ? 120 - flexIdx * 10 : -80;

        // 1v1 Lane Counter Swap Advantage vs Enemy Laner in this exact lane
        const enemyId = enemyByLane.get(lane);
        if (enemyId) {
          if (PRO_1V1_LANE_COUNTERS[heroId] && PRO_1V1_LANE_COUNTERS[heroId].has(enemyId)) {
            s += 22;
          }
          if (PRO_1V1_LANE_COUNTERS[enemyId] && PRO_1V1_LANE_COUNTERS[enemyId].has(heroId)) {
            s -= 25;
          }
          const tf = getHeroTimeframeStats(h, state.timeframe);
          const beaten = (tf.counters_beaten || []).find((c) => c.heroid === enemyId);
          if (beaten) s += beaten.delta_wr * 3.0;
          const countered = (tf.countered_by || []).find((c) => c.heroid === enemyId);
          if (countered) s += countered.delta_wr * 3.0; // negative
        }
        return s;
      }

      function dfs(pos, runningScore) {
        if (pos === filledIndices.length) {
          if (runningScore > bestScore) {
            bestScore = runningScore;
            bestLanes = currentLanes.slice();
          }
          return;
        }
        const heroId = teamPicks[filledIndices[pos]].heroId;
        for (let i = 0; i < availableLanes.length; i++) {
          if (laneUsedBit[i]) continue;
          laneUsedBit[i] = true;
          currentLanes[pos] = availableLanes[i];
          dfs(pos + 1, runningScore + scoreHeroInLane(heroId, availableLanes[i]));
          laneUsedBit[i] = false;
        }
      }

      dfs(0, 0);

      if (bestLanes) {
        filledIndices.forEach((slotIdx, i) => {
          teamPicks[slotIdx].lane = bestLanes[i];
          usedLanes.add(bestLanes[i]);
        });
      }
    }

    // Assign remaining empty slots to the remaining uncovered lanes in order
    const remainingLanes = ALL_LANES.filter((ln) => !usedLanes.has(ln));
    let remPtr = 0;
    teamPicks.forEach((slot) => {
      if (!slot.heroId) {
        slot.lane = remainingLanes[remPtr++] || "EXP Lane";
        slot.manualLane = false;
      }
    });
  }

  function getTeamMissingLanes(teamPicks) {
    const covered = new Set();
    for (const p of teamPicks) {
      if (p.heroId && p.lane) covered.add(p.lane);
    }
    return ALL_LANES.filter((ln) => !covered.has(ln));
  }

  /* =====================================================================
     4. ELYA PRO AI COACH & OMEGA 3-PLY MINIMAX SCORING ENGINE
     ===================================================================== */
  function evaluateHeroMatchupVsTeam(hero, enemyHeroIds, enemyPickSlots = null, targetLane = null) {
    const tf = getHeroTimeframeStats(hero, state.timeframe);
    let totalDelta = 0;
    const reasons = [];

    const beatenMap = new Map();
    for (const c of tf.counters_beaten || []) beatenMap.set(c.heroid, c.delta_wr);
    const counteredMap = new Map();
    for (const c of tf.countered_by || []) counteredMap.set(c.heroid, c.delta_wr);

    const loreStrong = new Set((hero.lore_relations && hero.lore_relations.strong_ids) || []);
    const loreWeak = new Set((hero.lore_relations && hero.lore_relations.weak_ids) || []);
    const proLaneBeaten = PRO_1V1_LANE_COUNTERS[hero.id] || null;

    // Identify direct 1v1 lane opponent if enemyPickSlots and targetLane are known
    let directLaneEnemyId = null;
    if (enemyPickSlots && targetLane) {
      const slotMatch = enemyPickSlots.find((s) => s.heroId && s.lane === targetLane);
      if (slotMatch) directLaneEnemyId = slotMatch.heroId;
    }

    let enemyDashCount = 0;
    let enemySetterCount = 0;
    let enemyRegenCount = 0;
    let enemyTankyCount = 0;
    let enemyProjectileCount = 0;
    let enemyUltValueCount = 0;
    let enemyImmobileCount = 0;
    let enemyMagicCount = 0;
    let enemyHasHardLockdown = false;

    for (const eid of enemyHeroIds) {
      const enemy = state.heroMap.get(eid);
      if (!enemy) continue;

      const isLaneOpponent = Boolean(directLaneEnemyId && eid === directLaneEnemyId);
      const laneMult = isLaneOpponent ? 1.75 : 1.0;

      if (DASH_HERO_IDS.has(eid)) enemyDashCount++;
      if (AOE_SETTER_IDS.has(eid)) enemySetterCount++;
      if (HEAVY_REGEN_IDS.has(eid)) enemyRegenCount++;
      if (enemy.roles.includes("Tank") || enemy.stats_rating.durability >= 72) enemyTankyCount++;
      if (PROJECTILE_CARRY_IDS.has(eid)) enemyProjectileCount++;
      if (HIGH_VALUE_ULT_IDS.has(eid)) enemyUltValueCount++;
      if (IMMOBILE_BACKLINE_IDS.has(eid)) enemyImmobileCount++;
      if (enemy.roles.includes("Mage") || eid === 73) enemyMagicCount++;
      if (HARD_LOCKDOWN_IDS.has(eid)) enemyHasHardLockdown = true;

      // Pro 1v1 Direct Lane & Archetype Dominance Check
      if (proLaneBeaten && proLaneBeaten.has(eid)) {
        const proBoost = isLaneOpponent ? 9.5 : 5.2;
        totalDelta += proBoost;
        reasons.unshift({
          type: "counter-good",
          text: isLaneOpponent
            ? `🔥 1v1 Lane Crusher vs ${enemy.name} (${LANE_SHORT[targetLane] || targetLane})`
            : `⚔️ Pro Archetype Counter vs ${enemy.name}`,
          delta: +(proBoost / 2.2).toFixed(1)
        });
      }
      if (PRO_1V1_LANE_COUNTERS[eid] && PRO_1V1_LANE_COUNTERS[eid].has(hero.id)) {
        const proDrop = isLaneOpponent ? -11.5 : -5.8;
        totalDelta += proDrop;
        reasons.push({
          type: "warn-counter",
          text: isLaneOpponent
            ? `⚠️ Hard-Countered in Lane by ${enemy.name}`
            : `⚠️ Countered by ${enemy.name}`,
          delta: +(proDrop / 2.2).toFixed(1)
        });
      }

      if (beatenMap.has(eid)) {
        const d = beatenMap.get(eid);
        totalDelta += d * 2.4 * laneMult;
        reasons.push({
          type: "counter-good",
          text: isLaneOpponent
            ? `⚔️ Wins 1v1 vs ${enemy.name} (+${d.toFixed(1)}% WR)`
            : `⚔️ Beats ${enemy.name} (+${d.toFixed(1)}% WR)`,
          delta: +(d * laneMult).toFixed(1)
        });
      } else if (loreStrong.has(eid)) {
        totalDelta += 4.2 * laneMult;
        reasons.push({
          type: "counter-good",
          text: `⚔️ Hard Counters ${enemy.name}`,
          delta: 2.0
        });
      }

      if (counteredMap.has(eid)) {
        const d = counteredMap.get(eid); // negative number
        totalDelta += d * 2.45 * laneMult;
        reasons.push({
          type: "warn-counter",
          text: `⚠️ Countered by ${enemy.name} (${d.toFixed(1)}% WR)`,
          delta: d
        });
      } else if (loreWeak.has(eid)) {
        totalDelta -= 4.5 * laneMult;
        reasons.push({
          type: "warn-counter",
          text: `⚠️ Weak into ${enemy.name}`,
          delta: -2.0
        });
      }

      // Check reverse lookup: does enemy's own data say this hero counters them or beats them?
      const enemyTf = getHeroTimeframeStats(enemy, state.timeframe);
      const enemyCounteredByMe = (enemyTf.countered_by || []).find((x) => x.heroid === hero.id);
      if (enemyCounteredByMe && !beatenMap.has(eid)) {
        const boost = Math.abs(enemyCounteredByMe.delta_wr) * laneMult;
        totalDelta += boost * 2.1;
        reasons.push({
          type: "counter-good",
          text: `⚔️ Counters ${enemy.name} (+${boost.toFixed(1)}% Edge)`,
          delta: boost
        });
      }
      const enemyBeatsMe = (enemyTf.counters_beaten || []).find((x) => x.heroid === hero.id);
      if (enemyBeatsMe && !counteredMap.has(eid)) {
        const drop = -Math.abs(enemyBeatsMe.delta_wr) * laneMult;
        totalDelta += drop * 1.95;
        reasons.push({
          type: "warn-counter",
          text: `⚠️ Struggles vs ${enemy.name} (${drop.toFixed(1)}%)`,
          delta: drop
        });
      }
    }

    // =========================================================================
    // DEEP 8-VECTOR ENEMY COMPOSITION VULNERABILITY EXPLOITATION (OMEGA AI)
    // =========================================================================
    // 1) Anti-Dash Grounding vs Mobile Enemy Lineup
    if (enemyDashCount >= 2 && [106, 78, 74, 62, 15, 3, 9, 99].includes(hero.id)) {
      const antiDashBonus = enemyDashCount * 4.5;
      totalDelta += antiDashBonus;
      reasons.unshift({
        type: "counter-good",
        text: `🛑 Anti-Dash Lockdown vs ${enemyDashCount} Mobile Enemies`,
        delta: +(enemyDashCount * 1.9).toFixed(1)
      });
    }

    // 2) Setter Tank Purify / Disengage Punish
    if (enemySetterCount >= 1 && [48, 57, 110, 9].includes(hero.id)) {
      const setterBonus = hero.id === 48 ? 11.5 : 7.8;
      totalDelta += setterBonus;
      reasons.unshift({
        type: "counter-good",
        text: hero.id === 48 ? "🛡️ Diggie Ult Nullifies Enemy Setter Tank" : "🔥 Punishes Enemy Tank Engage",
        delta: +(setterBonus / 2.4).toFixed(1)
      });
    }

    // 3) Anti-Heal & Sustain Shred vs Regen Lineup
    if (enemyRegenCount >= 2 && [87, 92, 40, 123, 85, 68].includes(hero.id)) {
      totalDelta += 8.0;
      reasons.unshift({
        type: "counter-good",
        text: "💔 Shreds Enemy Sustain / Healing Deathball",
        delta: 3.4
      });
    }

    // 4) % HP True-Damage Tank Shredder vs Multi-Tank / Beefy Enemy Lineup
    if (enemyTankyCount >= 2 && TANK_SHREDDER_IDS.has(hero.id)) {
      const shredBonus = enemyTankyCount * 4.8;
      totalDelta += shredBonus;
      reasons.unshift({
        type: "counter-good",
        text: `🔥 Tank-Shredder Melts ${enemyTankyCount} High-HP Frontliners`,
        delta: +(shredBonus / 2.2).toFixed(1)
      });
    }

    // 5) Lolita (#20) Projectile Reflect Shield vs 2+ Projectile Carries
    if (hero.id === 20 && enemyProjectileCount >= 2) {
      const lolitaBonus = enemyProjectileCount * 5.6;
      totalDelta += lolitaBonus;
      reasons.unshift({
        type: "counter-good",
        text: `🛡️ Lolita Shield Reflects ${enemyProjectileCount} Enemy Projectile Carries!`,
        delta: +(lolitaBonus / 2.2).toFixed(1)
      });
    }

    // 6) Valentina (#110) S-Tier Ultimate Hijack
    if (hero.id === 110 && enemyUltValueCount >= 2) {
      const valBonus = enemyUltValueCount * 5.2;
      totalDelta += valBonus;
      reasons.unshift({
        type: "counter-good",
        text: `👑 Valentina Hijacks ${enemyUltValueCount} High-Impact Enemy Ultimates`,
        delta: +(valBonus / 2.2).toFixed(1)
      });
    }

    // 7) Zero-Lockdown Assassin / Raid-Boss Unleash (Enemy drafted 3+ heroes with 0 Hard CC!)
    if (
      enemyHeroIds.length >= 3 &&
      !enemyHasHardLockdown &&
      [17, 84, 118, 21, 22, 133, 89, 47, 97, 126].includes(hero.id)
    ) {
      totalDelta += 11.5;
      reasons.unshift({
        type: "counter-good",
        text: "💀 Enemy Lacks Hard Suppress — Free Hyper-Carry Game!",
        delta: 4.8
      });
    }

    // 8) Backline Dive & Artillery vs Immobile Enemy Carries
    if (
      enemyImmobileCount >= 2 &&
      [95, 84, 21, 37, 93, 128, 26, 41, 119, 52, 122].includes(hero.id)
    ) {
      totalDelta += 7.5;
      reasons.push({
        type: "counter-good",
        text: `🦅 Dives ${enemyImmobileCount} Immobile Enemy Backliners`,
        delta: 3.1
      });
    }

    // 9) Armor-Stack Punish vs All-Physical Enemy Lineup
    if (
      enemyHeroIds.length >= 3 &&
      enemyMagicCount === 0 &&
      [70, 41, 87, 82, 117, 49].includes(hero.id)
    ) {
      totalDelta += 8.5;
      reasons.push({
        type: "counter-good",
        text: "🛡️ Armor-Stacking Punishes All-Physical Enemy",
        delta: 3.5
      });
    }

    return { totalDelta: +totalDelta.toFixed(2), reasons };
  }

  function evaluateHeroSynergyWithAllies(hero, allyHeroIds) {
    const tf = getHeroTimeframeStats(hero, state.timeframe);
    let totalSynergy = 0;
    const reasons = [];

    const bestMap = new Map();
    for (const s of tf.best_teammates || []) bestMap.set(s.heroid, s.delta_wr);
    const worstMap = new Map();
    for (const s of tf.worst_teammates || []) worstMap.set(s.heroid, s.delta_wr);
    const loreAssist = new Set((hero.lore_relations && hero.lore_relations.assist_ids) || []);

    for (const aid of allyHeroIds) {
      const ally = state.heroMap.get(aid);
      if (!ally) continue;

      if (bestMap.has(aid)) {
        const d = bestMap.get(aid);
        totalSynergy += d * 2.2;
        reasons.push({
          type: "synergy-good",
          text: `🤝 Synergy w/ ${ally.name} (+${d.toFixed(1)}% WR)`,
          delta: d
        });
      } else if (loreAssist.has(aid)) {
        totalSynergy += 3.8;
        reasons.push({
          type: "synergy-good",
          text: `🤝 Pro Combo w/ ${ally.name}`,
          delta: 1.8
        });
      }

      if (worstMap.has(aid)) {
        const d = worstMap.get(aid);
        totalSynergy += d * 1.8;
      }

      // Check reverse teammate lookup
      const allyTf = getHeroTimeframeStats(ally, state.timeframe);
      const revBest = (allyTf.best_teammates || []).find((x) => x.heroid === hero.id);
      if (revBest && !bestMap.has(aid)) {
        totalSynergy += revBest.delta_wr * 1.9;
        reasons.push({
          type: "synergy-good",
          text: `🤝 Combo w/ ${ally.name} (+${revBest.delta_wr.toFixed(1)}%)`,
          delta: revBest.delta_wr
        });
      }
    }

    return { totalSynergy: +totalSynergy.toFixed(2), reasons };
  }

  /**
   * Evaluates MPL Pro Tournament Duo/Trio Combo Completion & Double-Turn Setup (R1+R2, B2+B3, B4+B5)
   */
  function evaluateMplProComboBonus(hero, allyHeroIds, allyMissingLanes, isFirstOfDoublePick, unavailable) {
    let comboBonus = 0;
    const comboTags = [];

    for (const pkg of MPL_PRO_COMBOS) {
      const isCore = pkg.cores.includes(hero.id);
      const isPartner = pkg.partners.includes(hero.id);
      if (!isCore && !isPartner) continue;

      // Case 1: An ally ALREADY locked the other half of this MPL Signature Duo!
      const lockedPartnerIds = isCore ? pkg.partners : pkg.cores;
      const matchedAllyId = allyHeroIds.find((aid) => lockedPartnerIds.includes(aid));
      if (matchedAllyId) {
        const allyHero = state.heroMap.get(matchedAllyId);
        comboBonus += pkg.bonus;
        comboTags.push({
          type: "synergy-good",
          text: `🏆 MPL Duo w/ ${allyHero ? allyHero.name : "Ally"} (${pkg.name})`
        });
        break;
      }

      // Case 2: Paired Double-Turn Setup (R1+R2, B2+B3, B4+B5) — initiate duo if partner is available & open!
      if (isFirstOfDoublePick && state.aiStyle === "god") {
        const availPartners = lockedPartnerIds.filter((pid) => {
          if (unavailable.has(pid) || pid === hero.id) return false;
          const ph = state.heroMap.get(pid);
          return ph && ph.flex_lanes.some((ln) => allyMissingLanes.includes(ln));
        });
        if (availPartners.length > 0) {
          const bestPartner = state.heroMap.get(availPartners[0]);
          comboBonus += 9.5;
          comboTags.push({
            type: "mpl-priority",
            text: `⚡ Double-Pick Setup w/ ${bestPartner ? bestPartner.name : "Partner"}`
          });
          break;
        }
      }
    }

    return { comboBonus: +comboBonus.toFixed(2), comboTags };
  }

  /**
   * Evaluates how strongly a hero fits the currently selected MLBB Battlefield Map
   * (Healing Turtle, Golden Turret, Revealing Wisps / Detection Flares, or Flying Cloud)
   */
  function evaluateHeroMapFit(hero, mapKey = state.selectedMap) {
    const mapCfg = MLBB_MAPS[mapKey] || MLBB_MAPS.healing_turtle;
    if (!hero || !mapCfg) {
      return { mapBonus: 0, banMapBonus: 0, mapTier: "NEUTRAL", mapTag: null, badgeLabel: null };
    }

    if (mapCfg.tier_s_plus_ids.has(hero.id)) {
      return {
        mapBonus: 14.0,
        banMapBonus: 10.5,
        mapTier: "S+",
        badgeLabel: `${mapCfg.icon} ${mapCfg.shortName} S+`,
        mapTag: {
          type: "map-good",
          text: `${mapCfg.icon} ${mapCfg.name} S+ Fit (${mapCfg.comp_short})`
        }
      };
    }

    if (mapCfg.tier_s_ids.has(hero.id)) {
      return {
        mapBonus: 8.0,
        banMapBonus: 5.5,
        mapTier: "S",
        badgeLabel: `${mapCfg.icon} ${mapCfg.shortName} S`,
        mapTag: {
          type: "map-good",
          text: `${mapCfg.icon} Strong Map Fit on ${mapCfg.name}`
        }
      };
    }

    if (mapCfg.avoid_ids.has(hero.id)) {
      return {
        mapBonus: -10.5,
        banMapBonus: -12.0,
        mapTier: "AVOID",
        badgeLabel: null,
        mapTag: {
          type: "map-warn",
          text: `⚠️ ${mapCfg.avoid_reason}`
        }
      };
    }

    return { mapBonus: 0, banMapBonus: 0, mapTier: "NEUTRAL", mapTag: null, badgeLabel: null };
  }

  /**
   * Evaluates Map-Specific 5v5 Team Composition Requirements so the AI & Coach
   * assemble a complete, map-effect-optimized lineup for the selected map!
   */
  function evaluateMapTeamCompNeeds(hero, allyPicks, matchingLane, mapKey = state.selectedMap) {
    if (!matchingLane) return { compBonus: 0, compTag: null };
    const mapCfg = MLBB_MAPS[mapKey] || MLBB_MAPS.healing_turtle;

    if (mapKey === "healing_turtle") {
      const hasTurtleRetri = allyPicks.some((id) => mapCfg.turtle_retri_ids.has(id));
      const sustainCount = allyPicks.filter((id) => mapCfg.sustain_brawl_ids.has(id)).length;

      if (!hasTurtleRetri && mapCfg.turtle_retri_ids.has(hero.id)) {
        return {
          compBonus: 9.5,
          compTag: {
            type: "map-good",
            text: "🐢 Turtle Comp Need: Early 2:00 Turtle Secure & Zoning"
          }
        };
      }
      if (sustainCount < 2 && mapCfg.sustain_brawl_ids.has(hero.id)) {
        return {
          compBonus: 8.0,
          compTag: {
            type: "map-good",
            text: "🐢 Turtle Comp Need: AoE Heal & Sustain Brawl Synergy"
          }
        };
      }
    } else if (mapKey === "golden_turret") {
      const hasTurretShred = allyPicks.some((id) => mapCfg.turret_shred_ids.has(id));
      const hasMacroRotate = allyPicks.some((id) => mapCfg.macro_rotate_ids.has(id));

      if (!hasTurretShred && mapCfg.turret_shred_ids.has(hero.id)) {
        return {
          compBonus: 9.5,
          compTag: {
            type: "map-good",
            text: "🏰 Turret Comp Need: High-HP Golden Turret Shredder"
          }
        };
      }
      if (!hasMacroRotate && mapCfg.macro_rotate_ids.has(hero.id)) {
        return {
          compBonus: 8.0,
          compTag: {
            type: "map-good",
            text: "🏰 Turret Comp Need: Fast Gold-Plate Rotation Macro"
          }
        };
      }
    } else if (mapKey === "revealing_wisps") {
      const hasArtillerySniper = allyPicks.some((id) => mapCfg.artillery_sniper_ids.has(id));
      const frontToBackCount = allyPicks.filter((id) => mapCfg.front_to_back_ids.has(id)).length;

      if (!hasArtillerySniper && mapCfg.artillery_sniper_ids.has(hero.id)) {
        return {
          compBonus: 9.5,
          compTag: {
            type: "map-good",
            text: "🔮 Wisps Comp Need: Long-Range Flare/Wisp Artillery Sniper"
          }
        };
      }
      if (frontToBackCount < 2 && mapCfg.front_to_back_ids.has(hero.id)) {
        return {
          compBonus: 8.0,
          compTag: {
            type: "map-good",
            text: "🔮 Wisps Comp Need: Front-to-Back Vision Zone Control"
          }
        };
      }
    } else if (mapKey === "flying_cloud") {
      const hasHighGroundClear = allyPicks.some((id) => mapCfg.highground_clear_ids.has(id));
      const hasAerialDive = allyPicks.some((id) => mapCfg.aerial_dive_ids.has(id));

      if (!hasHighGroundClear && mapCfg.highground_clear_ids.has(hero.id)) {
        return {
          compBonus: 9.0,
          compTag: {
            type: "map-good",
            text: "☁️ Cloud Comp Need: High-Ground Wave-Clear Defense"
          }
        };
      }
      if (!hasAerialDive && mapCfg.aerial_dive_ids.has(hero.id)) {
        return {
          compBonus: 8.5,
          compTag: {
            type: "map-good",
            text: "☁️ Cloud Comp Need: 5v5 Aerial Dive Initiator"
          }
        };
      }
    }

    return { compBonus: 0, compTag: null };
  }

  /**
   * Draft Phase Order Discipline & Blind-Pick Vulnerability Protection (Omega God Mode):
   * - In Phase 1 (Picks 1-3): Rewards blind-safe multi-lane flex picks & penalizes easily-countered
   *   heroes (Atlas while Diggie open, Fanny/Ling while Khufra/Franco open, premature niche counters).
   * - In Phase 2 (Picks 4-5): Unleashes high-ceiling hyper-carries & setters once enemy counter slots are locked/banned!
   */
  function evaluateDraftPhaseTiming(hero, allyPicks, enemyPicks, enemyMissingLanes, unavailable) {
    if (state.aiStyle !== "god") return { phaseBonus: 0, phaseTag: null };

    const isPhase1Pick = allyPicks.length < 3;
    const vuln = BLIND_PICK_VULNERABILITY[hero.id];

    if (isPhase1Pick) {
      // Check if this hero is vulnerable to a hard counter that is STILL UNBANNED and fits an open enemy lane!
      if (vuln) {
        const openCounters = vuln.counters.filter((cid) => !unavailable.has(cid));
        const enemyCanDraftCounter = enemyMissingLanes.includes(vuln.lane) || enemyPicks.length < 3;
        if (openCounters.length > 0 && enemyCanDraftCounter) {
          return {
            phaseBonus: -13.5,
            phaseTag: {
              type: "warn-counter",
              text: `⚠️ Blind-Pick Risk: ${vuln.label}`
            }
          };
        }
      }

      // Prevent premature niche reactive counters on Turn 1/2 when enemy hasn't shown the target archetype yet
      if (hero.id === 48 && !enemyPicks.some((id) => AOE_SETTER_IDS.has(id))) {
        return { phaseBonus: -16.0, phaseTag: null };
      }
      if ([106, 74].includes(hero.id) && !enemyPicks.some((id) => DASH_HERO_IDS.has(id))) {
        return { phaseBonus: -12.5, phaseTag: null };
      }
      if (hero.id === 20 && !enemyPicks.some((id) => PROJECTILE_CARRY_IDS.has(id))) {
        return { phaseBonus: -12.5, phaseTag: null };
      }

      // Reward MPL Safe Phase-1 Blind / Flex Priority Picks
      if (SAFE_PHASE1_BLIND_IDS.has(hero.id)) {
        return {
          phaseBonus: 7.5,
          phaseTag: {
            type: "mpl-priority",
            text: "🛡️ Safe MPL Phase-1 Blind/Flex Priority"
          }
        };
      }
    } else {
      // Phase 2 (B4, B5, R4, R5): Check if a high-ceiling hero's counters are all banned or locked out!
      if (vuln) {
        const openCounters = vuln.counters.filter((cid) => !unavailable.has(cid));
        const enemyCounterSlotClosed = !enemyMissingLanes.includes(vuln.lane);
        if (openCounters.length === 0 || enemyCounterSlotClosed) {
          return {
            phaseBonus: 12.5,
            phaseTag: {
              type: "mpl-priority",
              text: "👑 Uncounterable Phase-2 Last-Pick Window!"
            }
          };
        }
      }
    }

    return { phaseBonus: 0, phaseTag: null };
  }

  /**
   * Rolls fresh MPL Championship Strategy Blueprints & Per-Match Strategic Ban Weights
   * so the AI NEVER repeats fixed mechanical bans and always drafts/bans around a cohesive
   * team composition strategy tailored to the active map!
   */
  function sampleSubsetFromSet(setObj, count) {
    const arr = Array.from(setObj);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return new Set(arr.slice(0, count));
  }

  function rollMatchStrategyBlueprints() {
    const mapKey = state.selectedMap || "healing_turtle";
    const mapFavored = BLUEPRINT_KEYS.filter((k) =>
      MPL_STRATEGY_BLUEPRINTS[k].preferred_maps.includes(mapKey)
    );
    const basePool = mapFavored.length >= 2 ? mapFavored : BLUEPRINT_KEYS;

    // Never repeat the exact same blueprint as the previous match!
    const blueCandidates = basePool.filter((k) => k !== state.lastBlueBlueprintKey);
    const bluePool = blueCandidates.length ? blueCandidates : basePool;
    const bluePick = bluePool[Math.floor(Math.random() * bluePool.length)];

    const redCandidates = basePool.filter(
      (k) => k !== bluePick && k !== state.lastRedBlueprintKey
    );
    const redPool = redCandidates.length
      ? redCandidates
      : BLUEPRINT_KEYS.filter((k) => k !== bluePick);
    const redPick = redPool[Math.floor(Math.random() * redPool.length)];

    state.blueBlueprintKey = bluePick;
    state.redBlueprintKey = redPick;
    state.lastBlueBlueprintKey = bluePick;
    state.lastRedBlueprintKey = redPick;

    // Sample concrete per-match Priority Ban Plan & Desired Core Lineup from the active strategy
    const blueBp = MPL_STRATEGY_BLUEPRINTS[bluePick];
    const redBp = MPL_STRATEGY_BLUEPRINTS[redPick];
    state.bluePriorityBans = sampleSubsetFromSet(blueBp.ban_targets, 4);
    state.redPriorityBans = sampleSubsetFromSet(redBp.ban_targets, 4);
    state.bluePriorityCores = sampleSubsetFromSet(blueBp.core_ids, 5);
    state.redPriorityCores = sampleSubsetFromSet(redBp.core_ids, 5);

    // Per-match strategic ban priority jitter so top ban candidates rotate naturally by gameplan
    const jitter = new Map();
    for (const h of state.heroes) {
      jitter.set(h.id, +((Math.random() - 0.35) * 11.0).toFixed(2));
    }
    state.matchBanJitter = jitter;
  }

  /**
   * Resolves & Dynamically Adapts a Team's Active MPL Strategy Blueprint Mid-Draft:
   * - Starts with the rolled blueprint for this match & map.
   * - If the opponent bans/steals our core heroes OR drafts a lineup that another
   *   blueprint hard-counters (e.g., Enemy stacks tanks -> pivot to Anti-Meta Lockdown),
   *   the AI dynamically pivots its strategy!
   */
  function resolveActiveTeamBlueprint(side, allyPicks, enemyPicks, unavailable) {
    if (!state.blueBlueprintKey || !state.redBlueprintKey) {
      rollMatchStrategyBlueprints();
    }
    const initialKey = side === "blue" ? state.blueBlueprintKey : state.redBlueprintKey;
    let bestKey = initialKey;
    let bestUtility = -1e9;

    const enemyDashCount = enemyPicks.filter((id) => DASH_HERO_IDS.has(id)).length;
    const enemyTankCount = enemyPicks.filter((id) => {
      const h = state.heroMap.get(id);
      return h && (h.roles.includes("Tank") || h.stats_rating.durability >= 72);
    }).length;
    const enemyImmobileCount = enemyPicks.filter((id) => IMMOBILE_BACKLINE_IDS.has(id)).length;

    for (const key of BLUEPRINT_KEYS) {
      const bp = MPL_STRATEGY_BLUEPRINTS[key];
      let u = key === initialKey ? 18.0 : 0; // loyalty to initial match gameplan unless out-valued

      if (bp.preferred_maps.includes(state.selectedMap)) u += 8.0;

      // How many of our already-locked allies belong to this blueprint?
      for (const aid of allyPicks) {
        if (bp.core_ids.has(aid)) u += 14.0;
        else if (bp.support_ids.has(aid)) u += 7.5;
      }

      // How many core heroes of this blueprint are still available?
      let availCores = 0;
      bp.core_ids.forEach((cid) => {
        if (!unavailable.has(cid)) availCores++;
      });
      u += Math.min(5, availCores) * 2.5;

      // Counter-Adaptation vs Enemy's Revealed Lineup
      if (key === "anti_meta_lockdown" && (enemyDashCount >= 2 || enemyTankCount >= 2)) {
        u += (enemyDashCount + enemyTankCount) * 7.5;
      }
      if (key === "pickoff_dive_tempo" && enemyImmobileCount >= 2) {
        u += enemyImmobileCount * 8.0;
      }
      if (key === "wombo_setter_aoe" && unavailable.has(48)) {
        // Diggie is banned! Wombo-Combo Setter is wide open!
        u += 11.0;
      }

      if (u > bestUtility) {
        bestUtility = u;
        bestKey = key;
      }
    }

    if (side === "blue") state.blueBlueprintKey = bestKey;
    else state.redBlueprintKey = bestKey;

    return MPL_STRATEGY_BLUEPRINTS[bestKey] || MPL_STRATEGY_BLUEPRINTS.raid_boss_hyper;
  }

  /**
   * Adversarial Strategy Detective (Disables Enemy Plan Composition):
   * Infers the Opponent's Intended Team Composition Blueprint from their:
   * 1) Proactive Bans (e.g. banning Diggie = Wombo-Setter; banning Baxia = Raid-Boss; banning Khufra = Dive Tempo)
   * 2) Locked Hero Picks (core hero = +34 pts, support enabler = +16 pts)
   * 3) Preferred Map terrain synergy
   * Enables the AI to proactively sabotage and strangle the opponent's strategy before they complete it!
   */
  function inferEnemyStrategyBlueprint(enemyPicks, enemyBans) {
    let bestKey = null;
    let bestScore = -1e9;

    for (const key of BLUEPRINT_KEYS) {
      const bp = MPL_STRATEGY_BLUEPRINTS[key];
      let score = 0;

      // 1) Did the enemy ban counters to this blueprint?
      for (const bid of enemyBans) {
        if (!bid) continue;
        if (bp.ban_targets.has(bid)) score += 26.0; // strong early tell
        if (bp.core_ids.has(bid)) score -= 38.0;   // enemy wouldn't ban their own core
      }

      // 2) Did the enemy draft core or support heroes of this blueprint?
      for (const pid of enemyPicks) {
        if (!pid) continue;
        if (bp.core_ids.has(pid)) score += 36.0;   // definitive confirmation
        else if (bp.support_ids.has(pid)) score += 16.0;
      }

      // 3) Map terrain synergy
      if (bp.preferred_maps.includes(state.selectedMap)) {
        score += 5.5;
      }

      if (score > bestScore) {
        bestScore = score;
        bestKey = key;
      }
    }

    return {
      blueprint: bestScore >= 16.0 && bestKey ? MPL_STRATEGY_BLUEPRINTS[bestKey] : null,
      confidence: bestScore >= 34.0 ? "high" : bestScore >= 20.0 ? "medium" : "early",
      score: bestScore
    };
  }

  /**
   * Verifies via exact bipartite matching whether [...allyPicks, candidateHeroId]
   * can be assigned to (allyPicks.length + 1) distinct lanes where EVERY hero is in its valid flex_lanes!
   */
  function canAssignDistinctFlexLanes(allyPicks, candidateHeroId) {
    const ids = [...allyPicks, candidateHeroId];
    if (ids.length > 5) return false;
    const used = new Array(ALL_LANES.length).fill(false);

    function dfs(idx) {
      if (idx === ids.length) return true;
      const h = state.heroMap.get(ids[idx]);
      const flex = (h && h.flex_lanes && h.flex_lanes.length) ? h.flex_lanes : ALL_LANES;
      for (let i = 0; i < ALL_LANES.length; i++) {
        if (used[i]) continue;
        if (!flex.includes(ALL_LANES[i])) continue;
        used[i] = true;
        if (dfs(idx + 1)) return true;
        used[i] = false;
      }
      return false;
    }

    return dfs(0);
  }

  /**
   * ZERO-LACK 5-PILLAR STRUCTURAL MANDATE (Guarantees Unbeatable S+ Team Composition with 0 Weaknesses):
   * Enforces:
   * 1) 100% Distinct 5-Lane Flex Coverage (Hard Veto if overlapping lane)
   * 2) Mandatory Magic Damage (Mage role)
   * 3) Mandatory Marksman / Late-Game Objective Siege DPS (Marksman role)
   * 4) Mandatory Sturdy Frontline (Team Durability >= 62)
   * 5) Mandatory Crowd Control Lockdown (Team Control >= 60)
   */
  function evaluateZeroLackMandate(hero, allyPicks, matchingLane) {
    let mandateBonus = 0;
    const mandateTags = [];

    // Pillar 1: Strict Bipartite Flex-Lane Feasibility Check (Zero Lane Overlap Allowed!)
    if (!canAssignDistinctFlexLanes(allyPicks, hero.id)) {
      return {
        mandateBonus: -145.0,
        mandateTags: [{ type: "warn-counter", text: "⚠️ Role Overlap: Breaks 5-Lane Coverage" }]
      };
    }

    if (!matchingLane) {
      return { mandateBonus: -60.0, mandateTags: [] };
    }

    const allyHeroes = allyPicks.map((id) => state.heroMap.get(id)).filter(Boolean);
    const slotsRemaining = 5 - allyPicks.length; // including current pick (5..1)

    const hasMage = allyHeroes.some((h) => h.roles.includes("Mage"));
    const hasMarksman = allyHeroes.some((h) => h.roles.includes("Marksman"));
    const hasTankFrontline = allyHeroes.some(
      (h) => h.roles.includes("Tank") || h.stats_rating.durability >= 74
    );

    const curDurSum = allyHeroes.reduce((acc, h) => acc + h.stats_rating.durability, 0);
    const curCtrlSum = allyHeroes.reduce((acc, h) => acc + h.stats_rating.control, 0);

    const heroIsMage = hero.roles.includes("Mage");
    const heroIsMarksman = hero.roles.includes("Marksman");
    const heroIsFrontline = hero.roles.includes("Tank") || hero.stats_rating.durability >= 72;
    const heroIsHighCC = HARD_LOCKDOWN_IDS.has(hero.id) || hero.stats_rating.control >= 68;

    // Count how many mandatory role classes (Mage, Marksman, Frontline) are STILL missing
    const missingMandatoryCount =
      (hasMage ? 0 : 1) + (hasMarksman ? 0 : 1) + (hasTankFrontline ? 0 : 1);

    // If slotsRemaining <= missingMandatoryCount, this pick MUST fulfill at least one missing pillar!
    const fulfillsMissingPillar =
      (!hasMage && heroIsMage) ||
      (!hasMarksman && heroIsMarksman) ||
      (!hasTankFrontline && heroIsFrontline);

    if (slotsRemaining <= missingMandatoryCount && !fulfillsMissingPillar) {
      mandateBonus -= 75.0;
    }

    // Pillar 2: Magic Damage Mandate
    if (!hasMage) {
      if (heroIsMage) {
        const urgency = slotsRemaining <= 2 ? 26.0 : 14.0;
        mandateBonus += urgency;
        mandateTags.push({
          type: "synergy-good",
          text: "🔮 Zero-Lack Core: Completes Magic Damage"
        });
      } else if (matchingLane === "Mid Lane") {
        mandateBonus -= 42.0; // Never put a non-Mage in Mid if team lacks Mage!
      }
    }

    // Pillar 3: Marksman or Validated MPL Gold-Lane Flex Carry DPS Mandate
    const allyHasGoldFlexCarry = allyPicks.some((id) => MPL_GOLD_FLEX_IDS.has(id));
    const hasObjectiveDps = hasMarksman || allyHasGoldFlexCarry;
    const heroCoversObjectiveDps = heroIsMarksman || MPL_GOLD_FLEX_IDS.has(hero.id);
    if (!hasObjectiveDps) {
      if (heroCoversObjectiveDps) {
        const urgency = slotsRemaining <= 2 ? 26.0 : 14.0;
        mandateBonus += heroIsMarksman ? urgency : urgency * 0.92;
        mandateTags.push({
          type: "synergy-good",
          text: heroIsMarksman
            ? "🏹 Zero-Lack Core: Completes Marksman Siege DPS"
            : `🏆 MPL PH Gold Carry: ${hero.name} Solves Siege DPS`
        });
      } else if (matchingLane === "Gold Lane" && slotsRemaining <= 2) {
        mandateBonus -= 42.0; // Ensure Marksman or validated MPL Gold-Flex Carry is present for 0 weaknesses!
      }
    }

    // Pillar 4: Sturdy Frontline Durability Mandate (Target Team Avg Durability >= 62)
    const projAvgDur = (curDurSum + hero.stats_rating.durability) / (allyPicks.length + 1);
    if (!hasTankFrontline || projAvgDur < 58) {
      if (heroIsFrontline) {
        const urgency = slotsRemaining <= 2 ? 24.0 : 14.5;
        mandateBonus += urgency;
        mandateTags.push({
          type: "synergy-good",
          text: "🛡️ Zero-Lack Core: Anchors Sturdy Frontline"
        });
      } else if (
        (matchingLane === "Roam" || matchingLane === "EXP Lane") &&
        hero.stats_rating.durability < 55
      ) {
        mandateBonus -= 32.0; // Prevent double-squishy Roam/EXP when frontline is needed!
      }
    }

    // Pillar 5: Elite Crowd Control Lockdown Mandate (Target Team Avg Control >= 60)
    const projAvgCtrl = (curCtrlSum + hero.stats_rating.control) / (allyPicks.length + 1);
    if (projAvgCtrl < 56 || !allyHeroes.some((h) => HARD_LOCKDOWN_IDS.has(h.id))) {
      if (heroIsHighCC) {
        const urgency = slotsRemaining <= 2 ? 19.5 : 11.5;
        mandateBonus += urgency;
        mandateTags.push({
          type: "synergy-good",
          text: "⛓️ Zero-Lack Core: Locks Elite Crowd Control"
        });
      } else if (slotsRemaining === 1 && projAvgCtrl < 44) {
        mandateBonus -= 35.0;
      }
    }

    return { mandateBonus: +mandateBonus.toFixed(2), mandateTags };
  }

  /**
   * 1-Step & 2-Step Adversarial Deny-Pick Lookahead (Omega God Mode):
   * Calculates how strongly the Enemy wants this hero on their very next turn,
   * and rewards stealing/denying it if it also fits one of our open lanes!
   */
  function computeDenyPickBonus(hero, allyPicks, enemyPicks, allyMissingLanes, enemyMissingLanes, allyPickSlots) {
    if (state.aiStyle !== "god" || enemyPicks.length === 0) {
      return { denyBonus: 0, denyTag: null };
    }
    const fitsOurOpenLane = hero.flex_lanes.some((ln) => allyMissingLanes.includes(ln));
    const fitsEnemyOpenLane = hero.flex_lanes.some((ln) => enemyMissingLanes.includes(ln));
    if (!fitsOurOpenLane || !fitsEnemyOpenLane) {
      return { denyBonus: 0, denyTag: null };
    }

    const enemyTargetLane = hero.flex_lanes.find((ln) => enemyMissingLanes.includes(ln));
    const enemySynergy = evaluateHeroSynergyWithAllies(hero, enemyPicks);
    const countersOurTeam = evaluateHeroMatchupVsTeam(hero, allyPicks, allyPickSlots, enemyTargetLane);
    const enemyMplCombo = evaluateMplProComboBonus(hero, enemyPicks, enemyMissingLanes, false, new Set());
    const mapFit = evaluateHeroMapFit(hero, state.selectedMap);

    const enemyDesire =
      enemySynergy.totalSynergy * 0.9 +
      Math.max(0, countersOurTeam.totalDelta) * 0.95 +
      enemyMplCombo.comboBonus * 0.85 +
      Math.max(0, mapFit.mapBonus) * 0.4;

    if (enemyDesire >= 8.5) {
      const cappedBonus = Math.min(16.0, +(enemyDesire * 0.72).toFixed(1));
      return {
        denyBonus: cappedBonus,
        denyTag: {
          type: "warn-counter",
          text: `😈 Deny-Pick: Steals Enemy #1 Counter/Combo (+${cappedBonus} Value)`
        }
      };
    }
    return { denyBonus: 0, denyTag: null };
  }

  /**
   * Computes Turn-Specific Elya Coach & Omega AI Score for every hero
   */
  function computeTurnRecommendations(limit = 133) {
    const turn = getCurrentTurn();
    const unavailable = getUnavailableHeroIds();

    const activeSide = turn ? turn.side : "blue";
    const actionType = turn ? turn.type : "pick";

    const allyPickSlots = activeSide === "blue" ? state.bluePicks : state.redPicks;
    const enemyPickSlots = activeSide === "blue" ? state.redPicks : state.bluePicks;
    const allyBanSlots = activeSide === "blue" ? state.blueBans : state.redBans;
    const enemyBanSlots = activeSide === "blue" ? state.redBans : state.blueBans;

    const allyPicks = allyPickSlots.map((p) => p.heroId).filter(Boolean);
    const enemyPicks = enemyPickSlots.map((p) => p.heroId).filter(Boolean);
    const allyBans = allyBanSlots.filter(Boolean);
    const enemyBans = enemyBanSlots.filter(Boolean);

    const allyMissingLanes = getTeamMissingLanes(allyPickSlots);
    const enemyMissingLanes = getTeamMissingLanes(enemyPickSlots);

    // 1. Resolve Active Dynamic MPL Strategy Blueprint for this side (AI's Wants Team Composition)
    const activeBlueprint = resolveActiveTeamBlueprint(
      activeSide,
      allyPicks,
      enemyPicks,
      unavailable
    );

    // 2. Infer Opponent's Intended Team Composition Blueprint (For Disabling Enemy Plan)
    const enemyPlanInfer = inferEnemyStrategyBlueprint(enemyPicks, enemyBans);
    const enemyBlueprint = enemyPlanInfer.blueprint;
    const enemyPlanConfidence = enemyPlanInfer.confidence;

    const isPhase2Ban =
      actionType === "ban" &&
      turn &&
      (turn.slotIndex >= 3 || turn.phase === "BAN PHASE 2");

    // Detect Severe Role Pinches in Enemy's Missing Lanes (Phase 2)
    const enemyLanePinchMap = new Map();
    if (isPhase2Ban) {
      for (const ln of enemyMissingLanes) {
        const openTopTier = state.heroes.filter(
          (h) =>
            !unavailable.has(h.id) &&
            h.flex_lanes.includes(ln) &&
            (h.active_meta.tier === "S+" || h.active_meta.tier === "S")
        );
        if (openTopTier.length <= 2 && openTopTier.length > 0) {
          enemyLanePinchMap.set(ln, new Set(openTopTier.map((h) => h.id)));
        }
      }
    }

    // Detect if this turn is the first half of a Paired Double-Turn (R1 on step 8, B2 on step 10, B4 on step 18)
    const seq = getActiveSequence();
    const nextTurn =
      state.activeView === "simulator" && state.stepIndex + 1 < seq.length
        ? seq[state.stepIndex + 1]
        : null;
    const isFirstOfDoublePick =
      actionType === "pick" &&
      turn &&
      nextTurn &&
      nextTurn.type === "pick" &&
      nextTurn.side === activeSide;

    // Count remaining unbanned S+ God-Tier heroes that fit the active map (excluding our own strategy cores!)
    const openSPlusHeroes = state.heroes
      .filter(
        (h) =>
          !unavailable.has(h.id) &&
          h.active_meta.tier === "S+" &&
          !activeBlueprint.core_ids.has(h.id)
      )
      .sort((a, b) => {
        const aMap = evaluateHeroMapFit(a, state.selectedMap).banMapBonus;
        const bMap = evaluateHeroMapFit(b, state.selectedMap).banMapBonus;
        const aStrat = activeBlueprint.ban_targets.has(a.id) ? 18 : 0;
        const bStrat = activeBlueprint.ban_targets.has(b.id) ? 18 : 0;
        return (
          b.active_meta.win_rate * 2.2 + bMap + bStrat - (a.active_meta.win_rate * 2.2 + aMap + aStrat)
        );
      });

    const allyHasHardLockdown = allyPicks.some((id) => HARD_LOCKDOWN_IDS.has(id));
    const allyHasSetterTank = allyPicks.some((id) => AOE_SETTER_IDS.has(id));
    const enemyHasEnchanterRoam = enemyPicks.some((id) => ENCHANTER_ROAM_IDS.has(id));

    const priorityBanSet =
      (activeSide === "blue" ? state.bluePriorityBans : state.redPriorityBans) || new Set();
    const priorityCoreSet =
      (activeSide === "blue" ? state.bluePriorityCores : state.redPriorityCores) || new Set();

    // Pre-compute AI's #1 planned Phase-2 carry so Phase-2 bans can pre-emptively ban its hard counters!
    let plannedAllyCarryIds = [];
    if (isPhase2Ban && (state.aiStyle === "mpl_ph" || state.aiStyle === "god") && allyMissingLanes.length > 0) {
      plannedAllyCarryIds = state.heroes
        .filter((h) => !unavailable.has(h.id) && h.flex_lanes.some((ln) => allyMissingLanes.includes(ln)))
        .sort((a, b) => {
          const aCore = activeBlueprint.core_ids.has(a.id) ? 22 : 0;
          const bCore = activeBlueprint.core_ids.has(b.id) ? 22 : 0;
          return (b.active_meta.win_rate * 2.5 + bCore) - (a.active_meta.win_rate * 2.5 + aCore);
        })
        .slice(0, 3)
        .map((h) => h.id);
    }

    const results = [];

    for (const hero of state.heroes) {
      if (unavailable.has(hero.id)) continue;

      const am = hero.active_meta;
      let totalScore = am.score;
      const tags = [];
      const mapFit = evaluateHeroMapFit(hero, state.selectedMap);
      const mapCfg = MLBB_MAPS[state.selectedMap] || MLBB_MAPS.healing_turtle;
      const matchJitter = (state.matchBanJitter && state.matchBanJitter.get(hero.id)) || 0;

      if (actionType === "ban") {
        // =====================================================================
        // STRATEGY-DRIVEN ADAPTIVE BAN ENGINE:
        // PILLAR 1: Connected to AI's WANTS Team Composition (Self-Blueprint Protection)
        // PILLAR 2: Disabling the Enemy's Plan Composition (Active Strategy Sabotage)
        // =====================================================================
        // Balanced competitive baseline: prevents public ranked ban_rate from forcing the same 5 bans every game!
        totalScore =
          42.0 +
          (am.win_rate - 48.0) * 1.85 +
          am.mpl_presence * 0.22 +
          Math.min(8.5, Math.sqrt(Math.max(0, am.ban_rate)) * 0.85) +
          mapFit.banMapBonus * 0.95 +
          matchJitter;

        // ---------------------------------------------------------------------
        // PILLAR 1: CONNECTED TO AI'S WANTS TEAM COMPOSITION (Self-Plan Shielding)
        // ---------------------------------------------------------------------
        // 1A. Ban heroes that directly counter AI's active strategy blueprint!
        if (activeBlueprint.ban_targets.has(hero.id)) {
          const isPriorityTarget = priorityBanSet.has(hero.id);
          const blueprintBanBonus = isPriorityTarget ? 48.0 : 35.0;
          totalScore += blueprintBanBonus;
          tags.unshift({
            type: "warn-counter",
            text: `${activeBlueprint.ban_reason}`
          });
        }

        // 1B. Planned Core Counter Shield: Does this hero hard-counter our planned core targets?
        let countersOurPlannedCores = 0;
        const hero1v1Victims = PRO_1V1_LANE_COUNTERS[hero.id];
        priorityCoreSet.forEach((coreId) => {
          if (hero1v1Victims && hero1v1Victims.has(coreId)) {
            countersOurPlannedCores += 1;
          }
        });
        if (countersOurPlannedCores > 0 && !activeBlueprint.core_ids.has(hero.id)) {
          totalScore += countersOurPlannedCores * 16.0;
          tags.unshift({
            type: "warn-counter",
            text: `🎯 Comp Shield: Counters AI's Planned ${activeBlueprint.shortName} Core`
          });
        }

        // 1C. Pre-Emptive Shield for AI's Next Pick (Phase 2):
        if (plannedAllyCarryIds.length > 0 && (state.aiStyle === "mpl_ph" || state.aiStyle === "god")) {
          const countersPlannedCarry = plannedAllyCarryIds.some(
            (cid) => PRO_1V1_LANE_COUNTERS[hero.id] && PRO_1V1_LANE_COUNTERS[hero.id].has(cid)
          );
          if (countersPlannedCarry && !activeBlueprint.core_ids.has(hero.id)) {
            totalScore += 26.0;
            tags.unshift({
              type: "warn-counter",
              text: `🛡️ Lane Shield: Counters AI's Planned Carry`
            });
          }
        }

        // 1D. Mandatory Setter Tank Shield: If AI drafted Setter Tank & Enemy Needs Roam, BAN DIGGIE (#48)!
        if (allyHasSetterTank && hero.id === 48 && enemyMissingLanes.includes("Roam")) {
          totalScore += 55.0;
          tags.unshift({
            type: "warn-counter",
            text: "🛡️ Mandatory Shield: Bans Diggie to Protect Our 5v5 Setter Plan"
          });
        }

        // 1E. ABSOLUTE SELF-STRATEGY PROTECTION: NEVER ban our own desired heroes!
        if (activeBlueprint.core_ids.has(hero.id) || priorityCoreSet.has(hero.id)) {
          const isRedBan3Snipe =
            !isPhase2Ban &&
            activeSide === "red" &&
            turn &&
            turn.slotIndex === 2 &&
            openSPlusHeroes.length >= 1 &&
            openSPlusHeroes[0].id === hero.id;
          if (!isRedBan3Snipe) {
            totalScore -= 65.0;
            tags.push({
              type: "synergy-good",
              text: `🔒 Hold Open: AI Wants for ${activeBlueprint.shortName}`
            });
          }
        } else if (activeBlueprint.support_ids.has(hero.id)) {
          totalScore -= 34.0;
          tags.push({
            type: "synergy-good",
            text: `🔒 Hold Support: AI Wants for ${activeBlueprint.shortName}`
          });
        }

        // ---------------------------------------------------------------------
        // PILLAR 2: DISABLING THE ENEMY'S PLAN COMPOSITION (Active Strategy Sabotage)
        // ---------------------------------------------------------------------
        // 2A. Inferred Enemy Strategy Blueprint Sabotage
        if (enemyBlueprint) {
          if (enemyBlueprint.core_ids.has(hero.id)) {
            const isHighConf = enemyPlanConfidence === "high";
            const planDenialBonus = isPhase2Ban
              ? (isHighConf ? 48.0 : 36.0)
              : (isHighConf ? 38.0 : 26.0);
            totalScore += planDenialBonus;
            tags.unshift({
              type: "warn-counter",
              text: `🛑 Disables Enemy Plan: Denies ${enemyBlueprint.shortName} Core (${hero.name})`
            });
          } else if (enemyBlueprint.support_ids.has(hero.id)) {
            const enablerBonus = isPhase2Ban ? 24.0 : 16.0;
            totalScore += enablerBonus;
            tags.unshift({
              type: "warn-counter",
              text: `🚫 Disables Enemy Synergy: Blocks ${enemyBlueprint.shortName} Enabler`
            });
          }
        }

        // 2B. Phase 1 Proactive Tell Sabotage (Reading Enemy's Early Bans):
        if (!isPhase2Ban) {
          // If enemy banned Diggie, enemy is clearing the way for 5v5 Setter! Ban Atlas/Tigreal!
          if (enemyBans.includes(48) && [93, 6, 19].includes(hero.id)) {
            totalScore += 40.0;
            tags.unshift({
              type: "warn-counter",
              text: "🛑 Disables Enemy Plan: Enemy Banned Diggie to Setup Wombo Setter!"
            });
          }
          // If enemy banned Baxia or Karrie, enemy is clearing the way for Raid-Boss! Ban Lukas/Freya/Angela!
          if ((enemyBans.includes(87) || enemyBans.includes(40)) && [127, 22, 55, 88].includes(hero.id)) {
            totalScore += 40.0;
            tags.unshift({
              type: "warn-counter",
              text: "🛑 Disables Enemy Plan: Enemy Banned Anti-Heal to Setup Raid-Boss!"
            });
          }
          // If enemy banned Khufra or Phoveus, enemy is clearing the way for Dive Assassins! Ban Ling/Hayabusa!
          if ((enemyBans.includes(78) || enemyBans.includes(106)) && [84, 21, 17, 133].includes(hero.id)) {
            totalScore += 40.0;
            tags.unshift({
              type: "warn-counter",
              text: "🛑 Disables Enemy Plan: Enemy Banned Anti-Dash to Setup Dive!"
            });
          }
          // If enemy banned Ling or Fanny, enemy is clearing the way for Artillery! Ban Xavier/Cecilion!
          if ((enemyBans.includes(84) || enemyBans.includes(17)) && [115, 129, 119].includes(hero.id)) {
            totalScore += 40.0;
            tags.unshift({
              type: "warn-counter",
              text: "🛑 Disables Enemy Plan: Enemy Banned Assassins to Setup Artillery!"
            });
          }

          if (mapFit.mapTier === "S+" && !activeBlueprint.core_ids.has(hero.id)) {
            totalScore += 8.5;
            tags.push({
              type: "map-good",
              text: `${mapCfg.icon} ${mapCfg.name} S+ Threat Ban`
            });
          }
          if (am.ban_rate >= 45) {
            tags.push({
              type: "mpl-priority",
              text: `🔥 ${am.ban_rate.toFixed(1)}% Mythical Glory Ban Rate`
            });
          } else if (am.mpl_presence >= 80) {
            tags.push({
              type: "mpl-priority",
              text: `🏆 ${am.mpl_presence.toFixed(0)}% MPL Respect Ban`
            });
          }

          // OMEGA GOD MODE PHASE-1 BLUE B1 TRAP vs RED R1+R2 DOUBLE S+ TRAP
          if (state.aiStyle === "god" && turn) {
            if (activeSide === "blue" && turn.slotIndex === 2 && openSPlusHeroes.length >= 2) {
              if (openSPlusHeroes[0].id === hero.id) {
                totalScore -= 24.0;
                tags.unshift({
                  type: "synergy-good",
                  text: "🧠 B1 Trap: Leave Open to First-Pick on B1"
                });
              }
            } else if (activeSide === "red" && turn.slotIndex === 2 && openSPlusHeroes.length >= 1) {
              if (openSPlusHeroes[0].id === hero.id) {
                totalScore += 16.0;
                tags.unshift({
                  type: "warn-counter",
                  text: "🛑 B1 Denial: Block Blue Side 1st Pick"
                });
              }
            }
          }
        } else {
          // PHASE 2 TARGET BAN + ADVERSARIAL ROLE CHOKE
          const fitsEnemyOpenLane = hero.flex_lanes.some((ln) => enemyMissingLanes.includes(ln));
          if (fitsEnemyOpenLane) {
            const openLaneName = hero.flex_lanes.find((ln) => enemyMissingLanes.includes(ln));
            totalScore += 26.0;
            if (mapFit.mapTier === "S+") {
              tags.push({
                type: "map-good",
                text: `${mapCfg.icon} Denies Enemy ${mapCfg.shortName} S+ (${openLaneName})`
              });
            }
            tags.push({
              type: "mpl-priority",
              text: `🎯 Target Ban: Enemy Missing ${openLaneName}`
            });

            // 1. Adversarial Mind-Read: How badly does enemy want this hero?
            const enemySynergy = evaluateHeroSynergyWithAllies(hero, enemyPicks);
            const threatToAllies = evaluateHeroMatchupVsTeam(hero, allyPicks, allyPickSlots, openLaneName);
            const enemyComboThreat = evaluateMplProComboBonus(
              hero,
              enemyPicks,
              enemyMissingLanes,
              false,
              unavailable
            );
            const enemyCompNeed = evaluateMapTeamCompNeeds(hero, enemyPicks, openLaneName, state.selectedMap);

            if (threatToAllies.totalDelta > 2.0) {
              totalScore += threatToAllies.totalDelta * 2.2;
              tags.unshift({
                type: "warn-counter",
                text: `🛡️ Blocks Hard Counter to Allies (+${threatToAllies.totalDelta.toFixed(1)})`
              });
            }
            if (enemyComboThreat.comboBonus > 0) {
              totalScore += enemyComboThreat.comboBonus * 1.6;
              tags.unshift({
                type: "warn-counter",
                text: `🛑 Breaks Enemy MPL Pro Duo Combo`
              });
            }
            if (enemySynergy.totalSynergy > 2.5) {
              totalScore += enemySynergy.totalSynergy * 1.35;
            }
            if (enemyCompNeed.compBonus > 0) {
              totalScore += enemyCompNeed.compBonus * 1.0;
            }

            // 2. Specific Archetype Disabling (Sabotaging enemy's drafted core):
            // 2A. Raid-Boss Denial: Enemy locked Enchanter Roam (Angela/Floryn/Mathilda/Rafaela)
            if (
              enemyHasEnchanterRoam &&
              [22, 127, 88, 126, 108, 99, 132, 19].includes(hero.id)
            ) {
              totalScore += 45.0;
              tags.unshift({
                type: "warn-counter",
                text: `🛑 Disables Enemy Raid-Boss Plan: Denies Hyper-Carry (${hero.name})`
              });
            }

            // 2B. Wombo-Setter Denial: Enemy locked Setter Tank (Atlas/Tigreal/Mino/Khufra/Gatotkaca)
            const enemyHasSetterTank = enemyPicks.some((id) => AOE_SETTER_IDS.has(id));
            if (
              enemyHasSetterTank &&
              [52, 96, 65, 121, 101, 105, 129, 41].includes(hero.id)
            ) {
              totalScore += 44.0;
              tags.unshift({
                type: "warn-counter",
                text: `🛑 Disables Enemy Wombo Plan: Blocks AoE Follow-Up (${hero.name})`
              });
            }

            // 2C. Dive Partner Denial: Enemy locked Mobile Assassin (Ling/Haya/Fanny/Suyou/Joy/Nolan/Hirara)
            const enemyHasMobileAssassin = enemyPicks.some((id) =>
              [84, 21, 17, 126, 122, 118, 133].includes(id)
            );
            if (
              enemyHasMobileAssassin &&
              [55, 124, 26, 95, 103, 128].includes(hero.id)
            ) {
              totalScore += 38.0;
              tags.unshift({
                type: "warn-counter",
                text: `🛑 Disables Enemy Dive Plan: Shuts Down Dive Partner (${hero.name})`
              });
            }

            // 2D. Fortress Wall Denial: Enemy locked Immobile Artillery (Layla/Xavier/Cecilion/Novaria/Pharsa)
            const enemyHasImmobileCarry = enemyPicks.some((id) =>
              IMMOBILE_BACKLINE_IDS.has(id)
            );
            if (
              enemyHasImmobileCarry &&
              [49, 70, 20, 6, 93, 117].includes(hero.id)
            ) {
              totalScore += 38.0;
              tags.unshift({
                type: "warn-counter",
                text: `🛑 Disables Enemy Fortress: Denies Frontline Peel Wall (${hero.name})`
              });
            }

            // 2E. Anti-Cheese Assassin Protection: Enemy needs Jungle and we lack hard lockdown
            if (
              !allyHasHardLockdown &&
              enemyMissingLanes.includes("Jungle") &&
              [17, 84, 21, 118, 133].includes(hero.id)
            ) {
              totalScore += 35.0;
              tags.unshift({
                type: "warn-counter",
                text: "🛡️ Anti-Cheese Ban: Denies Uncountered Assassin"
              });
            }

            // 2F. Role Pool Pinch / Strangle Ban:
            if (enemyLanePinchMap.has(openLaneName)) {
              const pinchSet = enemyLanePinchMap.get(openLaneName);
              if (pinchSet && pinchSet.has(hero.id)) {
                totalScore += 34.0;
                tags.unshift({
                  type: "mpl-priority",
                  text: `🎯 Role Pinch: Chokes Enemy Last S-Tier ${openLaneName} (${hero.name})`
                });
              }
            }
          } else {
            totalScore -= 52.0; // Enemy already drafted this role!
          }
        }

        // Trained MPL PH S18 Playoff Protective + Enemy-Denial + Lethal Combo-Breaker Ban Edge
        const trainedBan = evaluateMplTrainedBanEdge(
          hero,
          isPhase2Ban,
          activeBlueprint,
          allyPicks,
          enemyPicks,
          unavailable,
          enemyMissingLanes
        );
        if (trainedBan.score !== 0) {
          const banMult = state.aiStyle === "mpl_ph" ? 1.35 : state.aiStyle === "god" ? 1.12 : 0.85;
          totalScore += trainedBan.score * banMult;
          if (trainedBan.tag) {
            tags.unshift(trainedBan.tag);
          }
        }

        if (state.coachLaneFilter !== "auto" && !hero.flex_lanes.includes(state.coachLaneFilter)) {
          totalScore -= 30;
        }
      } else {
        // =====================================================================
        // PICK SCORING ENGINE (STRATEGY BLUEPRINT + ZERO-LACK 5-PILLAR MANDATE + 1v1 COUNTER)
        // =====================================================================
        // Pro Performance Pick Baseline: driven by Win Rate, MPL Presence, and Strategy (no public ban-rate inflation!)
        totalScore =
          48.0 +
          (am.win_rate - 48.0) * 2.35 +
          am.mpl_presence * 0.28 +
          Math.min(7.5, am.pick_rate * 0.45) +
          matchJitter * 0.45;

        const targetLanes =
          state.coachLaneFilter !== "auto" ? [state.coachLaneFilter] : allyMissingLanes;
        const matchingLane = hero.flex_lanes.find((ln) => targetLanes.includes(ln));

        const matchup = evaluateHeroMatchupVsTeam(
          hero,
          enemyPicks,
          enemyPickSlots,
          matchingLane || hero.flex_lanes[0]
        );
        const synergy = evaluateHeroSynergyWithAllies(hero, allyPicks);
        const mplCombo = evaluateMplProComboBonus(
          hero,
          allyPicks,
          allyMissingLanes,
          isFirstOfDoublePick,
          unavailable
        );
        const denyLookahead = computeDenyPickBonus(
          hero,
          allyPicks,
          enemyPicks,
          allyMissingLanes,
          enemyMissingLanes,
          allyPickSlots
        );
        const mapCompNeed = evaluateMapTeamCompNeeds(
          hero,
          allyPicks,
          matchingLane,
          state.selectedMap
        );
        const phaseTiming = evaluateDraftPhaseTiming(
          hero,
          allyPicks,
          enemyPicks,
          enemyMissingLanes,
          unavailable
        );
        const zeroLack = evaluateZeroLackMandate(hero, allyPicks, matchingLane);

        // Strategy Blueprint Cohesion Bonus (Only when not hard-countered by enemy's locked picks!)
        let blueprintBonus = 0;
        if (matchingLane && matchup.totalDelta >= -2.5) {
          if (priorityCoreSet.has(hero.id)) {
            blueprintBonus = 26.5;
            tags.push({
              type: "mpl-priority",
              text: `🎯 Priority Core: ${activeBlueprint.shortName}`
            });
          } else if (activeBlueprint.core_ids.has(hero.id)) {
            blueprintBonus = 19.0;
            tags.push({
              type: "mpl-priority",
              text: `🎯 Strategy Core: ${activeBlueprint.shortName}`
            });
          } else if (activeBlueprint.support_ids.has(hero.id)) {
            blueprintBonus = 12.0;
            tags.push({
              type: "mpl-priority",
              text: `🧩 Strategy Fit: ${activeBlueprint.shortName}`
            });
          }
        }

        // In God Mode & MPL PH Pro Mode, strictly avoid Map Avoid heroes so the AI never suffers a Map Penalty!
        const godMapAvoidPenalty =
          (state.aiStyle === "god" || state.aiStyle === "mpl_ph") && mapFit.mapTier === "AVOID"
            ? -42.0
            : 0;

        // Trained MPL PH S18 Playoff Empirical-Bayes Synergy, Counter, & Lethal Combo Pick/Steal Edge
        const trainedPick = evaluateMplTrainedPickEdge(
          hero,
          allyPicks,
          enemyPicks,
          state.aiStyle,
          allyMissingLanes,
          unavailable
        );
        const pickMult = state.aiStyle === "mpl_ph" ? 1.45 : state.aiStyle === "god" ? 1.12 : 0.85;
        const rawTrainedBonus = trainedPick.score * pickMult;
        // Pro Counter-Discipline Guard: never force a combo/meta pick into a heavy lane/teamfight counter!
        const trainedPickBonus =
          matchup.totalDelta <= -3.0 && rawTrainedBonus > 0
            ? rawTrainedBonus * 0.32
            : rawTrainedBonus;
        const proCounterAvoidPenalty =
          (state.aiStyle === "god" || state.aiStyle === "mpl_ph") && matchup.totalDelta <= -3.2
            ? matchup.totalDelta * 2.4
            : 0;

        totalScore +=
          matchup.totalDelta +
          proCounterAvoidPenalty +
          synergy.totalSynergy +
          mplCombo.comboBonus +
          denyLookahead.denyBonus +
          mapFit.mapBonus +
          godMapAvoidPenalty +
          mapCompNeed.compBonus +
          phaseTiming.phaseBonus +
          zeroLack.mandateBonus +
          blueprintBonus +
          trainedPickBonus;

        // Prioritize tags: Trained MPL PH Signal / MPL Duo / Zero-Lack Mandate / Map Comp Need / Strategy / Counter / Synergy
        if (trainedPick.tag) tags.push(trainedPick.tag);
        for (const ct of mplCombo.comboTags) tags.push(ct);
        for (const zt of zeroLack.mandateTags) tags.push(zt);
        if (mapCompNeed.compTag) tags.push(mapCompNeed.compTag);
        else if (mapFit.mapTag) tags.push(mapFit.mapTag);
        if (phaseTiming.phaseTag) tags.push(phaseTiming.phaseTag);
        if (denyLookahead.denyTag) tags.push(denyLookahead.denyTag);
        for (const r of matchup.reasons.slice(0, 2)) tags.push(r);
        for (const r of synergy.reasons.slice(0, 1)) tags.push(r);

        if (matchingLane) {
          totalScore += 18.0;
          tags.push({
            type: "mpl-priority",
            text: `${LANE_ICONS[matchingLane] || "✨"} Fills ${matchingLane}`
          });
        } else {
          totalScore -= 65.0;
        }

        // Phase 1 Flex Pick Bonus (B1, R1, R2, B2, B3, R3)
        if (allyPicks.length < 3 && hero.flex_lanes.length >= 2) {
          const flexBoost =
            state.aiStyle === "god" || state.aiStyle === "mpl_ph" ? 9.5 : 6.5;
          totalScore += flexBoost;
          tags.push({
            type: "mpl-priority",
            text: `🔀 MPL Flex (${hero.flex_lanes.map((l) => LANE_SHORT[l]).join("/")})`
          });
        }

        // AI Style adjustments
        if (state.aiStyle === "aggressive" && (hero.specialties.includes("Burst") || hero.specialties.includes("Charge") || hero.specialties.includes("Chase"))) {
          totalScore += 5.0;
        } else if (state.aiStyle === "teamfight" && (hero.specialties.includes("Crowd Control") || hero.specialties.includes("Support") || hero.specialties.includes("Guard"))) {
          totalScore += 5.0;
        }
      }

      if (tags.length === 0) {
        tags.push({
          type: "mpl-priority",
          text: `${hero.mpl.archetype || "MPL Meta Staple"} • ${am.win_rate.toFixed(1)}% WR`
        });
      }

      const assignedLane =
        hero.flex_lanes.find((ln) => allyMissingLanes.includes(ln)) || hero.lanes[0] || "EXP Lane";

      results.push({
        hero,
        coachScore: +Math.max(1, totalScore).toFixed(1),
        assignedLane,
        mapFit,
        tags: tags.slice(0, 3)
      });
    }

    results.sort((a, b) => b.coachScore - a.coachScore);
    return results.slice(0, limit);
  }

  /* =====================================================================
     5. DRAFT EXECUTION, AI TURN HANDLER & WIN PROBABILITY
     ===================================================================== */
  function selectHeroForCurrentTurn(heroId) {
    const unavailable = getUnavailableHeroIds();
    if (unavailable.has(heroId)) {
      showToast("⚠️ That hero is already picked or banned.");
      return;
    }

    const turn = getCurrentTurn();
    if (!turn) {
      showToast("🏁 Draft is complete! Open Draft Analysis or Reset to start a new draft.");
      return;
    }

    // Save snapshot for Undo
    state.history.push(
      JSON.stringify({
        stepIndex: state.stepIndex,
        blueBans: state.blueBans,
        redBans: state.redBans,
        bluePicks: state.bluePicks,
        redPicks: state.redPicks,
        liveTarget: state.liveTarget
      })
    );

    if (turn.type === "ban") {
      if (turn.side === "blue") {
        state.blueBans[turn.slotIndex] = heroId;
      } else {
        state.redBans[turn.slotIndex] = heroId;
      }
    } else {
      const teamPicks = turn.side === "blue" ? state.bluePicks : state.redPicks;
      teamPicks[turn.slotIndex].heroId = heroId;
      teamPicks[turn.slotIndex].manualLane = false;
      autoAssignTeamLanes(teamPicks);
    }

    if (state.activeView === "live-counter") {
      advanceLiveCounterCursor();
      renderAll();
      return;
    }

    state.stepIndex++;
    resetTurnTimer();
    renderAll();

    const seq = getActiveSequence();
    if (state.stepIndex >= seq.length) {
      stopTurnTimer();
      setTimeout(() => openDraftReportModal(), 450);
    } else {
      checkAndTriggerAiTurn();
    }
  }

  function advanceLiveCounterCursor() {
    // Move to the next empty pick or ban slot automatically for convenience
    const { type, side, slotIndex } = state.liveTarget;
    if (type === "pick") {
      const arr = side === "blue" ? state.bluePicks : state.redPicks;
      for (let i = slotIndex + 1; i < 5; i++) {
        if (!arr[i].heroId) {
          state.liveTarget = { type: "pick", side, slotIndex: i };
          return;
        }
      }
      const otherSide = side === "blue" ? "red" : "blue";
      const otherArr = otherSide === "blue" ? state.bluePicks : state.redPicks;
      for (let i = 0; i < 5; i++) {
        if (!otherArr[i].heroId) {
          state.liveTarget = { type: "pick", side: otherSide, slotIndex: i };
          return;
        }
      }
    } else {
      const arr = side === "blue" ? state.blueBans : state.redBans;
      for (let i = slotIndex + 1; i < 5; i++) {
        if (!arr[i]) {
          state.liveTarget = { type: "ban", side, slotIndex: i };
          return;
        }
      }
    }
  }

  function isMapModalOpen() {
    const modal = document.getElementById("mapSelectModal");
    return Boolean(modal && !modal.classList.contains("hidden"));
  }

  function openMapSelectModal() {
    clearTimeout(state.aiTimeout);
    stopTurnTimer();
    renderMapModalCards();
    const modal = document.getElementById("mapSelectModal");
    if (modal) modal.classList.remove("hidden");
  }

  function closeMapSelectModal(triggerAi = true) {
    const modal = document.getElementById("mapSelectModal");
    if (modal) modal.classList.add("hidden");
    resetTurnTimer();
    renderAll();
    if (triggerAi) checkAndTriggerAiTurn();
  }

  function selectBattlefieldMap(mapKey, closeModal = false, announce = true) {
    if (!MLBB_MAPS[mapKey]) return;
    state.selectedMap = mapKey;
    if (state.stepIndex === 0) {
      rollMatchStrategyBlueprints();
    }
    const sel = document.getElementById("battlefieldMapSelect");
    if (sel) sel.value = mapKey;
    renderMapModalCards();
    renderAll();
    if (announce) {
      const m = MLBB_MAPS[mapKey];
      showToast(`${m.icon} Active Map: ${m.name} — Elya Coach & AI adapted to ${m.comp_archetype}!`);
    }
    if (closeModal) {
      closeMapSelectModal(true);
    } else if (!isMapModalOpen()) {
      checkAndTriggerAiTurn();
    }
  }

  function randomizeBattlefieldMap(closeModal = false) {
    const others = MAP_KEYS.filter((k) => k !== state.selectedMap);
    const pool = others.length ? others : MAP_KEYS;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    selectBattlefieldMap(pick, closeModal, true);
  }

  function renderMapModalCards() {
    const grid = document.getElementById("mapModalCardsGrid");
    const summaryEl = document.getElementById("mapModalSelectedSummary");
    if (!grid) return;

    const activeCfg = MLBB_MAPS[state.selectedMap] || MLBB_MAPS.healing_turtle;
    if (summaryEl) {
      summaryEl.innerHTML = `Selected Map: <strong>${activeCfg.icon} ${activeCfg.name}</strong> (${activeCfg.slogan}) — Best Comp: <strong>${activeCfg.comp_archetype}</strong>`;
    }

    grid.innerHTML = MAP_KEYS.map((key) => {
      const m = MLBB_MAPS[key];
      const isSelected = key === state.selectedMap;
      const featuredHeroes = (m.featured_ids || [])
        .map((id) => state.heroMap.get(id))
        .filter(Boolean);
      const avoidHeroes = (m.avoid_preview_ids || [])
        .map((id) => state.heroMap.get(id))
        .filter(Boolean);

      return `
        <div class="map-choice-card map-card-${m.key} ${isSelected ? "selected-map" : ""}" data-choose-map="${m.key}">
          <div class="map-card-top">
            <div class="map-card-title-group">
              <div class="map-card-icon">${m.icon}</div>
              <div>
                <div class="map-card-name">${m.name}</div>
                <div class="map-card-slogan">${m.slogan}</div>
              </div>
            </div>
            <span class="map-active-pill">${isSelected ? "✓ ACTIVE MAP" : "CLICK TO SELECT"}</span>
          </div>

          <div class="map-mechanic-desc">
            <strong>Terrain Mechanic:</strong> ${m.mechanic}
          </div>

          <div class="map-comp-callout">
            <span class="map-comp-label">🏆 Optimal AI &amp; MPL Team Comp: ${m.comp_archetype}</span>
            <div class="map-hero-avatars-row">
              ${featuredHeroes
                .map(
                  (h) => `
                  <span class="map-hero-chip" title="${h.name} — S+ Fit on ${m.name}">
                    <img src="${h.head}" alt="${h.name}" loading="lazy" />
                    <span>${h.name}</span>
                  </span>
                `
                )
                .join("")}
            </div>
          </div>

          <div class="map-avoid-strip">
            <strong>⚠️ Penalized on ${m.shortName}:</strong> ${avoidHeroes.map((h) => h.name).join(", ")} (${m.avoid_reason})
          </div>
        </div>
      `;
    }).join("");

    grid.querySelectorAll("[data-choose-map]").forEach((card) => {
      card.addEventListener("click", () => {
        const chosenKey = card.dataset.chooseMap;
        selectBattlefieldMap(chosenKey, false, false);
      });
      card.addEventListener("dblclick", () => {
        const chosenKey = card.dataset.chooseMap;
        selectBattlefieldMap(chosenKey, true, true);
      });
    });
  }

  function isCurrentTurnAi() {
    if (state.activeView !== "simulator") return false;
    if (isMapModalOpen()) return false;
    const turn = getCurrentTurn();
    if (!turn) return false;
    if (state.playerSide === "ai_vs_ai") return true;
    if (state.playerSide === "both") return false;
    return turn.side !== state.playerSide;
  }

  function checkAndTriggerAiTurn() {
    clearTimeout(state.aiTimeout);
    if (!isCurrentTurnAi()) return;

    state.aiTimeout = setTimeout(() => {
      executeAiTurn();
    }, 520);
  }

  /**
   * OMEGA 3-PLY ADVERSARIAL MINIMAX & JOINT DOUBLE-TURN OPTIMIZER:
   * - On Paired Double-Turns (R1+R2, B2+B3, B4+B5): Evaluates all valid 2-hero pairs (A, B)
   *   covering 2 distinct missing lanes, optimizing mutual synergy, MPL Pro Duo completion,
   *   map comp requirements, and resistance to opponent counter-picks.
   * - On Single Turns (B1, R2, B3, R3, R4, B5, R5): Runs a 3-ply minimax simulation by
   *   temporarily locking each candidate, solving optimal lane swaps, calculating full-draft
   *   Win Probability, and subtracting the opponent's strongest next-turn counter response!
   */
  function computeAlphaDraftDecision() {
    const turn = getCurrentTurn();
    const recs = computeTurnRecommendations(12);
    if (!turn || !recs.length) return null;

    const activeSide = turn.side;
    const allySlots = activeSide === "blue" ? state.bluePicks : state.redPicks;
    const enemySlots = activeSide === "blue" ? state.redPicks : state.bluePicks;
    const allyPicks = allySlots.map((p) => p.heroId).filter(Boolean);
    const enemyPicks = enemySlots.map((p) => p.heroId).filter(Boolean);
    const allyMissingLanes = getTeamMissingLanes(allySlots);
    const enemyMissingLanes = getTeamMissingLanes(enemySlots);
    const unavailable = getUnavailableHeroIds();
    const activeBlueprint = resolveActiveTeamBlueprint(
      activeSide,
      allyPicks,
      enemyPicks,
      unavailable
    );

    if (state.aiStyle !== "god" && state.aiStyle !== "mpl_ph") {
      let chosen = recs[0];
      if (
        recs.length > 1 &&
        recs[0].coachScore - recs[1].coachScore < 2.2 &&
        Math.random() < 0.25
      ) {
        chosen = recs[1];
      }
      state.lastAiTelemetry = `🤖 AI (${turn.label} • ${activeBlueprint.shortName}): Selected <strong>${chosen.hero.name}</strong> (${chosen.coachScore.toFixed(1)} PTS) — ${chosen.tags[0]?.text || chosen.assignedLane}`;
      return chosen;
    }

    // 1) Ban Turn: Execute Strategy-Driven Adaptive Ban with Telemetry
    if (turn.type === "ban") {
      const topBan = recs[0];
      const reasonTxt = topBan.tags[0]?.text || activeBlueprint.ban_reason;
      const aiPrefix = state.aiStyle === "mpl_ph" ? "🏆 MPL PH AI" : "💀 Omega AI";
      state.lastAiTelemetry = `${aiPrefix} (${turn.label} • <strong>${activeBlueprint.shortName}</strong>): Banned <strong>${topBan.hero.name}</strong> (${topBan.coachScore.toFixed(1)} PTS) — ${reasonTxt}`;
      return topBan;
    }

    // Check if this is the 1st turn of a Paired Double-Turn (R1, B2, B4)
    const seq = getActiveSequence();
    const nextTurn =
      state.activeView === "simulator" && state.stepIndex + 1 < seq.length
        ? seq[state.stepIndex + 1]
        : null;
    const isFirstOfDoublePick = Boolean(
      nextTurn && nextTurn.type === "pick" && nextTurn.side === activeSide && allyMissingLanes.length >= 2
    );

    // 2) Joint Double-Turn Pair Search (R1+R2, B2+B3, B4+B5) with Full Win-Prob, Lethal Combo Lock & Zero-Lack Simulation
    if (isFirstOfDoublePick) {
      const topCands = recs.slice(0, 10);
      // Inject any available Lethal Combo partner of top 6 candidates so pairs like Kimmy+Estes or Zhuxin+Carmilla are always evaluated together!
      if (MPL_PH_MODEL && Array.isArray(MPL_PH_MODEL.lethal_combos)) {
        const topSixIds = new Set(recs.slice(0, 6).map((r) => r.hero.id));
        const inTopCands = new Set(topCands.map((r) => r.hero.id));
        for (const lc of MPL_PH_MODEL.lethal_combos) {
          if (lc.core_ids.some((id) => topSixIds.has(id))) {
            for (const partnerId of lc.core_ids) {
              if (!inTopCands.has(partnerId) && topCands.length < 14) {
                const foundRec = recs.find((r) => r.hero.id === partnerId);
                if (foundRec) {
                  topCands.push(foundRec);
                  inTopCands.add(partnerId);
                }
              }
            }
          }
        }
      }
      const savedSlots = allySlots.map((s) => ({ ...s }));
      let bestPairScore = -1e9;
      let bestA = topCands[0];
      let bestB = topCands[1] || topCands[0];
      let bestPairWinProb = 50.0;
      let bestPairComboName = null;

      for (let i = 0; i < topCands.length; i++) {
        const candA = topCands[i];
        if (!canAssignDistinctFlexLanes(allyPicks, candA.hero.id)) continue;

        for (let j = 0; j < topCands.length; j++) {
          if (i === j) continue;
          const candB = topCands[j];
          // Must both fit distinct valid flex lanes together with existing allies!
          if (!canAssignDistinctFlexLanes([...allyPicks, candA.hero.id], candB.hero.id)) continue;

          // Simulate locking BOTH candA and candB into current & next slot
          savedSlots.forEach((s, idx) => {
            allySlots[idx].heroId = s.heroId;
            allySlots[idx].lane = s.lane;
            allySlots[idx].manualLane = s.manualLane;
          });
          allySlots[turn.slotIndex].heroId = candA.hero.id;
          allySlots[turn.slotIndex].manualLane = false;
          if (nextTurn && nextTurn.slotIndex < 5) {
            allySlots[nextTurn.slotIndex].heroId = candB.hero.id;
            allySlots[nextTurn.slotIndex].manualLane = false;
          }
          autoAssignTeamLanes(allySlots);

          const simAnalytics = evaluateFullDraftAnalytics();
          const simWinProb = activeSide === "blue" ? simAnalytics.blueWinProb : simAnalytics.redWinProb;
          const simStats = activeSide === "blue" ? simAnalytics.blueStats : simAnalytics.redStats;

          // Mutual pair synergy + MPL Pro Duo + Trained S18 Lethal Combo Pair Lock
          const pairSyn = evaluateHeroSynergyWithAllies(candA.hero, [candB.hero.id]).totalSynergy;
          const lethalPair = evaluateLethalComboPairBonus(
            candA.hero.id,
            candB.hero.id,
            allyPicks,
            enemyPicks
          );
          let mplPairBonus = lethalPair.bonus;
          for (const pkg of MPL_PRO_COMBOS) {
            const aInCore = pkg.cores.includes(candA.hero.id);
            const bInPart = pkg.partners.includes(candB.hero.id);
            const bInCore = pkg.cores.includes(candB.hero.id);
            const aInPart = pkg.partners.includes(candA.hero.id);
            const bothInCore = aInCore && bInCore && pkg.cores.length >= 2;
            if ((aInCore && bInPart) || (bInCore && aInPart) || bothInCore) {
              mplPairBonus += pkg.bonus * 1.25;
              break;
            }
          }

          // Simulate enemy's strongest counter-pick against the combined [allyPicks + A + B]
          const combinedAllies = [...allyPicks, candA.hero.id, candB.hero.id];
          let maxEnemyReply = 0;
          for (const eh of state.heroes) {
            if (unavailable.has(eh.id) || eh.id === candA.hero.id || eh.id === candB.hero.id) continue;
            if (!eh.flex_lanes.some((ln) => enemyMissingLanes.includes(ln))) continue;
            const replyDelta = evaluateHeroMatchupVsTeam(eh, combinedAllies, allySlots).totalDelta;
            if (replyDelta > maxEnemyReply) maxEnemyReply = replyDelta;
          }

          // Zero-Weakness Enforcement + Counter Balance + Win-Prob Optimization
          const zeroLackBonus =
            simStats.weaknesses.length === 0
              ? 28.0 + Math.max(-8.0, Math.min(18.0, simStats.counterTotal * 1.1))
              : -simStats.weaknesses.length * 68.0;
          const contestOrderBonus =
            (candA.hero.active_meta.contest_rate - candB.hero.active_meta.contest_rate) * 0.08 +
            (candA.hero.flex_lanes.length >= 2 ? 3.0 : 0);

          const totalPairUtility =
            candA.coachScore +
            candB.coachScore * 0.94 +
            (simWinProb - 50.0) * 2.6 +
            zeroLackBonus +
            pairSyn * 1.5 +
            mplPairBonus -
            maxEnemyReply * 0.42 +
            contestOrderBonus;

          if (totalPairUtility > bestPairScore) {
            bestPairScore = totalPairUtility;
            bestA = candA;
            bestB = candB;
            bestPairWinProb = simWinProb;
            bestPairComboName = lethalPair.comboName;
          }
        }
      }

      // Restore clean board before committing Turn 1
      savedSlots.forEach((s, idx) => {
        allySlots[idx].heroId = s.heroId;
        allySlots[idx].lane = s.lane;
        allySlots[idx].manualLane = s.manualLane;
      });

      const reasonTxt = bestPairComboName
        ? `🔥 Combo Lock: ${bestPairComboName}`
        : bestA.tags[0]?.text || bestA.assignedLane;
      const aiPrefix = state.aiStyle === "mpl_ph" ? "🏆 MPL PH Double-Turn" : "💀 Omega Double-Turn";
      state.lastAiTelemetry = `${aiPrefix} (${turn.label} • <strong>${activeBlueprint.shortName}</strong>): Picked <strong>${bestA.hero.name}</strong> + paired w/ <strong>${bestB.hero.name}</strong> (Proj. <strong>${bestPairWinProb.toFixed(1)}%</strong> Win) — ${reasonTxt}`;
      return bestA;
    }

    // 3) Single-Turn 3-Ply Adversarial Minimax Rollout (B1, R2, B3, R3, R4, B5, R5)
    const topCands = recs.slice(0, 14);
    const savedSlots = allySlots.map((s) => ({ ...s }));
    let bestMinimaxScore = -1e9;
    let bestCand = topCands[0];
    let bestProjectedWinProb = 50.0;

    for (const cand of topCands) {
      savedSlots.forEach((s, idx) => {
        allySlots[idx].heroId = s.heroId;
        allySlots[idx].lane = s.lane;
        allySlots[idx].manualLane = s.manualLane;
      });

      // Simulate locking cand into current turn slot & solving optimal 5-lane assignment
      allySlots[turn.slotIndex].heroId = cand.hero.id;
      allySlots[turn.slotIndex].manualLane = false;
      autoAssignTeamLanes(allySlots);

      const simAnalytics = evaluateFullDraftAnalytics();
      const simAiWinProb = activeSide === "blue" ? simAnalytics.blueWinProb : simAnalytics.redWinProb;
      const simAiStats = activeSide === "blue" ? simAnalytics.blueStats : simAnalytics.redStats;
      const newAllyIds = allySlots.map((p) => p.heroId).filter(Boolean);

      // Simulate Opponent's Best Next-Turn Counter-Response (Ply 2)
      let maxEnemyResponseSwing = 0;
      if (enemyMissingLanes.length > 0) {
        for (const eh of state.heroes) {
          if (unavailable.has(eh.id) || eh.id === cand.hero.id) continue;
          const enemyLane = eh.flex_lanes.find((ln) => enemyMissingLanes.includes(ln));
          if (!enemyLane) continue;
          const counterVsUs = evaluateHeroMatchupVsTeam(eh, newAllyIds, allySlots, enemyLane).totalDelta;
          const synWithEnemy = evaluateHeroSynergyWithAllies(eh, enemyPicks).totalSynergy;
          const enemyComboCompletion = evaluateLethalComboPairBonus(eh.id, null, enemyPicks, newAllyIds).bonus;
          const enemySwing =
            Math.max(0, counterVsUs) * 0.9 +
            Math.max(0, synWithEnemy) * 0.45 +
            Math.max(0, enemyComboCompletion) * 0.55;
          if (enemySwing > maxEnemyResponseSwing) {
            maxEnemyResponseSwing = enemySwing;
          }
        }
      }

      // Strictly penalize any candidate that introduces a composition or counter weakness!
      const zeroWeaknessScore =
        simAiStats.weaknesses.length === 0
          ? 32.0 + simAiStats.strengths.length * 4.5 + Math.max(-8.0, Math.min(18.0, simAiStats.counterTotal * 1.1))
          : -simAiStats.weaknesses.length * 72.0;

      const minimaxUtility =
        cand.coachScore +
        (simAiWinProb - 50.0) * 2.85 +
        zeroWeaknessScore -
        maxEnemyResponseSwing * 0.45;

      if (minimaxUtility > bestMinimaxScore) {
        bestMinimaxScore = minimaxUtility;
        bestCand = cand;
        bestProjectedWinProb = simAiWinProb;
      }
    }

    // Restore actual board state before selectHeroForCurrentTurn commits the move
    savedSlots.forEach((s, idx) => {
      allySlots[idx].heroId = s.heroId;
      allySlots[idx].lane = s.lane;
      allySlots[idx].manualLane = s.manualLane;
    });

    const reasonTxt = bestCand.tags[0]?.text || bestCand.assignedLane;
    state.lastAiTelemetry = `💀 Omega 3-Ply Minimax (${turn.label} • <strong>${activeBlueprint.shortName}</strong>): Locked <strong>${bestCand.hero.name}</strong> (${bestCand.coachScore.toFixed(1)} PTS • Proj. <strong>${bestProjectedWinProb.toFixed(1)}%</strong> Win) — ${reasonTxt}`;
    return bestCand;
  }

  function executeAiTurn() {
    const turn = getCurrentTurn();
    if (!turn) return;
    const chosen = computeAlphaDraftDecision();
    if (!chosen) return;
    selectHeroForCurrentTurn(chosen.hero.id);
  }

  function autoFinishDraft() {
    clearTimeout(state.aiTimeout);
    const seq = getActiveSequence();
    while (state.stepIndex < seq.length) {
      const chosen = computeAlphaDraftDecision();
      if (!chosen) break;
      const turn = getCurrentTurn();
      if (turn.type === "ban") {
        if (turn.side === "blue") state.blueBans[turn.slotIndex] = chosen.hero.id;
        else state.redBans[turn.slotIndex] = chosen.hero.id;
      } else {
        const teamPicks = turn.side === "blue" ? state.bluePicks : state.redPicks;
        teamPicks[turn.slotIndex].heroId = chosen.hero.id;
        teamPicks[turn.slotIndex].manualLane = false;
        autoAssignTeamLanes(teamPicks);
      }
      state.stepIndex++;
    }
    stopTurnTimer();
    renderAll();
    openDraftReportModal();
  }

  function undoLastTurn() {
    clearTimeout(state.aiTimeout);
    if (!state.history.length) {
      showToast("Nothing to undo.");
      return;
    }
    // If playing vs AI, undo back to the player's turn if the last turn was AI
    let snap = JSON.parse(state.history.pop());
    restoreSnapshot(snap);
    while (
      state.activeView === "simulator" &&
      state.playerSide !== "both" &&
      state.playerSide !== "ai_vs_ai" &&
      isCurrentTurnAi() &&
      state.history.length > 0
    ) {
      snap = JSON.parse(state.history.pop());
      restoreSnapshot(snap);
    }
    resetTurnTimer();
    renderAll();
  }

  function restoreSnapshot(snap) {
    state.stepIndex = snap.stepIndex;
    state.blueBans = snap.blueBans;
    state.redBans = snap.redBans;
    state.bluePicks = snap.bluePicks;
    state.redPicks = snap.redPicks;
    if (snap.liveTarget) state.liveTarget = snap.liveTarget;
  }

  function resetDraft(triggerAi = true) {
    clearTimeout(state.aiTimeout);
    state.stepIndex = 0;
    state.blueBans = [null, null, null, null, null];
    state.redBans = [null, null, null, null, null];
    state.bluePicks = ALL_LANES.map((ln) => ({ heroId: null, lane: ln, manualLane: false }));
    state.redPicks = ALL_LANES.map((ln) => ({ heroId: null, lane: ln, manualLane: false }));
    state.history = [];
    state.lastAiTelemetry = null;
    state.liveTarget = { type: "pick", side: "blue", slotIndex: 0 };
    rollMatchStrategyBlueprints();
    resetTurnTimer();
    renderAll();
    if (triggerAi) checkAndTriggerAiTurn();
  }

  function resetTurnTimer() {
    stopTurnTimer();
    if (!state.timerSeconds || state.activeView !== "simulator") return;
    const turn = getCurrentTurn();
    if (!turn) return;
    state.timeLeft = state.timerSeconds;
    updateTimerUI();
    state.timerInterval = setInterval(() => {
      state.timeLeft--;
      updateTimerUI();
      if (state.timeLeft <= 0) {
        stopTurnTimer();
        executeAiTurn();
      }
    }, 1000);
  }

  function stopTurnTimer() {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
    const pill = document.getElementById("turnTimerPill");
    if (pill && !state.timerSeconds) pill.classList.add("hidden");
  }

  function updateTimerUI() {
    const pill = document.getElementById("turnTimerPill");
    if (!pill) return;
    if (!state.timerSeconds || !getCurrentTurn()) {
      pill.classList.add("hidden");
      return;
    }
    pill.classList.remove("hidden");
    pill.textContent = `${state.timeLeft}s`;
  }

  /* =====================================================================
     6. TEAM ANALYTICS & WIN PROBABILITY ENGINE
     ===================================================================== */
  function evaluateFullDraftAnalytics() {
    const blueIds = state.bluePicks.map((p) => p.heroId).filter(Boolean);
    const redIds = state.redPicks.map((p) => p.heroId).filter(Boolean);

    const blueStats = computeSingleTeamMetrics(state.bluePicks, blueIds, redIds);
    const redStats = computeSingleTeamMetrics(state.redPicks, redIds, blueIds);

    // Calculate head-to-head Win Probability
    // Slight historical MPL Blue Side 1st-pick baseline (50.5%) when empty
    let bluePower = blueStats.rawPower + 0.5;
    let redPower = redStats.rawPower;

    const mplLogregEdge = computeMplLogregDelta(blueIds, redIds);
    const diff = bluePower - redPower + mplLogregEdge * 6.5;
    // Calibrated competitive sigmoid mapping (realistic MPL tournament range: 32%..68%, baseline 50.5% for Blue)
    const blueWinProb = +(50 + Math.tanh(diff / 44) * 26).toFixed(1);
    const redWinProb = +(100 - blueWinProb).toFixed(1);

    return {
      blueWinProb,
      redWinProb,
      blueStats,
      redStats
    };
  }

  function computeSingleTeamMetrics(teamSlots, teamIds, enemyIds) {
    if (teamIds.length === 0) {
      return {
        rawPower: 50,
        avgWinRate: 50.0,
        counterTotal: 0,
        synergyTotal: 0,
        mapFitTotal: 0,
        durability: 0,
        offense: 0,
        control: 0,
        scaling: { early: 50, mid: 50, late: 50 },
        coveredLanes: new Set(),
        grade: "—",
        strengths: [],
        weaknesses: []
      };
    }

    const enemySlots = teamSlots === state.bluePicks ? state.redPicks : state.bluePicks;

    let metaSum = 0;
    let wrSum = 0;
    let counterSum = 0;
    let synergySum = 0;
    let mapFitSum = 0;
    let mplComboSum = 0;
    let durSum = 0;
    let offSum = 0;
    let ccSum = 0;
    let earlySum = 0, midSum = 0, lateSum = 0;

    const coveredLanes = new Set();
    const rolesSet = new Set();

    for (const slot of teamSlots) {
      if (!slot.heroId) continue;
      coveredLanes.add(slot.lane);
      const h = state.heroMap.get(slot.heroId);
      if (!h) continue;

      for (const r of h.roles) rolesSet.add(r);
      const tf = getHeroTimeframeStats(h, state.timeframe);

      const combatPower =
        54.0 +
        (h.active_meta.win_rate - 48.0) * 2.55 +
        h.active_meta.mpl_presence * 0.25 +
        (h.stats_rating.durability + h.stats_rating.offense + h.stats_rating.control) * 0.055;
      metaSum += Math.max(46, Math.min(98, combatPower));
      wrSum += h.active_meta.win_rate;

      const alliesOther = teamIds.filter((id) => id !== h.id);
      const m = evaluateHeroMatchupVsTeam(h, enemyIds, enemySlots, slot.lane);
      const s = evaluateHeroSynergyWithAllies(h, alliesOther);
      const mf = evaluateHeroMapFit(h, state.selectedMap);
      const mc = evaluateMplProComboBonus(h, alliesOther, [], false, new Set());

      counterSum += m.totalDelta;
      synergySum += s.totalSynergy * 0.5; // avoid double-counting pairs
      mplComboSum += mc.comboBonus * 0.45;
      mapFitSum += mf.mapBonus * 0.5;

      durSum += h.stats_rating.durability;
      offSum += h.stats_rating.offense;
      ccSum += h.stats_rating.control;

      earlySum += (tf.scaling && tf.scaling.early) || 50;
      midSum += (tf.scaling && tf.scaling.mid) || 50;
      lateSum += (tf.scaling && tf.scaling.late) || 50;
    }

    const n = teamIds.length;
    const durability = Math.round(durSum / n);
    const offense = Math.round(offSum / n);
    const control = Math.round(ccSum / n);

    const strengths = [];
    const weaknesses = [];
    const mapCfg = MLBB_MAPS[state.selectedMap] || MLBB_MAPS.healing_turtle;

    if (coveredLanes.size === n && n === 5) {
      strengths.push("Complete 5-Lane MPL Role Coverage");
    } else if (n === 5 && coveredLanes.size < 5) {
      weaknesses.push(`Overlapping Lanes (${5 - coveredLanes.size} lane gap)`);
    }

    if (mapFitSum >= 8.0) {
      strengths.push(`${mapCfg.icon} Elite ${mapCfg.name} Terrain Composition (+${mapFitSum.toFixed(1)} Map Edge)`);
    } else if (mapFitSum <= -3.5) {
      weaknesses.push(`⚠️ Poor ${mapCfg.name} Terrain Fit (${mapFitSum.toFixed(1)} Map Penalty)`);
    }

    if (counterSum >= 6) strengths.push(`Strong Direct Counter & 1v1 Lane Advantage (+${counterSum.toFixed(1)} pts)`);
    if (counterSum <= -6) weaknesses.push(`Out-countered in Lane/Teamfight Matchups (${counterSum.toFixed(1)} pts)`);

    // Detect Trained S18 Lethal Meta Combos & Championship Trios on the team
    if (MPL_PH_MODEL && Array.isArray(MPL_PH_MODEL.lethal_combos)) {
      for (const lc of MPL_PH_MODEL.lethal_combos) {
        const heldCores = lc.core_ids.filter((id) => teamIds.includes(id));
        if (heldCores.length >= 2) {
          mplComboSum += 5.5;
          strengths.unshift(`🔥 Lethal Meta Combo: ${lc.name}`);
        }
      }
    }
    if (MPL_PH_MODEL && Array.isArray(MPL_PH_MODEL.trios)) {
      for (const trio of MPL_PH_MODEL.trios) {
        if (trio.hero_ids.every((id) => teamIds.includes(id))) {
          mplComboSum += 4.5;
          strengths.unshift(`🏆 S18 Playoff Trio: ${trio.heroes.join(" + ")} (${trio.raw_wr}% WR)`);
          break;
        }
      }
    }

    const totalSynergyDisplay = +(synergySum + mplComboSum).toFixed(1);
    if (totalSynergyDisplay >= 4.0) strengths.push(`High MPL Pro Combo Synergy (+${totalSynergyDisplay} pts)`);
    if (durability >= 62) strengths.push("Sturdy Frontline & Objective Presence");
    if (durability < 44 && n >= 4) weaknesses.push("Squishy Lineup — Lacks Dedicated Frontline Tank/Bruiser");

    if (control >= 60) strengths.push("Elite Crowd Control & Pick-Off Lockdown");
    if (control < 40 && n >= 4) weaknesses.push("Low Crowd Control vs Mobile Divers");

    const hasGoldCarry =
      rolesSet.has("Marksman") || teamIds.some((id) => MPL_GOLD_FLEX_IDS.has(id));
    if (!rolesSet.has("Mage") && n === 5) weaknesses.push("Lacks Magic Damage (Easy for Enemy to stack Physical Defense)");
    if (!hasGoldCarry && n === 5) weaknesses.push("Lacks Objective / Siege Carry (No Marksman or MPL Gold-Flex Carry)");

    // Detect MPL Strategy Blueprint Cohesion across the drafted team
    let bestBpMatch = null;
    let bestBpCount = 0;
    for (const bpKey of BLUEPRINT_KEYS) {
      const bp = MPL_STRATEGY_BLUEPRINTS[bpKey];
      const count = teamIds.filter((id) => bp.core_ids.has(id) || bp.support_ids.has(id)).length;
      if (count > bestBpCount) {
        bestBpCount = count;
        bestBpMatch = bp;
      }
    }
    let strategyCohesionBonus = 0;
    if (bestBpMatch && bestBpCount >= 3) {
      strategyCohesionBonus = bestBpCount * 1.4;
      strengths.push(`🎯 Cohesive Strategy: ${bestBpMatch.shortName} (${bestBpCount}/5 Fit)`);
    }

    const lanePenalty = (n - coveredLanes.size) * 16;
    const weaknessPenalty = weaknesses.length * 5.0;
    const zeroLackCompleteBonus =
      n === 5 && weaknesses.length === 0 && coveredLanes.size === 5 ? 6.5 : 0;
    if (zeroLackCompleteBonus > 0) {
      strengths.unshift("👑 Zero-Lack Unbeatable 5-Pillar Lineup (0 Weaknesses)");
    }

    const rawPower =
      metaSum / n +
      counterSum * 0.70 +
      (synergySum + mplComboSum) * 0.58 +
      mapFitSum * 0.52 +
      strategyCohesionBonus +
      zeroLackCompleteBonus -
      lanePenalty -
      weaknessPenalty;

    let grade = "B";
    if (rawPower >= 70) grade = "S+";
    else if (rawPower >= 60) grade = "S";
    else if (rawPower >= 50) grade = "A";
    else if (rawPower >= 40) grade = "B";
    else grade = "C";

    return {
      rawPower: +rawPower.toFixed(1),
      avgWinRate: +(wrSum / n).toFixed(2),
      counterTotal: +counterSum.toFixed(1),
      synergyTotal: totalSynergyDisplay,
      mapFitTotal: +mapFitSum.toFixed(1),
      durability,
      offense,
      control,
      scaling: {
        early: +(earlySum / n).toFixed(1),
        mid: +(midSum / n).toFixed(1),
        late: +(lateSum / n).toFixed(1)
      },
      coveredLanes,
      grade,
      strengths,
      weaknesses
    };
  }

  /* =====================================================================
     7. UI RENDERING PIPELINE
     ===================================================================== */
  function renderAll() {
    updatePatchHeaderText();
    if (state.activeView === "simulator" || state.activeView === "live-counter") {
      renderBroadcastHud();
      renderTeamColumn("blue");
      renderTeamColumn("red");
      renderCoachPanel();
      renderHeroPoolGrid();
    } else if (state.activeView === "tier-list") {
      renderTierListView();
    } else if (state.activeView === "matrix") {
      renderMatrixExplorerView();
    }
  }

  function renderBroadcastHud() {
    const seq = getActiveSequence();
    const turn = getCurrentTurn();
    const analytics = evaluateFullDraftAnalytics();
    const mapCfg = MLBB_MAPS[state.selectedMap] || MLBB_MAPS.healing_turtle;

    const mapBanner = document.getElementById("activeMapBanner");
    if (mapBanner) {
      mapBanner.className = `active-map-banner map-theme-${mapCfg.key}`;
      document.getElementById("activeMapBadge").textContent = mapCfg.badgeText;
      document.getElementById("activeMapSlogan").textContent = mapCfg.slogan;
      document.getElementById("activeMapCompText").innerHTML = `MPL Comp: <strong>${mapCfg.comp_archetype}</strong>`;
    }
    const mapSel = document.getElementById("battlefieldMapSelect");
    if (mapSel && mapSel.value !== mapCfg.key) {
      mapSel.value = mapCfg.key;
    }

    document.getElementById("blueWinProbText").textContent = `${analytics.blueWinProb.toFixed(1)}% WIN PROB`;
    document.getElementById("redWinProbText").textContent = `${analytics.redWinProb.toFixed(1)}% WIN PROB`;
    document.getElementById("winProbFillBlue").style.width = `${analytics.blueWinProb}%`;
    document.getElementById("winProbFillRed").style.width = `${analytics.redWinProb}%`;

    const blueRoleTag = document.getElementById("blueRoleTag");
    const redRoleTag = document.getElementById("redRoleTag");
    if (state.activeView === "live-counter") {
      blueRoleTag.textContent = "ALLY TEAM";
      redRoleTag.textContent = "ENEMY TEAM";
    } else if (state.playerSide === "blue") {
      blueRoleTag.textContent = "YOU • 1ST PICK";
      redRoleTag.textContent = "MPL PRO AI";
    } else if (state.playerSide === "red") {
      blueRoleTag.textContent = "MPL PRO AI";
      redRoleTag.textContent = "YOU • COUNTER PICK";
    } else if (state.playerSide === "both") {
      blueRoleTag.textContent = "PLAYER 1";
      redRoleTag.textContent = "PLAYER 2";
    } else {
      blueRoleTag.textContent = "MPL AI BLUE";
      redRoleTag.textContent = "MPL AI RED";
    }

    const centerBox = document.getElementById("phaseCenterBox");
    const stageLbl = document.getElementById("phaseStageLabel");
    const actionTitle = document.getElementById("phaseActionTitle");

    centerBox.classList.remove("blue-turn", "red-turn", "done-turn");

    if (!turn) {
      centerBox.classList.add("done-turn");
      stageLbl.textContent = `DRAFT COMPLETE • ${seq.length} / ${seq.length} • ${mapCfg.badgeText}`;
      actionTitle.textContent = `🏁 DRAFT COMPLETE — CLICK 'DRAFT ANALYSIS' FOR PRO REPORT`;
    } else if (state.activeView === "live-counter") {
      centerBox.classList.add(turn.side === "blue" ? "blue-turn" : "red-turn");
      stageLbl.textContent = `LIVE DRAFT COUNTER • ${mapCfg.badgeText}`;
      actionTitle.textContent = `${turn.side === "blue" ? "🔵 BLUE" : "🔴 RED"} ${turn.type.toUpperCase()} SLOT #${turn.slotIndex + 1} ACTIVE`;
    } else {
      centerBox.classList.add(turn.side === "blue" ? "blue-turn" : "red-turn");
      stageLbl.textContent = `${turn.phase} • TURN ${turn.step} / ${seq.length} • ${mapCfg.badgeText}`;
      const sideText = turn.side === "blue" ? "🔵 BLUE SIDE" : "🔴 RED SIDE";
      const actText = turn.type === "ban" ? `BANNING (${turn.slotIndex + 1})` : `PICKING (${turn.label})`;
      actionTitle.textContent = `${sideText} ${actText}`;
    }

    // Grouped Phase Sequence Boxes (Never wraps onto uneven rows!)
    const ribbon = document.getElementById("sequenceRibbon");
    const phaseGroups = [];
    seq.forEach((s, idx) => {
      let lastGroup = phaseGroups[phaseGroups.length - 1];
      if (!lastGroup || lastGroup.phase !== s.phase) {
        lastGroup = { phase: s.phase, items: [] };
        phaseGroups.push(lastGroup);
      }
      lastGroup.items.push({ ...s, idx });
    });

    ribbon.innerHTML = phaseGroups
      .map((grp) => {
        const hasCurrent = grp.items.some(
          (it) => state.activeView === "simulator" && it.idx === state.stepIndex
        );
        const doneCount = grp.items.filter((it) => it.idx < state.stepIndex).length;
        return `
          <div class="phase-group-box ${hasCurrent ? "active-phase-group" : ""}" style="flex: ${grp.items.length};">
            <div class="phase-group-title">
              <span>${grp.phase}</span>
              <span>${doneCount}/${grp.items.length}</span>
            </div>
            <div class="phase-steps-row" style="grid-template-columns: repeat(${grp.items.length}, minmax(0, 1fr));">
              ${grp.items
                .map((s) => {
                  const isDone = s.idx < state.stepIndex;
                  const isCurrent = state.activeView === "simulator" && s.idx === state.stepIndex;
                  const sideCls = s.side === "blue" ? "blue-step" : "red-step";
                  const shortLbl = s.type === "ban"
                    ? `${s.side === "blue" ? "B" : "R"}B${s.slotIndex + 1}`
                    : `${s.side === "blue" ? "B" : "R"}${s.slotIndex + 1}`;
                  return `<div class="seq-step ${sideCls} ${isDone ? "completed" : ""} ${isCurrent ? "current" : ""}" title="${s.phase}: ${s.label}">${shortLbl}</div>`;
                })
                .join("")}
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderTeamColumn(side) {
    const bans = side === "blue" ? state.blueBans : state.redBans;
    const picks = side === "blue" ? state.bluePicks : state.redPicks;
    const enemyPicks = (side === "blue" ? state.redPicks : state.bluePicks)
      .map((p) => p.heroId)
      .filter(Boolean);
    const turn = getCurrentTurn();

    const bansRow = document.getElementById(side === "blue" ? "blueBansRow" : "redBansRow");
    const maxBans = state.draftFormat === "mpl10" ? 5 : 3;

    bansRow.innerHTML = bans
      .slice(0, maxBans)
      .map((heroId, idx) => {
        const isActive =
          turn && turn.type === "ban" && turn.side === side && turn.slotIndex === idx;
        const hero = heroId ? state.heroMap.get(heroId) : null;
        return `
          <div class="ban-slot ${isActive ? "active-slot" : ""}" data-side="${side}" data-type="ban" data-index="${idx}" title="${hero ? `Banned: ${hero.name} (Click in Live Mode to edit)` : `Ban Slot #${idx + 1}`}">
            ${
              hero
                ? `<img src="${hero.head}" alt="${hero.name}" loading="lazy" />
                   <div class="ban-slash"></div>
                   <span class="ban-hero-name">${hero.name}</span>`
                : `<span class="ban-slot-num">B${idx + 1}</span>`
            }
          </div>
        `;
      })
      .join("");

    // Bind click for Live Draft Counter slot targeting or clearing
    bansRow.querySelectorAll(".ban-slot").forEach((el) => {
      el.addEventListener("click", () => {
        const idx = parseInt(el.dataset.index, 10);
        if (state.activeView === "live-counter") {
          if (bans[idx] && state.liveTarget.type === "ban" && state.liveTarget.side === side && state.liveTarget.slotIndex === idx) {
            bans[idx] = null;
          }
          state.liveTarget = { type: "ban", side, slotIndex: idx };
          renderAll();
        }
      });
    });

    const picksList = document.getElementById(side === "blue" ? "bluePicksList" : "redPicksList");
    picksList.innerHTML = picks
      .map((slot, idx) => {
        const isActive =
          turn && turn.type === "pick" && turn.side === side && turn.slotIndex === idx;
        const hero = slot.heroId ? state.heroMap.get(slot.heroId) : null;
        const orderCode = `${side === "blue" ? "B" : "R"}${idx + 1}`;
        const laneIcon = LANE_ICONS[slot.lane] || "⚔️";

        if (!hero) {
          return `
            <div class="pick-slot ${isActive ? "active-slot" : ""}" data-side="${side}" data-type="pick" data-index="${idx}">
              <div class="pick-avatar-wrap">
                <span class="pick-order-badge">${orderCode}</span>
                <span style="font-size: 18px; opacity: 0.35;">${laneIcon}</span>
              </div>
              <div class="pick-info">
                <div class="pick-top-line">
                  <span class="pick-empty-title">${isActive ? "⚡ Selecting Hero..." : `Pick Slot ${orderCode}`}</span>
                  <button class="pick-lane-btn" data-cycle-lane="${idx}" data-side="${side}" title="Click to change target lane">
                    ${laneIcon} ${LANE_SHORT[slot.lane] || slot.lane} ↻
                  </button>
                </div>
                <div class="pick-sub-line">${isActive ? "Choose from Coach or Pool →" : `Assigned: ${slot.lane}`}</div>
                <div class="pick-deltas-row">
                  <span class="delta-chip delta-neutral" style="opacity:0.55;">${isActive ? "ACTIVE TURN" : "OPEN SLOT"}</span>
                </div>
              </div>
            </div>
          `;
        }

        const matchup = evaluateHeroMatchupVsTeam(hero, enemyPicks);
        const allyIds = picks.map((p) => p.heroId).filter((id) => id && id !== hero.id);
        const synergy = evaluateHeroSynergyWithAllies(hero, allyIds);
        const mapFit = evaluateHeroMapFit(hero, state.selectedMap);
        const tierCls = getTierBadgeClass(hero.active_meta.tier);

        return `
          <div class="pick-slot filled ${isActive ? "active-slot" : ""}" data-side="${side}" data-type="pick" data-index="${idx}">
            <div class="pick-avatar-wrap" data-inspect-hero="${hero.id}" title="Click avatar to inspect ${hero.name} in Counter Matrix">
              <img src="${hero.head}" alt="${hero.name}" loading="lazy" />
              <span class="pick-order-badge">${orderCode}</span>
              <span class="pick-tier-mini ${tierCls}">${hero.active_meta.tier}</span>
            </div>
            <div class="pick-info">
              <div class="pick-top-line">
                <span class="pick-hero-name">${hero.name}</span>
                <button class="pick-lane-btn" data-cycle-lane="${idx}" data-side="${side}" title="Click to swap lane assignment">
                  ${laneIcon} ${LANE_SHORT[slot.lane]} ↻
                </button>
              </div>
              <div class="pick-sub-line">${hero.roles.join("/")} • ${hero.mpl.archetype || "MPL Meta"}</div>
              <div class="pick-deltas-row">
                <span class="delta-chip delta-neutral">${hero.active_meta.win_rate.toFixed(1)}% WR</span>
                ${
                  mapFit.badgeLabel
                    ? `<span class="delta-chip delta-pos">${mapFit.badgeLabel}</span>`
                    : mapFit.mapTier === "AVOID"
                    ? `<span class="delta-chip delta-neg">⚠️ Map Risk</span>`
                    : ""
                }
                ${
                  matchup.totalDelta !== 0
                    ? `<span class="delta-chip ${matchup.totalDelta > 0 ? "delta-pos" : "delta-neg"}">
                         ${matchup.totalDelta > 0 ? "⚔️ +" : "⚠️ "}${matchup.totalDelta.toFixed(1)}
                       </span>`
                    : ""
                }
                ${
                  synergy.totalSynergy > 0.5
                    ? `<span class="delta-chip delta-pos">🤝 +${synergy.totalSynergy.toFixed(1)}</span>`
                    : ""
                }
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    // Bind lane cycling buttons
    picksList.querySelectorAll("[data-cycle-lane]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.cycleLane, 10);
        const curLane = picks[idx].lane;
        const nextIdx = (ALL_LANES.indexOf(curLane) + 1) % ALL_LANES.length;
        picks[idx].lane = ALL_LANES[nextIdx];
        picks[idx].manualLane = true;
        renderAll();
      });
    });

    // Bind inspect hero avatar click
    picksList.querySelectorAll("[data-inspect-hero]").forEach((avatar) => {
      avatar.addEventListener("click", (e) => {
        if (state.activeView === "live-counter") return;
        e.stopPropagation();
        const hid = parseInt(avatar.dataset.inspectHero, 10);
        openHeroInMatrixView(hid);
      });
    });

    // Bind slot click in Live Counter mode
    picksList.querySelectorAll(".pick-slot").forEach((el) => {
      el.addEventListener("click", () => {
        const idx = parseInt(el.dataset.index, 10);
        if (state.activeView === "live-counter") {
          if (picks[idx].heroId && state.liveTarget.type === "pick" && state.liveTarget.side === side && state.liveTarget.slotIndex === idx) {
            picks[idx].heroId = null;
            picks[idx].manualLane = false;
          }
          state.liveTarget = { type: "pick", side, slotIndex: idx };
          renderAll();
        }
      });
    });

    // Render Team Composition Diagnostics
    const analytics = evaluateFullDraftAnalytics();
    const teamStat = side === "blue" ? analytics.blueStats : analytics.redStats;
    const diagEl = document.getElementById(
      side === "blue" ? "blueCompDiagnostics" : "redCompDiagnostics"
    );

    diagEl.innerHTML = `
      <div class="diag-title">
        <span>${side.toUpperCase()} COMP RADAR</span>
        <span style="color: var(--gold-bright);">GRADE: ${teamStat.grade}</span>
      </div>
      <div class="diag-lanes-coverage">
        ${ALL_LANES.map(
          (ln) =>
            `<div class="lane-cov-pill ${teamStat.coveredLanes.has(ln) ? "covered" : ""}">${LANE_ICONS[ln]} ${LANE_SHORT[ln]}</div>`
        ).join("")}
      </div>
      <div class="diag-bars">
        <div class="diag-bar-row">
          <span class="diag-bar-label">🛡️ Frontline</span>
          <div class="diag-bar-track"><div class="diag-bar-fill" style="width:${teamStat.durability}%; background:#3b82f6;"></div></div>
          <span class="diag-bar-val">${teamStat.durability}</span>
        </div>
        <div class="diag-bar-row">
          <span class="diag-bar-label">💥 Burst/DPS</span>
          <div class="diag-bar-track"><div class="diag-bar-fill" style="width:${teamStat.offense}%; background:#f43f5e;"></div></div>
          <span class="diag-bar-val">${teamStat.offense}</span>
        </div>
        <div class="diag-bar-row">
          <span class="diag-bar-label">⛓️ CC Lock</span>
          <div class="diag-bar-track"><div class="diag-bar-fill" style="width:${teamStat.control}%; background:#a855f7;"></div></div>
          <span class="diag-bar-val">${teamStat.control}</span>
        </div>
        <div class="diag-bar-row">
          <span class="diag-bar-label">📈 Late Scale</span>
          <div class="diag-bar-track"><div class="diag-bar-fill" style="width:${Math.min(100, Math.round((teamStat.scaling.late - 35) * 2.5))}%; background:#10b981;"></div></div>
          <span class="diag-bar-val">${teamStat.scaling.late}%</span>
        </div>
      </div>
    `;
  }

  function renderCoachPanel() {
    const turn = getCurrentTurn();
    const titleEl = document.getElementById("coachHeaderTitle");
    const gridEl = document.getElementById("coachCardsGrid");
    const mindBadge = document.getElementById("aiMindReadBadge");
    const mindText = document.getElementById("aiMindReadText");
    const mapCfg = MLBB_MAPS[state.selectedMap] || MLBB_MAPS.healing_turtle;

    if (mindBadge) {
      const styleBadges = {
        god: "💀 OMEGA 3-PLY + MPL PH",
        mpl_ph: "🏆 MPL PH S18 TRAINED AI",
        pro: "🔥 MPL GRAND FINALS AI",
        aggressive: "⚔️ AGGRESSIVE DIVE AI",
        teamfight: "🛡️ 5v5 TEAMFIGHT AI"
      };
      mindBadge.textContent = styleBadges[state.aiStyle] || "💀 OMEGA 3-PLY + MPL PH";
    }
    if (mindText) {
      if (state.lastAiTelemetry) {
        mindText.innerHTML = state.lastAiTelemetry;
      } else {
        const aiSide = state.playerSide === "red" ? "blue" : "red";
        const bpKey = aiSide === "blue" ? state.blueBlueprintKey : state.redBlueprintKey;
        const aiBp = MPL_STRATEGY_BLUEPRINTS[bpKey] || MPL_STRATEGY_BLUEPRINTS.raid_boss_hyper;
        mindText.innerHTML = `AI Match Strategy on <strong>${mapCfg.icon} ${mapCfg.name}</strong>: <strong>${aiBp.name}</strong> • Zero-Lack 5-Pillar Minimax Active`;
      }
    }

    if (!turn) {
      titleEl.textContent = `Draft Complete on ${mapCfg.icon} ${mapCfg.name} — Click '📊 Analysis' for full report`;
    } else if (turn.type === "ban") {
      const isPhase2 = turn.slotIndex >= 3 || turn.phase === "BAN PHASE 2";
      titleEl.textContent = isPhase2
        ? `🎯 Phase-2 Target Bans (${turn.side.toUpperCase()}) • ${mapCfg.icon} ${mapCfg.name}`
        : `🚫 Phase-1 Priority Bans (${turn.side.toUpperCase()}) • ${mapCfg.icon} ${mapCfg.name}`;
    } else {
      titleEl.textContent = `⚡ Optimal Picks (${turn.label}) • ${mapCfg.icon} ${mapCfg.name} (${mapCfg.comp_short})`;
    }

    const topRecs = computeTurnRecommendations(6);
    gridEl.innerHTML = topRecs
      .map((item, idx) => {
        const h = item.hero;
        const am = h.active_meta;
        const tierCls = getTierBadgeClass(am.tier);
        const primaryTag = item.tags[0] || {
          type: "mpl-priority",
          text: `${h.mpl.archetype || "MPL Staple"}`
        };
        const mapPillHtml =
          item.mapFit && item.mapFit.badgeLabel
            ? `<span style="color:#6ee7b7; font-weight:700;">• ${item.mapFit.badgeLabel}</span>`
            : `<span>• ${h.roles[0]}</span>`;
        return `
          <div class="coach-card ${idx === 0 ? "rank-1" : ""}" data-pick-hero="${h.id}" title="Click to lock in ${h.name}">
            <div class="coach-card-top">
              <div class="coach-avatar">
                <img src="${h.head}" alt="${h.name}" loading="lazy" />
                <span class="coach-rank-tag">#${idx + 1}</span>
              </div>
              <div class="coach-main-info">
                <span class="coach-hero-name">${h.name}</span>
                <div class="coach-sub-meta">
                  <span>${LANE_ICONS[item.assignedLane] || ""} ${LANE_SHORT[item.assignedLane] || item.assignedLane}</span>
                  ${mapPillHtml}
                </div>
              </div>
              <div class="coach-score-box">
                <span class="coach-score-pill">${item.coachScore.toFixed(1)} PTS</span>
                <span class="tile-tier-badge ${tierCls}" style="position:static; font-size:9px;">${am.tier} TIER</span>
              </div>
            </div>

            <div class="coach-metrics-strip">
              <span style="color:#34d399;">WR ${am.win_rate.toFixed(1)}%</span>
              <span style="color:#fb7185;">BR ${am.ban_rate.toFixed(1)}%</span>
              <span style="color:#38bdf8;">MPL ${am.mpl_presence.toFixed(0)}%</span>
            </div>

            <div class="coach-reason-single">
              <span class="reason-tag ${primaryTag.type}">${primaryTag.text}</span>
            </div>
          </div>
        `;
      })
      .join("");

    gridEl.querySelectorAll("[data-pick-hero]").forEach((card) => {
      card.addEventListener("click", () => {
        const hid = parseInt(card.dataset.pickHero, 10);
        selectHeroForCurrentTurn(hid);
      });
    });
  }

  function renderHeroPoolGrid() {
    const gridEl = document.getElementById("heroPoolGrid");
    const unavailable = getUnavailableHeroIds();
    const turn = getCurrentTurn();
    const activeSide = turn ? turn.side : "blue";
    const enemyPicks = (activeSide === "blue" ? state.redPicks : state.bluePicks)
      .map((p) => p.heroId)
      .filter(Boolean);
    const mapCfg = MLBB_MAPS[state.selectedMap] || MLBB_MAPS.healing_turtle;

    // Build coach score lookup map for sorting
    const coachRecs = computeTurnRecommendations(200);
    const coachScoreMap = new Map();
    for (const r of coachRecs) coachScoreMap.set(r.hero.id, r.coachScore);

    const q = state.poolSearch.trim().toLowerCase();

    const filtered = state.heroes.filter((h) => {
      if (state.poolLaneFilter !== "all" && !h.flex_lanes.includes(state.poolLaneFilter)) {
        return false;
      }
      if (state.poolRoleFilter !== "all" && !h.roles.includes(state.poolRoleFilter)) {
        return false;
      }
      if (state.poolTierFilter === "map_fit") {
        const mf = evaluateHeroMapFit(h, state.selectedMap);
        if (!["S+", "S"].includes(mf.mapTier)) return false;
      }
      if (state.poolTierFilter === "S+" && h.active_meta.tier !== "S+") return false;
      if (state.poolTierFilter === "S" && !["S+", "S"].includes(h.active_meta.tier)) return false;
      if (state.poolTierFilter === "hot" && h.active_meta.patch_trend === "STABLE") return false;

      if (q) {
        const hay = `${h.name} ${h.roles.join(" ")} ${h.flex_lanes.join(" ")} ${h.mpl.archetype || ""} ${h.specialties.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      const sortMode = state.poolSortBy;
      if (sortMode === "coach") {
        return (coachScoreMap.get(b.id) || 0) - (coachScoreMap.get(a.id) || 0);
      }
      if (sortMode === "map_fit") {
        const ma = evaluateHeroMapFit(a, state.selectedMap).mapBonus + a.active_meta.score * 0.25;
        const mb = evaluateHeroMapFit(b, state.selectedMap).mapBonus + b.active_meta.score * 0.25;
        return mb - ma;
      }
      if (sortMode === "hybrid") return b.active_meta.score - a.active_meta.score;
      if (sortMode === "ban_rate") return b.active_meta.ban_rate - a.active_meta.ban_rate;
      if (sortMode === "win_rate") return b.active_meta.win_rate - a.active_meta.win_rate;
      if (sortMode === "pick_rate") return b.active_meta.pick_rate - a.active_meta.pick_rate;
      if (sortMode === "counter") {
        const ca = evaluateHeroMatchupVsTeam(a, enemyPicks).totalDelta;
        const cb = evaluateHeroMatchupVsTeam(b, enemyPicks).totalDelta;
        return cb - ca;
      }
      return a.name.localeCompare(b.name);
    });

    const countBadge = document.getElementById("poolCountBadge");
    if (countBadge) {
      const availCount = filtered.filter((h) => !unavailable.has(h.id)).length;
      countBadge.textContent = `${availCount} / ${filtered.length} Available`;
    }

    gridEl.innerHTML = filtered
      .map((h) => {
        const isUnavail = unavailable.has(h.id);
        const am = h.active_meta;
        const tierCls = getTierBadgeClass(am.tier);
        const mapFit = evaluateHeroMapFit(h, state.selectedMap);

        let trendBadge = "";
        if (am.patch_trend === "NEW / REVAMPED") {
          trendBadge = `<span class="tile-trend-dot trend-new">NEW</span>`;
        } else if (am.patch_trend === "BUFFED / RISING") {
          trendBadge = `<span class="tile-trend-dot trend-buff">BUFF</span>`;
        }

        const mapBadgeHtml =
          mapFit.mapTier === "S+"
            ? `<span class="tile-map-fit-badge" title="${mapCfg.name} S+ Pick">${mapCfg.icon} S+</span>`
            : mapFit.mapTier === "S"
            ? `<span class="tile-map-fit-badge" style="background:rgba(14,165,233,0.9); color:#fff;" title="Strong on ${mapCfg.name}">${mapCfg.icon} S</span>`
            : "";

        let bottomOverlay = `${am.win_rate.toFixed(1)}% WR`;
        let overlayColor = "#cbd5e1";

        if (enemyPicks.length > 0 && (!turn || turn.type === "pick")) {
          const m = evaluateHeroMatchupVsTeam(h, enemyPicks);
          if (Math.abs(m.totalDelta) >= 1.5) {
            bottomOverlay = `${m.totalDelta > 0 ? "+" : ""}${m.totalDelta.toFixed(1)} VS ENEMY`;
            overlayColor = m.totalDelta > 0 ? "#34d399" : "#fb7185";
          }
        } else if (turn && turn.type === "ban" && am.ban_rate >= 5) {
          bottomOverlay = `${am.ban_rate.toFixed(1)}% BAN`;
          overlayColor = "#fcd34d";
        }

        return `
          <div class="hero-tile ${isUnavail ? "unavailable" : ""}" data-hero-id="${h.id}" title="${h.name} (${h.flex_lanes.join("/")}) — WR: ${am.win_rate}% | Ban: ${am.ban_rate}% | Pick: ${am.pick_rate}%">
            <div class="tile-img-wrap">
              <img src="${h.head}" alt="${h.name}" loading="lazy" />
              <span class="tile-tier-badge ${tierCls}">${am.tier}</span>
              ${trendBadge}
              ${mapBadgeHtml}
              <div class="tile-stat-overlay" style="color:${overlayColor};">${bottomOverlay}</div>
            </div>
            <div class="tile-name">${h.name}</div>
            <div class="tile-lane-sub">${h.flex_lanes.map((l) => LANE_SHORT[l] || l).join(" / ")}</div>
            <button class="tile-info-btn" data-matrix-jump="${h.id}" title="Inspect ${h.name} Counter Matrix">ℹ</button>
          </div>
        `;
      })
      .join("");

    gridEl.querySelectorAll(".hero-tile").forEach((tile) => {
      tile.addEventListener("click", (e) => {
        if (e.target.closest("[data-matrix-jump]")) return;
        const hid = parseInt(tile.dataset.heroId, 10);
        selectHeroForCurrentTurn(hid);
      });
    });

    gridEl.querySelectorAll("[data-matrix-jump]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const hid = parseInt(btn.dataset.matrixJump, 10);
        openHeroInMatrixView(hid);
      });
    });
  }

  /* =====================================================================
     8. VIEW 3: MPL & PATCH TIER LIST RENDERER
     ===================================================================== */
  function renderTierListView() {
    const spotlightEl = document.getElementById("patchSpotlightStrip");
    const boardEl = document.getElementById("tierBoardContainer");

    // Top 5 New / Revamped / Buffed Patch Spotlight Heroes
    const movers = state.heroes
      .filter((h) => h.active_meta.patch_trend !== "STABLE")
      .sort((a, b) => b.active_meta.score - a.active_meta.score)
      .slice(0, 5);

    spotlightEl.innerHTML = movers
      .map(
        (h) => `
        <div class="spotlight-card" data-inspect-id="${h.id}">
          <img src="${h.head}" alt="${h.name}" loading="lazy" />
          <div>
            <div style="display:flex; align-items:center; gap:6px;">
              <strong style="font-family:var(--font-display); font-size:14px; color:#fff;">${h.name}</strong>
              <span class="tile-tier-badge ${getTierBadgeClass(h.active_meta.tier)}" style="position:static;">${h.active_meta.tier}</span>
              <span style="font-size:9.5px; color:var(--gold-bright); font-weight:700;">${h.active_meta.patch_trend}</span>
            </div>
            <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">
              ${h.flex_lanes.join(" / ")} • <span style="color:#34d399;">${h.active_meta.win_rate.toFixed(1)}% WR</span> • <span style="color:#fcd34d;">${h.active_meta.ban_rate.toFixed(1)}% BR</span>
            </div>
          </div>
        </div>
      `
      )
      .join("");

    spotlightEl.querySelectorAll("[data-inspect-id]").forEach((el) => {
      el.addEventListener("click", () => openHeroInMatrixView(parseInt(el.dataset.inspectId, 10)));
    });

    const tiers = [
      { key: "S+", cls: "tier-row-S-plus", desc: "First-Pick / Must-Ban Gods" },
      { key: "S",  cls: "tier-row-S",      desc: "MPL & Mythical Glory Staples" },
      { key: "A",  cls: "tier-row-A",      desc: "Strong Counter & Comfort Picks" },
      { key: "B",  cls: "tier-row-B",      desc: "Situational / Niche Drafts" },
      { key: "C",  cls: "tier-row-C",      desc: "Low Current Patch Priority" }
    ];

    const q = state.tierSearch.trim().toLowerCase();

    boardEl.innerHTML = tiers
      .map((t) => {
        const heroesInTier = state.heroes
          .filter((h) => {
            if (h.active_meta.tier !== t.key) return false;
            if (state.tierLaneFilter !== "all" && !h.flex_lanes.includes(state.tierLaneFilter)) return false;
            if (q && !h.name.toLowerCase().includes(q)) return false;
            return true;
          })
          .sort((a, b) => b.active_meta.score - a.active_meta.score);

        return `
          <div class="tier-row ${t.cls}">
            <div class="tier-label-col">
              <div class="tier-big">${t.key}</div>
              <div class="tier-desc">${t.desc} (${heroesInTier.length})</div>
            </div>
            <div class="tier-heroes-wrap">
              ${heroesInTier
                .map(
                  (h) => `
                  <div class="tier-hero-card" data-inspect-id="${h.id}">
                    <img src="${h.head}" alt="${h.name}" loading="lazy" />
                    <div class="tier-hero-meta">
                      <div class="tier-hero-name">${h.name}</div>
                      <div style="font-size:10.5px; color:var(--blue-primary);">${h.flex_lanes.map((l) => LANE_SHORT[l]).join(" / ")} • ${h.roles[0]}</div>
                      <div class="tier-hero-stats">
                        WR ${h.active_meta.win_rate.toFixed(1)}% • BR ${h.active_meta.ban_rate.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                `
                )
                .join("")}
            </div>
          </div>
        `;
      })
      .join("");

    boardEl.querySelectorAll("[data-inspect-id]").forEach((el) => {
      el.addEventListener("click", () => openHeroInMatrixView(parseInt(el.dataset.inspectId, 10)));
    });
  }

  /* =====================================================================
     9. VIEW 4: HERO COUNTER & SYNERGY MATRIX EXPLORER
     ===================================================================== */
  function openHeroInMatrixView(heroId) {
    state.matrixSelectedHeroId = heroId;
    switchMainView("matrix");
  }

  function renderMatrixExplorerView() {
    const listEl = document.getElementById("matrixHeroList");
    const paneEl = document.getElementById("matrixDetailPane");

    const q = state.matrixSearch.trim().toLowerCase();
    const filtered = state.heroes
      .filter((h) => {
        if (state.matrixLaneFilter !== "all" && !h.flex_lanes.includes(state.matrixLaneFilter)) return false;
        if (q && !h.name.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => b.active_meta.score - a.active_meta.score);

    listEl.innerHTML = filtered
      .map(
        (h) => `
        <div class="matrix-list-item ${h.id === state.matrixSelectedHeroId ? "active" : ""}" data-select-matrix="${h.id}">
          <img src="${h.head}" alt="${h.name}" loading="lazy" />
          <div style="flex:1; min-width:0;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <strong style="color:#fff; font-size:12.5px;">${h.name}</strong>
              <span class="tile-tier-badge ${getTierBadgeClass(h.active_meta.tier)}" style="position:static;">${h.active_meta.tier}</span>
            </div>
            <div style="font-size:10.5px; color:var(--text-secondary);">
              ${h.flex_lanes.join(" / ")} • ${h.active_meta.win_rate.toFixed(1)}% WR
            </div>
          </div>
        </div>
      `
      )
      .join("");

    listEl.querySelectorAll("[data-select-matrix]").forEach((el) => {
      el.addEventListener("click", () => {
        state.matrixSelectedHeroId = parseInt(el.dataset.selectMatrix, 10);
        renderMatrixExplorerView();
      });
    });

    const hero = state.heroMap.get(state.matrixSelectedHeroId) || state.heroes[0];
    if (!hero) return;

    const tf = getHeroTimeframeStats(hero, state.timeframe);
    const am = hero.active_meta;

    const renderMatchupItems = (items, isPositive) => {
      if (!items || !items.length) {
        return `<div style="color:var(--text-muted); font-size:12px;">No statistical records in this window.</div>`;
      }
      return items
        .map((item) => {
          const target = state.heroMap.get(item.heroid);
          if (!target) return "";
          const sign = item.delta_wr > 0 ? "+" : "";
          return `
            <div class="matchup-item" data-jump-hero="${target.id}">
              <div class="matchup-left">
                <img src="${target.head}" alt="${target.name}" loading="lazy" />
                <div>
                  <strong style="color:#fff; font-size:13px;">${target.name}</strong>
                  <div style="font-size:10.5px; color:var(--text-secondary);">${target.flex_lanes.join(" / ")} • ${target.roles.join("/")}</div>
                </div>
              </div>
              <div style="text-align:right;">
                <span class="delta-chip ${isPositive ? "delta-pos" : "delta-neg"}" style="font-size:11.5px;">
                  ${sign}${item.delta_wr.toFixed(2)}% WR Delta
                </span>
                <div style="font-size:10px; color:var(--text-muted); margin-top:2px;">Matchup WR: ${item.match_wr.toFixed(1)}%</div>
              </div>
            </div>
          `;
        })
        .join("");
    };

    paneEl.innerHTML = `
      <div class="matrix-hero-banner">
        <div class="matrix-hero-identity">
          <img src="${hero.head}" alt="${hero.name}" />
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <h2 style="font-family:var(--font-display); font-size:26px; color:#fff;">${hero.name}</h2>
              <span class="tile-tier-badge ${getTierBadgeClass(am.tier)}" style="position:static; font-size:12px; padding:2px 8px;">${am.tier} TIER</span>
              <span class="badge-mpl">${am.patch_trend}</span>
            </div>
            <div style="color:var(--blue-primary); font-weight:600; margin-top:3px;">
              ${hero.flex_lanes.map((l) => `${LANE_ICONS[l] || ""} ${l}`).join(" • ")} | ${hero.roles.join(" / ")} (${hero.specialties.join(", ")})
            </div>
            <p style="color:var(--text-secondary); font-size:12.5px; margin-top:5px; max-width:650px;">
              <strong>MPL Pro Insight:</strong> ${hero.mpl.pro_note || `${hero.name} operates as a ${hero.mpl.archetype} option in high-tier drafts.`}
            </p>
          </div>
        </div>

        <div class="matrix-stat-kpis">
          <div class="kpi-box">
            <div class="kpi-val" style="color:var(--gold-bright);">${am.score.toFixed(1)}</div>
            <div class="kpi-lbl">Elya Meta Score</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-val" style="color:#34d399;">${am.win_rate.toFixed(2)}%</div>
            <div class="kpi-lbl">MG+ Win Rate</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-val" style="color:#fb7185;">${am.ban_rate.toFixed(2)}%</div>
            <div class="kpi-lbl">MG+ Ban Rate</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-val" style="color:#38bdf8;">${am.pick_rate.toFixed(2)}%</div>
            <div class="kpi-lbl">Match Pick Rate</div>
          </div>
        </div>
      </div>

      <!-- Power Scaling & Attribute Breakdown -->
      <div class="matrix-grid-2col">
        <div class="matrix-card">
          <h4>⏱️ Match Duration Win-Rate Scaling (Moonton GMS Live)</h4>
          <div class="diag-bars" style="margin-top:4px;">
            <div class="diag-bar-row">
              <span class="diag-bar-label" style="width:110px;">Early (6–12m)</span>
              <div class="diag-bar-track"><div class="diag-bar-fill" style="width:${Math.min(100, tf.scaling.early * 1.4)}%; background:#00e5ff;"></div></div>
              <span class="diag-bar-val" style="width:48px;">${tf.scaling.early.toFixed(1)}%</span>
            </div>
            <div class="diag-bar-row">
              <span class="diag-bar-label" style="width:110px;">Mid Game (12–16m)</span>
              <div class="diag-bar-track"><div class="diag-bar-fill" style="width:${Math.min(100, tf.scaling.mid * 1.4)}%; background:#f5b041;"></div></div>
              <span class="diag-bar-val" style="width:48px;">${tf.scaling.mid.toFixed(1)}%</span>
            </div>
            <div class="diag-bar-row">
              <span class="diag-bar-label" style="width:110px;">Late Game (16m+)</span>
              <div class="diag-bar-track"><div class="diag-bar-fill" style="width:${Math.min(100, tf.scaling.late * 1.4)}%; background:#10b981;"></div></div>
              <span class="diag-bar-val" style="width:48px;">${tf.scaling.late.toFixed(1)}%</span>
            </div>
          </div>
        </div>

        <div class="matrix-card">
          <h4>📊 Official Hero Combat Ratings</h4>
          <div class="diag-bars" style="margin-top:4px;">
            <div class="diag-bar-row">
              <span class="diag-bar-label" style="width:110px;">🛡️ Durability</span>
              <div class="diag-bar-track"><div class="diag-bar-fill" style="width:${hero.stats_rating.durability}%; background:#3b82f6;"></div></div>
              <span class="diag-bar-val">${hero.stats_rating.durability}</span>
            </div>
            <div class="diag-bar-row">
              <span class="diag-bar-label" style="width:110px;">💥 Offense</span>
              <div class="diag-bar-track"><div class="diag-bar-fill" style="width:${hero.stats_rating.offense}%; background:#f43f5e;"></div></div>
              <span class="diag-bar-val">${hero.stats_rating.offense}</span>
            </div>
            <div class="diag-bar-row">
              <span class="diag-bar-label" style="width:110px;">⛓️ Control Effects</span>
              <div class="diag-bar-track"><div class="diag-bar-fill" style="width:${hero.stats_rating.control}%; background:#a855f7;"></div></div>
              <span class="diag-bar-val">${hero.stats_rating.control}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 4-Way Statistical Counter & Synergy Matrices -->
      <div class="matrix-grid-2col">
        <div class="matrix-card">
          <h4>
            <span>⚔️ Strongest Against (${hero.name} Counters These)</span>
            <span style="font-size:11px; color:#34d399;">+Win Rate Advantage</span>
          </h4>
          <p style="font-size:11.5px; color:var(--text-secondary);">${hero.lore_relations.strong_desc || ""}</p>
          <div class="matchup-row-list">
            ${renderMatchupItems(tf.counters_beaten, true)}
          </div>
        </div>

        <div class="matrix-card">
          <h4>
            <span>⚠️ Weakest Against (Best Counters to ${hero.name})</span>
            <span style="font-size:11px; color:#fb7185;">-Win Rate Drop</span>
          </h4>
          <p style="font-size:11.5px; color:var(--text-secondary);">${hero.lore_relations.weak_desc || ""}</p>
          <div class="matchup-row-list">
            ${renderMatchupItems(tf.countered_by, false)}
          </div>
        </div>

        <div class="matrix-card">
          <h4>
            <span>🤝 Best Ally Teammate Synergies</span>
            <span style="font-size:11px; color:#38bdf8;">+Combo Win Rate</span>
          </h4>
          <p style="font-size:11.5px; color:var(--text-secondary);">${hero.lore_relations.assist_desc || ""}</p>
          <div class="matchup-row-list">
            ${renderMatchupItems(tf.best_teammates, true)}
          </div>
        </div>

        <div class="matrix-card">
          <h4>
            <span>🚫 Worst Ally Anti-Synergies (Avoid Drafting Together)</span>
            <span style="font-size:11px; color:#fb7185;">Role Overlap / Clash</span>
          </h4>
          <div class="matchup-row-list">
            ${renderMatchupItems(tf.worst_teammates, false)}
          </div>
        </div>
      </div>
    `;

    paneEl.querySelectorAll("[data-jump-hero]").forEach((el) => {
      el.addEventListener("click", () => {
        state.matrixSelectedHeroId = parseInt(el.dataset.jumpHero, 10);
        renderMatrixExplorerView();
      });
    });
  }

  /* =====================================================================
     10. COMPLETE DRAFT ANALYSIS REPORT MODAL
     ===================================================================== */
  function openDraftReportModal() {
    const modal = document.getElementById("draftReportModal");
    const content = document.getElementById("draftReportContent");
    const analytics = evaluateFullDraftAnalytics();
    const b = analytics.blueStats;
    const r = analytics.redStats;
    const mapCfg = MLBB_MAPS[state.selectedMap] || MLBB_MAPS.healing_turtle;

    const winnerSide = analytics.blueWinProb >= analytics.redWinProb ? "BLUE SIDE" : "RED SIDE";
    const winnerColor = analytics.blueWinProb >= analytics.redWinProb ? "var(--blue-primary)" : "var(--red-primary)";

    content.innerHTML = `
      <div class="report-grade-banner">
        <div style="display:flex; align-items:center; gap:14px;">
          <div class="grade-circle" style="background:rgba(0,229,255,0.16); border:2px solid var(--blue-primary); color:var(--blue-primary);">${b.grade}</div>
          <div>
            <div style="font-family:var(--font-display); font-size:17px; font-weight:700; color:var(--blue-primary);">BLUE SIDE DRAFT</div>
            <div style="font-family:var(--font-mono); font-size:14px; color:#fff;">${analytics.blueWinProb.toFixed(1)}% Predicted Win Rate</div>
            <div style="font-size:11.5px; color:var(--text-secondary);">Counter: ${b.counterTotal >= 0 ? "+" : ""}${b.counterTotal} • Synergy: +${b.synergyTotal} • Map Fit: ${b.mapFitTotal >= 0 ? "+" : ""}${b.mapFitTotal}</div>
          </div>
        </div>

        <div style="text-align:center;">
          <div style="font-size:11px; color:var(--gold-bright); font-weight:700; text-transform:uppercase;">${mapCfg.badgeText}</div>
          <div style="font-family:var(--font-display); font-size:20px; font-weight:700; color:${winnerColor};">${winnerSide} ADVANTAGE</div>
          <div style="font-size:11.5px; color:var(--text-secondary);">Early: ${b.scaling.early > r.scaling.early ? "Blue" : "Red"} • Late: ${b.scaling.late > r.scaling.late ? "Blue" : "Red"}</div>
        </div>

        <div style="display:flex; align-items:center; justify-content:flex-end; gap:14px; text-align:right;">
          <div>
            <div style="font-family:var(--font-display); font-size:17px; font-weight:700; color:var(--red-primary);">RED SIDE DRAFT</div>
            <div style="font-family:var(--font-mono); font-size:14px; color:#fff;">${analytics.redWinProb.toFixed(1)}% Predicted Win Rate</div>
            <div style="font-size:11.5px; color:var(--text-secondary);">Counter: ${r.counterTotal >= 0 ? "+" : ""}${r.counterTotal} • Synergy: +${r.synergyTotal} • Map Fit: ${r.mapFitTotal >= 0 ? "+" : ""}${r.mapFitTotal}</div>
          </div>
          <div class="grade-circle" style="background:rgba(255,42,95,0.16); border:2px solid var(--red-primary); color:var(--red-primary);">${r.grade}</div>
        </div>
      </div>

      <div class="matrix-grid-2col">
        <div class="matrix-card" style="border-top:3px solid var(--blue-primary);">
          <h4>🔵 Blue Team Strengths &amp; Draft Notes (${mapCfg.icon} ${mapCfg.name})</h4>
          <ul style="padding-left:18px; display:flex; flex-direction:column; gap:5px; color:#cbd5e1;">
            ${b.strengths.map((s) => `<li style="color:#6ee7b7;">${s}</li>`).join("")}
            ${b.weaknesses.map((w) => `<li style="color:#fda4af;">${w}</li>`).join("")}
            ${!b.strengths.length && !b.weaknesses.length ? `<li>Balanced standard composition.</li>` : ""}
          </ul>
        </div>

        <div class="matrix-card" style="border-top:3px solid var(--red-primary);">
          <h4>🔴 Red Team Strengths &amp; Draft Notes (${mapCfg.icon} ${mapCfg.name})</h4>
          <ul style="padding-left:18px; display:flex; flex-direction:column; gap:5px; color:#cbd5e1;">
            ${r.strengths.map((s) => `<li style="color:#6ee7b7;">${s}</li>`).join("")}
            ${r.weaknesses.map((w) => `<li style="color:#fda4af;">${w}</li>`).join("")}
            ${!r.strengths.length && !r.weaknesses.length ? `<li>Balanced standard composition.</li>` : ""}
          </ul>
        </div>
      </div>
    `;

    modal.classList.remove("hidden");
  }

  /* =====================================================================
     11. HELPERS & EVENT BINDINGS
     ===================================================================== */
  function getTierBadgeClass(tier) {
    if (tier === "S+") return "tier-S-plus";
    if (tier === "S") return "tier-S";
    if (tier === "A") return "tier-A";
    if (tier === "B") return "tier-B";
    return "tier-C";
  }

  function showToast(msg) {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const el = document.createElement("div");
    el.className = "toast-msg";
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, 4200);
  }

  function switchMainView(viewName) {
    state.activeView = viewName;
    document.querySelectorAll(".nav-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.view === viewName);
    });

    const draftWs = document.getElementById("viewDraftWorkspace");
    const tierWs = document.getElementById("viewTierList");
    const matrixWs = document.getElementById("viewMatrix");
    const simControls = document.getElementById("simModeControls");
    const liveBanner = document.getElementById("liveCounterBanner");

    draftWs.classList.toggle("active", viewName === "simulator" || viewName === "live-counter");
    tierWs.classList.toggle("active", viewName === "tier-list");
    matrixWs.classList.toggle("active", viewName === "matrix");

    if (viewName === "simulator") {
      simControls.classList.remove("hidden");
      liveBanner.classList.add("hidden");
    } else if (viewName === "live-counter") {
      simControls.classList.add("hidden");
      liveBanner.classList.remove("hidden");
      stopTurnTimer();
    } else {
      stopTurnTimer();
    }

    renderAll();
  }

  function bindEvents() {
    // Top Navigation Tabs
    document.querySelectorAll(".nav-tab").forEach((tab) => {
      tab.addEventListener("click", () => switchMainView(tab.dataset.view));
    });

    // Global Meta Controls
    document.getElementById("metaWeightMode").addEventListener("change", (e) => {
      state.metaWeightMode = e.target.value;
      recomputeDynamicMetaSummaries();
      renderAll();
    });

    document.getElementById("timeframeSelect").addEventListener("change", (e) => {
      state.timeframe = e.target.value;
      recomputeDynamicMetaSummaries();
      renderAll();
    });

    document.getElementById("btnAutoSync").addEventListener("click", () => {
      triggerLivePatchSync();
    });

    // Draft Simulator Toolbar
    document.querySelectorAll("#playerSideGroup .seg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#playerSideGroup .seg-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.playerSide = btn.dataset.side;
        renderAll();
        checkAndTriggerAiTurn();
      });
    });

    document.getElementById("draftFormatSelect").addEventListener("change", (e) => {
      state.draftFormat = e.target.value;
      resetDraft(true);
    });

    document.getElementById("aiDifficultySelect").addEventListener("change", (e) => {
      state.aiStyle = e.target.value;
      renderAll();
    });

    document.getElementById("timerModeSelect").addEventListener("change", (e) => {
      state.timerSeconds = parseInt(e.target.value, 10) || 0;
      resetTurnTimer();
    });

    // Battlefield Map Controls (Toolbar, HUD & Pre-Draft 4-Map Modal)
    const mapSelectEl = document.getElementById("battlefieldMapSelect");
    if (mapSelectEl) {
      mapSelectEl.addEventListener("change", (e) => {
        selectBattlefieldMap(e.target.value, false, true);
      });
    }
    const btnOpenMapModal = document.getElementById("btnOpenMapModal");
    if (btnOpenMapModal) btnOpenMapModal.addEventListener("click", () => openMapSelectModal());

    const btnChangeMapHud = document.getElementById("btnChangeMapHud");
    if (btnChangeMapHud) btnChangeMapHud.addEventListener("click", () => openMapSelectModal());

    const btnRandomizeMapHud = document.getElementById("btnRandomizeMapHud");
    if (btnRandomizeMapHud) btnRandomizeMapHud.addEventListener("click", () => randomizeBattlefieldMap(false));

    const btnCloseMapModal = document.getElementById("btnCloseMapModal");
    if (btnCloseMapModal) btnCloseMapModal.addEventListener("click", () => closeMapSelectModal(true));

    const btnConfirmMapStart = document.getElementById("btnConfirmMapStart");
    if (btnConfirmMapStart) {
      btnConfirmMapStart.addEventListener("click", () => {
        const m = MLBB_MAPS[state.selectedMap] || MLBB_MAPS.healing_turtle;
        closeMapSelectModal(true);
        showToast(`${m.icon} Draft Started on ${m.name} — Best Comp: ${m.comp_archetype}`);
      });
    }

    const btnRandomizeMapModal = document.getElementById("btnRandomizeMapModal");
    if (btnRandomizeMapModal) {
      btnRandomizeMapModal.addEventListener("click", () => randomizeBattlefieldMap(false));
    }

    // Action Buttons
    document.getElementById("btnUndo").addEventListener("click", () => undoLastTurn());
    document.getElementById("btnAiStep").addEventListener("click", () => executeAiTurn());
    document.getElementById("btnAutoFinish").addEventListener("click", () => autoFinishDraft());
    document.getElementById("btnOpenReport").addEventListener("click", () => openDraftReportModal());
    document.getElementById("btnResetDraft").addEventListener("click", () => {
      resetDraft(false);
      openMapSelectModal();
    });

    // Coach Lane Pills
    document.querySelectorAll("#coachLanePills .lane-pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        document.querySelectorAll("#coachLanePills .lane-pill").forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");
        state.coachLaneFilter = pill.dataset.lane;
        renderCoachPanel();
      });
    });

    // Hero Pool Filters
    const searchInput = document.getElementById("heroSearchInput");
    const clearBtn = document.getElementById("btnClearSearch");
    searchInput.addEventListener("input", () => {
      state.poolSearch = searchInput.value;
      clearBtn.classList.toggle("hidden", !state.poolSearch);
      renderHeroPoolGrid();
    });
    clearBtn.addEventListener("click", () => {
      searchInput.value = "";
      state.poolSearch = "";
      clearBtn.classList.add("hidden");
      renderHeroPoolGrid();
    });

    document.querySelectorAll("#poolLaneTabs .filter-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll("#poolLaneTabs .filter-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        state.poolLaneFilter = tab.dataset.lane;
        renderHeroPoolGrid();
      });
    });

    document.getElementById("poolRoleSelect").addEventListener("change", (e) => {
      state.poolRoleFilter = e.target.value;
      renderHeroPoolGrid();
    });

    document.getElementById("poolTierSelect").addEventListener("change", (e) => {
      state.poolTierFilter = e.target.value;
      renderHeroPoolGrid();
    });

    document.getElementById("poolSortSelect").addEventListener("change", (e) => {
      state.poolSortBy = e.target.value;
      renderHeroPoolGrid();
    });

    // Tier List View Filters
    document.querySelectorAll("#tierLaneTabs .filter-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll("#tierLaneTabs .filter-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        state.tierLaneFilter = tab.dataset.lane;
        renderTierListView();
      });
    });

    document.getElementById("tierSearchInput").addEventListener("input", (e) => {
      state.tierSearch = e.target.value;
      renderTierListView();
    });

    // Matrix View Filters
    document.getElementById("matrixHeroSearch").addEventListener("input", (e) => {
      state.matrixSearch = e.target.value;
      renderMatrixExplorerView();
    });

    document.querySelectorAll("#matrixLaneFilter .lane-pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        document.querySelectorAll("#matrixLaneFilter .lane-pill").forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");
        state.matrixLaneFilter = pill.dataset.lane;
        renderMatrixExplorerView();
      });
    });

    // Modal Buttons
    const closeReport = () => document.getElementById("draftReportModal").classList.add("hidden");
    document.getElementById("btnCloseReport").addEventListener("click", closeReport);
    document.getElementById("btnModalContinue").addEventListener("click", closeReport);
    document.getElementById("btnModalNewDraft").addEventListener("click", () => {
      closeReport();
      resetDraft(false);
      openMapSelectModal();
    });
    document.getElementById("btnModalSwapSides").addEventListener("click", () => {
      closeReport();
      state.playerSide = state.playerSide === "blue" ? "red" : "blue";
      document.querySelectorAll("#playerSideGroup .seg-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.side === state.playerSide);
      });
      resetDraft(false);
      openMapSelectModal();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
