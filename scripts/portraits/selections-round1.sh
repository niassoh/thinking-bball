#!/bin/bash
# The source photo chosen for each portrait target. Candidates were scored by
# eye against SOURCE_SELECTION.md; this file records the choices so rerunning it
# reproduces assets/player-sources/ and the source fields in metadata.
# Candidate indexes refer to assets/player-sources/candidates/<slug>.json
# from find-sources.js. Scores: clarity,size,expression,occlusion,angle,recency,jersey.
# Crops (x,y,size in stored-image pixels) are added with --crop once chosen.
set -u
cd "$(dirname "$0")/../.."
run() { node scripts/portraits/select-source.js "$@" || echo "FAILED: $2"; }

run --slug nikola-jokic --crop 0,0,1300 --candidate 1 --scores 3,3,2,2,2,1,0 --rejected 3:12,4:11,2:10,0:9 --notes "2022 All-Star warmup; off-camera gaze. No clean 2024-26 Commons photo with a large face."
run --slug shai-gilgeous-alexander --crop 205,0,1400 --candidate 0 --scores 3,3,3,2,2,1,1 --rejected 2:12,8:13,7:13
run --slug giannis-antetokounmpo --crop 120,0,1500 --candidate 1 --scores 3,3,3,2,2,1,0 --rejected 0:9,6:9
run --slug luka-doncic --crop 106,0,1700 --candidate 11 --scores 3,3,2,2,2,1,0 --rejected 12:12,6:12 --notes "All-Star hoodie; no recent Lakers photo on Commons."
run --slug jayson-tatum --crop 632,0,1650 --candidate 7 --scores 3,3,2,2,2,0,1 --rejected 2:13,10:11 --notes "Chosen over #2 (also 13) for the larger face."
run --slug victor-wembanyama --crop 68,0,1400 --candidate 2 --scores 3,3,2,2,2,2,1 --rejected 1:12,7:11
run --slug tyrese-haliburton --crop 25,0,1750 --candidate 2 --scores 3,3,1,2,1,2,1 --rejected 1:13,4:10 --notes "Near-neutral expression; tighter of two frames from the same 2025 shoot."
run --slug isaiah-hartenstein --crop 0,0,640 --candidate 2 --scores 3,2,2,2,2,1,0 --rejected 0:12,1:10 --needs-review "Small source (805x1212); face about 200 px, below the ~250 px guideline. Knicks jersey (now OKC)."
run --slug domantas-sabonis --crop 650,40,1400 --candidate 7 --scores 3,3,2,2,2,0,0 --rejected 1:11,4:9 --notes "2019 Pacers, public domain. Side profile."
run --slug jalen-williams --crop 245,40,480 --candidate 1 --scores 2,1,3,2,2,2,1 --rejected 0:13 --needs-review "Face small (~120 px) in the only usable Commons photo. NBA CDN headshot (license unknown) is an alternative but looks unlike this photo; confirm identity if switching."
run --slug cade-cunningham --crop 0,0,2222 --candidate 15 --scores 3,3,2,2,2,1,0 --rejected 0:13,13:12 --notes "Chosen over the 2024 Pistons photo (#0, also 13) for expression."
run --slug lebron-james --crop 220,0,800 --candidate 2 --scores 3,3,2,2,2,1,1 --rejected 1:13,15:12
run --slug kristaps-porzingis --crop 0,0,1727 --candidate 8 --scores 3,3,3,2,2,2,1 --rejected 0:11,5:14
run --slug karl-anthony-towns --crop 445,60,650 --candidate 7 --scores 3,2,2,2,2,1,0 --rejected 5:11,3:9 --notes "2022 Timberwolves (now Knicks); medium face size."
run --slug alperen-sengun --crop 520,0,1800 --candidate 2 --scores 3,3,2,2,2,2,0 --rejected 13:13,3:12,6:12 --notes "2025 Türkiye national team jersey."
run --slug jamal-murray --crop 160,0,640 --candidate 1 --scores 3,2,2,2,2,0,1 --rejected 0:9 --notes "2020 photo. NBA CDN 2025 headshot also scored 12 but has no clear license."
run --slug anthony-davis --crop 272,0,1000 --candidate 0 --scores 3,3,2,2,2,1,0 --rejected 1:10,8:10
run --slug chet-holmgren --crop 140,0,760 --url "https://cdn.nba.com/headshots/nba/latest/1040x760/1631096.png" --page "https://www.nba.com/player/1631096" --license "unknown (official NBA headshot, cdn.nba.com)" --author "NBA" --scores 3,3,0,2,1,2,1 --needs-review "Identity: NBA.com's Chet Holmgren page (checked 2026-10-01) uses this headshot, but it looks quite different from his 2021 Commons photos; confirm before generating. Static media-day image. Commons alternative scored 9/16 (2021 Gonzaga, small face)."
run --slug donovan-mitchell --crop 100,0,950 --candidate 7 --scores 3,3,2,2,2,1,1 --rejected 5:12,6:13
run --slug jalen-brunson --crop 285,0,620 --candidate 1 --scores 3,2,2,2,2,1,1 --rejected 0:11,5:10
