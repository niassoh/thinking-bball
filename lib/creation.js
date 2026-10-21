// Thinking Basketball's creation metrics (Load, Box Creation, Passer Rating, cTOV%), ported
// from the stats sheet's 'All RS' tab so they can be computed for any stretch of minutes
// (the Lonestar tab: a player with his team's stars off). The sheet works from pbpstats
// player totals (the same fields get-totals and get-wowy-stats return for Type=Player),
// per 100 of the player's possessions; column letters below are the sheet's.

// A player's possessions: half his offensive plus defensive ('RS PBP' Totalposs / 2).
const possOf = r => (r.OffPoss + r.DefPoss) / 2

// The sheet's inputs from pbpstats totals: per-100 rates (G AST, L FGA, P 3PA, R FTA,
// S ORB, X TOV, Z PTS), AC 3P%, AE FT% (free-throw points over attempts) and his share of
// assists at the rim (for AX, against the league's). A player with no possessions (on for a
// second all season: the 2005-06 Rockets' 2668) has rates of 0, not 0/0, which would turn
// his team's Mates Spacing, and every Load built on it, into NaN.
const inputs = r => {
  const per = possOf(r) / 100
  const rate = v => (per ? (v || 0) / per : 0)
  const fga = (r.FG2A || 0) + (r.FG3A || 0)
  return {
    ast: rate(r.Assists),
    fga: rate(fga),
    pa3: rate(r.FG3A),
    fta: rate(r.FTA),
    orb: rate(r.OffRebounds),
    tov: rate(r.Turnovers),
    pts: rate(r.Points),
    pct3: r.FG3A ? (r.FG3M || 0) / r.FG3A : 0,
    pctFt: r.FTA ? (r.FtPoints || 0) / r.FTA : 0,
    // pbpstats' own TS% when it gives one (the sheet's 'real TS%').
    ts: r.TsPct ?? (fga + 0.44 * (r.FTA || 0) ? (r.Points || 0) / (2 * (fga + 0.44 * (r.FTA || 0))) : null),
    rimAstShare: r.Assists ? (r.AtRimAssists || 0) / r.Assists : 0
  }
}

// AH 3p Proficiency: 3P% scaled up by volume.
const threeProf = (pa3, pct3) => (2 / (1 + Math.exp(-pa3)) - 1) * pct3

// AS Spacing: shooting touch (FT% + 3p proficiency) weighted by position (1 PG … 5 C;
// 0 when unknown, as a blank cell reads in the sheet). Never 0.
const spacing = (pos, pctFt, prof) => {
  const s = (0.0214 * pos ** 2 - 0.0786 * pos + 1.06) * (pctFt + prof)
  return s === 0 ? 0.01 : s
}

// AT Mates Spacing: the minutes-weighted spacing of everyone on his team's floor (him
// included: `team` = Σ spacing × share of the team's minutes), less his own pull on it.
const matesSpacing = (own, share, team) => team - (own - team) * share

// AG Box OC (Box Creation): an estimate of shots created for teammates per 100, from
// assists, scoring and turnovers, shooting touch, offensive rebounding and height
// (inches), scaled by his teammates' spacing; never below 0.3 before that scaling.
const boxCreation = ({ ast, pts, tov, orb, pctFt, prof, height, mates }) => {
  const touch = prof + pctFt
  const raw = 13.59 + 0.081 * (pts + tov) - 3.28 * touch + 0.0251 * (ast * (pts - (0.038 * height - 2.38) * orb) * touch) - 6.97 * orb - 0.133 * height + 0.081 * (height * orb)
  return (mates / 1.09) * Math.max(0.3, raw)
}

// AI Non3 Box OC: the same estimate without shooting touch.
const non3BoxCreation = ({ ast, pts, tov }) => ast * -0.1091 + 0.05304 * (pts + tov) + 0.02864 * (ast * (pts + tov)) - 0.8724

// AM Load: possessions he uses or creates for, per 100.
const load = ({ ast, bc, fga, fta, tov }) => (ast - 0.38 * bc) * 0.752 + fga + fta * 0.44 + bc + tov

// BC Passer Rating (0–11.3): a fitted curve on rim-assist share (vs the league), Load,
// assists per Load, height, turnovers and non-3 creation per assist. (The sheet blends
// its regular-season and raw fits by pass volume; the two fits are the same formula.)
const passerRating = ({ rimAstRel, load: l, ast, height, tov, non3 }) => {
  const astLoad = ast / l
  const x = 4.79 + 6.48 * rimAstRel + 0.19 * l - 76.71 * astLoad - 0.07 * height - 0.08 * tov ** 2 - 2.71 * (non3 / ast) + 1.19 * (astLoad * height)
  return 11.3 / (1 + Math.exp(-Math.log10(2.5) * (x - 5.6)))
}

// Every metric for one player's totals in some minutes. ctx: { pos, height (inches),
// mates (Mates Spacing for those minutes), league: { ts, rimAstShare } }.
const metrics = (r, { pos, height, mates, league }) => {
  const i = inputs(r)
  const prof = threeProf(i.pa3, i.pct3)
  const bc = boxCreation({ ...i, prof, height, mates })
  const l = load({ ...i, bc })
  const non3 = non3BoxCreation(i)
  return {
    minutes: r.Minutes || (r.SecondsPlayed || 0) / 60,
    poss: possOf(r),
    load: l,
    pts75: i.pts * 0.75,
    rts: i.ts === null ? null : i.ts - league.ts,
    boxCreation: bc,
    passerRating: i.ast ? passerRating({ rimAstRel: i.rimAstShare - league.rimAstShare, load: l, ast: i.ast, height, tov: i.tov, non3 }) : null,
    pa3_75: i.pa3 * 0.75,
    pct3: r.FG3A ? i.pct3 : null,
    fta75: i.fta * 0.75,
    ctov: l ? i.tov / l : null,
    spacing: spacing(pos, i.pctFt, prof)
  }
}

// "6'8\"" -> 80
const inches = h => {
  const m = /^(\d+)'\s*(\d+)/.exec(h || '')
  return m ? Number(m[1]) * 12 + Number(m[2]) : 0
}

module.exports = { possOf, inputs, threeProf, spacing, matesSpacing, boxCreation, non3BoxCreation, load, passerRating, metrics, inches }
